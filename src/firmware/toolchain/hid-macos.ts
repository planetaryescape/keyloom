// Raw HID on macOS through IOKit, called with bun:ffi. A `bun build --compile` binary can't load
// native modules, but IOKit is always there. Listing reads the I/O Registry and opens nothing, so it
// needs no permission and can't disturb a keyboard; only write() opens a device.
import { JSCallback, dlopen, ptr, toArrayBuffer } from "bun:ffi";
import { type HidTransport, HidError, type RawHidInterface, isRawHidUsage } from "./hid.ts";

const kCFStringEncodingUTF8 = 0x08000100;
const kCFNumberSInt64Type = 4;
const kIOHIDReportTypeOutput = 1;
const kIOReturnSuccess = 0;

// Core Foundation objects are declared u64, not ptr: short strings are tagged pointers whose high bits
// a JS number cannot hold, and a rounded pointer crashes the process. Buffers we own are ordinary
// addresses, so those stay ptr. 0n is NULL.
function load() {
  const iokit = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", {
    IOServiceMatching: { args: ["ptr"], returns: "u64" },
    IOServiceGetMatchingServices: { args: ["u32", "u64", "ptr"], returns: "i32" },
    IOIteratorNext: { args: ["u32"], returns: "u32" },
    IOObjectRelease: { args: ["u32"], returns: "i32" },
    IORegistryEntryGetRegistryEntryID: { args: ["u32", "ptr"], returns: "i32" },
    IORegistryEntryIDMatching: { args: ["u64"], returns: "u64" },
    IORegistryEntryCreateCFProperty: { args: ["u32", "u64", "u64", "u32"], returns: "u64" },
    IOHIDDeviceCreate: { args: ["u64", "u32"], returns: "u64" },
    IOHIDDeviceOpen: { args: ["u64", "u32"], returns: "i32" },
    IOHIDDeviceClose: { args: ["u64", "u32"], returns: "i32" },
    IOHIDDeviceSetReport: { args: ["u64", "i32", "i64", "ptr", "i64"], returns: "i32" },
    IOHIDDeviceRegisterInputReportCallback: { args: ["u64", "ptr", "i64", "ptr", "ptr"], returns: "void" },
    IOHIDDeviceScheduleWithRunLoop: { args: ["u64", "u64", "u64"], returns: "void" },
    IOHIDDeviceUnscheduleFromRunLoop: { args: ["u64", "u64", "u64"], returns: "void" },
  });
  const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
    CFStringCreateWithCString: { args: ["u64", "ptr", "u32"], returns: "u64" },
    CFStringGetCString: { args: ["u64", "ptr", "i64", "u32"], returns: "bool" },
    CFNumberGetValue: { args: ["u64", "i64", "ptr"], returns: "bool" },
    CFGetTypeID: { args: ["u64"], returns: "u64" },
    CFNumberGetTypeID: { args: [], returns: "u64" },
    CFStringGetTypeID: { args: [], returns: "u64" },
    CFRelease: { args: ["u64"], returns: "void" },
    CFRunLoopGetCurrent: { args: [], returns: "u64" },
    CFRunLoopRunInMode: { args: ["u64", "f64", "bool"], returns: "i32" },
  });
  return { io: iokit.symbols, cf: cf.symbols };
}

type Lib = ReturnType<typeof load>;
const cstr = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

/** One property of a registry entry, as a number or a string, or undefined when the entry has none. */
function property(lib: Lib, entry: number, name: string): number | string | undefined {
  const key = lib.cf.CFStringCreateWithCString(0n, ptr(cstr(name)), kCFStringEncodingUTF8);
  if (key === 0n) return undefined;
  try {
    const value = lib.io.IORegistryEntryCreateCFProperty(entry, key, 0n, 0);
    if (value === 0n) return undefined;
    try {
      const type = lib.cf.CFGetTypeID(value);
      if (type === lib.cf.CFNumberGetTypeID()) {
        const out = new BigInt64Array(1);
        return lib.cf.CFNumberGetValue(value, kCFNumberSInt64Type, ptr(out)) ? Number(out[0]) : undefined;
      }
      if (type === lib.cf.CFStringGetTypeID()) {
        const out = new Uint8Array(256);
        return lib.cf.CFStringGetCString(value, ptr(out), out.length, kCFStringEncodingUTF8) ? new TextDecoder().decode(out.subarray(0, out.indexOf(0))) : undefined;
      }
      return undefined;
    } finally {
      lib.cf.CFRelease(value);
    }
  } finally {
    lib.cf.CFRelease(key);
  }
}

/** Calls `fn` with every IOHIDDevice registry entry, releasing each afterwards. */
function eachHidDevice(lib: Lib, fn: (entry: number) => void): void {
  const matching = lib.io.IOServiceMatching(ptr(cstr("IOHIDDevice")));
  if (matching === 0n) throw new HidError("IOKit has no IOHIDDevice class on this machine");
  const iterator = new Uint32Array(1);
  // The call consumes `matching`, so it is not released here. 0 is kIOMainPortDefault.
  if (lib.io.IOServiceGetMatchingServices(0, matching, ptr(iterator)) !== kIOReturnSuccess) throw new HidError("IOKit would not list HID devices");
  try {
    for (let entry = lib.io.IOIteratorNext(iterator[0] as number); entry !== 0; entry = lib.io.IOIteratorNext(iterator[0] as number)) {
      try {
        fn(entry);
      } finally {
        lib.io.IOObjectRelease(entry);
      }
    }
  } finally {
    lib.io.IOObjectRelease(iterator[0] as number);
  }
}

const entryId = (lib: Lib, entry: number): bigint => {
  const out = new BigUint64Array(1);
  if (lib.io.IORegistryEntryGetRegistryEntryID(entry, ptr(out)) !== kIOReturnSuccess) throw new HidError("IOKit would not name a HID device");
  return out[0] as bigint;
};

export function macosHid(): HidTransport {
  const lib = load();
  return {
    async list() {
      const found: RawHidInterface[] = [];
      eachHidDevice(lib, (entry) => {
        const page = property(lib, entry, "PrimaryUsagePage");
        const usage = property(lib, entry, "PrimaryUsage");
        const vendorId = property(lib, entry, "VendorID");
        const productId = property(lib, entry, "ProductID");
        if (typeof page !== "number" || typeof usage !== "number" || typeof vendorId !== "number" || typeof productId !== "number") return;
        if (!isRawHidUsage(page, usage)) return;
        const serial = property(lib, entry, "SerialNumber");
        found.push({ vendorId, productId, ...(typeof serial === "string" && serial !== "" ? { serial } : {}), handle: entryId(lib, entry).toString() });
      });
      return found;
    },

    /**
     * Holds the interface open and delivers input reports. IOKit calls back from a run loop, so the loop is run for an instant every
     * few milliseconds on this thread, which keeps JavaScript single-threaded. Written from the IOKit headers and not yet run against
     * a keyboard: the S50 runbook is the first real use.
     */
    async openSession(target, onReport, onError) {
      const matching = lib.io.IORegistryEntryIDMatching(BigInt(target.handle));
      if (matching === 0n) throw new HidError("IOKit could not build a match for the keyboard");
      const iterator = new Uint32Array(1);
      if (lib.io.IOServiceGetMatchingServices(0, matching, ptr(iterator)) !== kIOReturnSuccess) throw new HidError("the keyboard is no longer attached");
      let device = 0n;
      try {
        const service = lib.io.IOIteratorNext(iterator[0] as number);
        if (service === 0) throw new HidError("the keyboard is no longer attached");
        try {
          device = lib.io.IOHIDDeviceCreate(0n, service);
        } finally {
          lib.io.IOObjectRelease(service);
        }
      } finally {
        lib.io.IOObjectRelease(iterator[0] as number);
      }
      if (device === 0n) throw new HidError("macOS would not open the keyboard's raw HID interface");
      const opened = lib.io.IOHIDDeviceOpen(device, 0);
      if (opened !== kIOReturnSuccess) {
        lib.cf.CFRelease(device);
        throw new HidError(`macOS refused to open the keyboard's raw HID interface (IOReturn 0x${(opened >>> 0).toString(16)}). Allow your terminal under System Settings > Privacy & Security > Input Monitoring, then try again`);
      }
      // IOKit writes each report into this buffer before calling back, so it must outlive the registration.
      const buffer = new Uint8Array(64);
      const callback = new JSCallback(
        (_context: unknown, _result: number, _sender: unknown, _type: number, _id: number, report: number, length: number | bigint) => {
          try {
            onReport(Uint8Array.from(new Uint8Array(toArrayBuffer(report as never, 0, Number(length)))));
          } catch (err) {
            onError?.(err as Error);
          }
        },
        { args: ["ptr", "i32", "ptr", "i32", "u32", "ptr", "i64"], returns: "void" },
      );
      const mode = lib.cf.CFStringCreateWithCString(0n, ptr(cstr("kCFRunLoopDefaultMode")), kCFStringEncodingUTF8);
      const runLoop = lib.cf.CFRunLoopGetCurrent();
      // bun:ffi types a pointer as a branded number; the callback's address and NULL are the two it cannot express.
      lib.io.IOHIDDeviceRegisterInputReportCallback(device, ptr(buffer), buffer.length, callback.ptr as never, null as never);
      lib.io.IOHIDDeviceScheduleWithRunLoop(device, runLoop, mode);
      const pump = setInterval(() => lib.cf.CFRunLoopRunInMode(mode, 0, true), 2);
      let closed = false;
      return {
        write(report) {
          if (closed) throw new HidError("the keyboard session is closed");
          const sent = lib.io.IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, ptr(report), report.length);
          if (sent !== kIOReturnSuccess) throw new HidError(`macOS could not write to the keyboard (IOReturn 0x${(sent >>> 0).toString(16)})`);
        },
        close() {
          if (closed) return;
          closed = true;
          clearInterval(pump);
          lib.io.IOHIDDeviceUnscheduleFromRunLoop(device, runLoop, mode);
          lib.io.IOHIDDeviceClose(device, 0);
          lib.cf.CFRelease(mode);
          lib.cf.CFRelease(device);
          callback.close();
        },
      };
    },

    async write(target, report) {
      // The registry entry ID is stable while the device stays attached, and unlike a port number it can be matched again here.
      const matching = lib.io.IORegistryEntryIDMatching(BigInt(target.handle));
      if (matching === 0n) throw new HidError("IOKit could not build a match for the keyboard");
      const iterator = new Uint32Array(1);
      if (lib.io.IOServiceGetMatchingServices(0, matching, ptr(iterator)) !== kIOReturnSuccess) throw new HidError("the keyboard is no longer attached");
      try {
        const service = lib.io.IOIteratorNext(iterator[0] as number);
        if (service === 0) throw new HidError("the keyboard is no longer attached");
        try {
          const device = lib.io.IOHIDDeviceCreate(0n, service);
          if (device === 0n) throw new HidError("macOS would not open the keyboard's raw HID interface");
          try {
            const opened = lib.io.IOHIDDeviceOpen(device, 0);
            if (opened !== kIOReturnSuccess) throw new HidError(`macOS refused to open the keyboard's raw HID interface (IOReturn 0x${(opened >>> 0).toString(16)}). Allow your terminal under System Settings > Privacy & Security > Input Monitoring, then try again`);
            try {
              const sent = lib.io.IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, ptr(report), report.length);
              if (sent !== kIOReturnSuccess) throw new HidError(`macOS could not write to the keyboard (IOReturn 0x${(sent >>> 0).toString(16)})`);
            } finally {
              lib.io.IOHIDDeviceClose(device, 0);
            }
          } finally {
            lib.cf.CFRelease(device);
          }
        } finally {
          lib.io.IOObjectRelease(service);
        }
      } finally {
        lib.io.IOObjectRelease(iterator[0] as number);
      }
    },
  };
}
