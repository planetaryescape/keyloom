// USB serial ports on macOS through IOKit, called with bun:ffi like hid-macos.ts. Every serial port is an
// IOSerialBSDClient in the I/O Registry with its device node in IOCalloutDevice; the USB device that owns it
// is a parent entry, which holds the vendor, product and serial number. Reading the registry opens no port,
// so a half can be found without disturbing it. Touching the port is stty's job (serial.ts).
import { dlopen, ptr } from "bun:ffi";
import { type SerialPort, type SerialTransport, SerialError, touchWithStty } from "./serial.ts";

const kCFStringEncodingUTF8 = 0x08000100;
const kCFNumberSInt64Type = 4;
const kIOReturnSuccess = 0;
// kIORegistryIterateRecursively | kIORegistryIterateParents: search this entry, then its parents, nearest first.
const SEARCH_PARENTS = 3;

// Core Foundation objects are declared u64, not ptr, for the reason given in hid-macos.ts. 0n is NULL.
function load() {
  const iokit = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", {
    IOServiceMatching: { args: ["ptr"], returns: "u64" },
    IOServiceGetMatchingServices: { args: ["u32", "u64", "ptr"], returns: "i32" },
    IOIteratorNext: { args: ["u32"], returns: "u32" },
    IOObjectRelease: { args: ["u32"], returns: "i32" },
    IORegistryEntryCreateCFProperty: { args: ["u32", "u64", "u64", "u32"], returns: "u64" },
    IORegistryEntrySearchCFProperty: { args: ["u32", "ptr", "u64", "u64", "u32"], returns: "u64" },
  });
  const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
    CFStringCreateWithCString: { args: ["u64", "ptr", "u32"], returns: "u64" },
    CFStringGetCString: { args: ["u64", "ptr", "i64", "u32"], returns: "bool" },
    CFNumberGetValue: { args: ["u64", "i64", "ptr"], returns: "bool" },
    CFGetTypeID: { args: ["u64"], returns: "u64" },
    CFNumberGetTypeID: { args: [], returns: "u64" },
    CFStringGetTypeID: { args: [], returns: "u64" },
    CFRelease: { args: ["u64"], returns: "void" },
  });
  return { io: iokit.symbols, cf: cf.symbols };
}

type Lib = ReturnType<typeof load>;
const cstr = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

function valueOf(lib: Lib, value: bigint): number | string | undefined {
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
}

/** A property of a registry entry, or with `inParents` of the nearest entry above it that has it. */
function property(lib: Lib, entry: number, name: string, inParents = false): number | string | undefined {
  const key = lib.cf.CFStringCreateWithCString(0n, ptr(cstr(name)), kCFStringEncodingUTF8);
  if (key === 0n) return undefined;
  try {
    const value = inParents
      ? lib.io.IORegistryEntrySearchCFProperty(entry, ptr(cstr("IOService")), key, 0n, SEARCH_PARENTS)
      : lib.io.IORegistryEntryCreateCFProperty(entry, key, 0n, 0);
    if (value === 0n) return undefined;
    try {
      return valueOf(lib, value);
    } finally {
      lib.cf.CFRelease(value);
    }
  } finally {
    lib.cf.CFRelease(key);
  }
}

export function macosSerial(): SerialTransport {
  const lib = load();
  return {
    async list() {
      const matching = lib.io.IOServiceMatching(ptr(cstr("IOSerialBSDClient")));
      if (matching === 0n) throw new SerialError("IOKit has no IOSerialBSDClient class on this machine");
      const iterator = new Uint32Array(1);
      // The call consumes `matching`, so it is not released here. 0 is kIOMainPortDefault.
      if (lib.io.IOServiceGetMatchingServices(0, matching, ptr(iterator)) !== kIOReturnSuccess) throw new SerialError("IOKit would not list serial ports");
      const found: SerialPort[] = [];
      try {
        for (let entry = lib.io.IOIteratorNext(iterator[0] as number); entry !== 0; entry = lib.io.IOIteratorNext(iterator[0] as number)) {
          try {
            const path = property(lib, entry, "IOCalloutDevice");
            const vendorId = property(lib, entry, "idVendor", true);
            const productId = property(lib, entry, "idProduct", true);
            // A Bluetooth or modem port has no USB device above it.
            if (typeof path !== "string" || typeof vendorId !== "number" || typeof productId !== "number") continue;
            const serial = property(lib, entry, "USB Serial Number", true);
            found.push({ vendorId, productId, ...(typeof serial === "string" && serial !== "" ? { serial } : {}), path });
          } finally {
            lib.io.IOObjectRelease(entry);
          }
        }
      } finally {
        lib.io.IOObjectRelease(iterator[0] as number);
      }
      return found;
    },
    touch: (path, baud) => touchWithStty(path, baud, "darwin"),
  };
}
