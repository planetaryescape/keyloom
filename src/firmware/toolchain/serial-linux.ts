// USB serial ports on Linux, from sysfs: /sys/class/tty/ttyACMn/device is the USB interface, and its parent
// directory is the device with idVendor, idProduct and serial. Needs no native code and opens nothing. The
// path handed back is the stable /dev/serial/by-id link when udev made one, else /dev/ttyACMn.
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { type SerialTransport, touchWithStty } from "./serial.ts";

const tryRead = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
};

/** udev's by-id links by the device node each resolves to. */
function byIdLinks(byIdDir: string): Map<string, string> {
  const links = new Map<string, string>();
  try {
    for (const name of readdirSync(byIdDir)) {
      try {
        links.set(realpathSync(join(byIdDir, name)), join(byIdDir, name));
      } catch {
        // A dangling link is a device that has gone.
      }
    }
  } catch {
    // No by-id directory: udev has made no links.
  }
  return links;
}

/** The directories are parameters so tests can use a fake tree. */
export function linuxSerial(sysClassTty = "/sys/class/tty", devDir = "/dev", byIdDir = "/dev/serial/by-id"): SerialTransport {
  return {
    async list() {
      let nodes: string[];
      try {
        nodes = readdirSync(sysClassTty).filter((n) => /^ttyACM\d+$/.test(n));
      } catch {
        return [];
      }
      const links = byIdLinks(byIdDir);
      const found = [];
      for (const node of nodes) {
        // `device` links to the interface; the USB device is its parent.
        let usbDevice: string;
        try {
          usbDevice = join(realpathSync(join(sysClassTty, node, "device")), "..");
        } catch {
          continue;
        }
        const vendor = tryRead(join(usbDevice, "idVendor"));
        const product = tryRead(join(usbDevice, "idProduct"));
        if (!vendor || !product) continue;
        const serial = tryRead(join(usbDevice, "serial"));
        const dev = join(devDir, node);
        // by-id links resolve to real paths, which differ from a path through a symlinked /dev.
        let real = dev;
        try {
          real = realpathSync(dev);
        } catch {
          // The node is not there (yet); it is listed under its plain name.
        }
        found.push({
          vendorId: Number.parseInt(vendor, 16), productId: Number.parseInt(product, 16),
          ...(serial ? { serial } : {}), path: links.get(real) ?? dev,
        });
      }
      return found;
    },
    touch: (path, baud) => touchWithStty(path, baud, "linux"),
  };
}
