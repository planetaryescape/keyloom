// The module's C compiled for the host against stand-ins for Zephyr's headers, as the Moonlander's wrapper is (test/firmware/qmk/handsfree.test.ts).
// The real proof that it builds into the firmware is the Docker builds in the rung's evidence; this runs the arithmetic and the state machine.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "../../helpers/tmp.ts";
import { LOCAL_BAUD, RELAY_BAUD } from "../../../src/firmware/zmk/handsfree.ts";

const SRC = `${import.meta.dir}/../../../firmware/zmk/keyloom-zmk/src`;
const cc = Bun.which("cc") ?? Bun.which("gcc") ?? Bun.which("clang");

/** Just enough of Zephyr for the two files: IS_ENABLED, MIN, ssize_t, the hwinfo and UART calls, and a clock the harness controls. */
const STUBS: Record<string, string> = {
  "zephyr/sys/util.h": `
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <sys/types.h>
#define _XXXX1 _YYYY,
#define Z_IS_ENABLED1(m) Z_IS_ENABLED2(_XXXX##m)
#define Z_IS_ENABLED2(a) Z_IS_ENABLED3(a 1, 0)
#define Z_IS_ENABLED3(ignore, val, ...) val
#define IS_ENABLED(m) Z_IS_ENABLED1(m)
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define ARG_UNUSED(x) (void)(x)
`,
  "zephyr/drivers/hwinfo.h": `
#pragma once
#include <zephyr/sys/util.h>
ssize_t hwinfo_get_device_id(uint8_t *buffer, size_t length);
`,
  "zephyr/usb/usb_device.h": `
#pragma once
#include <zephyr/sys/util.h>
int usb_enable(void *status_cb);
`,
  "zephyr/kernel.h": `
#pragma once
#include <zephyr/sys/util.h>
#include <stdbool.h>
#define K_MSEC(ms) (ms)
#define K_LOWEST_APPLICATION_THREAD_PRIO 0
#define K_THREAD_DEFINE(...)
#define DEVICE_DT_GET(x) ((const struct device *)0)
#define DT_NODELABEL(x) x
#define CONFIG_KEYLOOM_HANDSFREE_STACK_SIZE 2048
struct device;
int k_sleep(int ms);
int64_t k_uptime_get(void);
bool device_is_ready(const struct device *d);
`,
  "zephyr/device.h": `#pragma once\n#include <zephyr/kernel.h>\n`,
  "zephyr/drivers/uart.h": `
#pragma once
#include <zephyr/kernel.h>
#define UART_LINE_CTRL_BAUD_RATE 1
#define UART_LINE_CTRL_DTR 4
int uart_line_ctrl_get(const struct device *d, uint32_t ctrl, uint32_t *val);
int uart_line_ctrl_set(const struct device *d, uint32_t ctrl, uint32_t val);
`,
  "zephyr/sys/reboot.h": `#pragma once\n#define SYS_REBOOT_WARM 0\nvoid sys_reboot(int type);\n`,
  "zephyr/logging/log.h": `#pragma once\n#define LOG_MODULE_REGISTER(...)\n#define LOG_LEVEL_INF 3\n#define LOG_INF(...)\n#define LOG_WRN(...)\n`,
  "zmk/behavior.h": `
#pragma once
#include <zephyr/kernel.h>
struct zmk_behavior_binding { const char *behavior_dev; uint32_t param1, param2; };
struct zmk_behavior_binding_event { int layer; uint32_t position; int64_t timestamp; uint8_t source; };
`,
  "zmk/split/central.h": `
#pragma once
#include <zmk/behavior.h>
#define ZMK_SPLIT_CENTRAL_PERIPHERAL_COUNT 1
int zmk_split_central_invoke_behavior(uint8_t source, struct zmk_behavior_binding *binding, struct zmk_behavior_binding_event event, bool state);
`,
};

async function compile(harness: string, defines: string[], sources: string[]) {
  const dir = tempDir("keyloom-c-");
  for (const [path, text] of Object.entries(STUBS)) await Bun.write(join(dir, "inc", path), text);
  await Bun.write(join(dir, "harness.c"), harness);
  const exe = join(dir, "harness");
  const r = await Bun.$`${cc} -Wall -Werror -I${join(dir, "inc")} ${defines.map((d) => `-D${d}`)} -o ${exe} ${join(dir, "harness.c")} ${sources.map((s) => join(SRC, s))}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`the module did not compile:\n${r.stderr.toString()}`);
  return exe;
}

describe.skipIf(!cc)("the serial number the module writes", () => {
  const harness = `
#include <stdio.h>
#include <string.h>
#include <zephyr/drivers/hwinfo.h>
uint8_t *usb_update_sn_string_descriptor(void);
ssize_t hwinfo_get_device_id(uint8_t *b, size_t n) { const uint8_t id[8] = {0x00,0x11,0x22,0x33,0x44,0x55,0x66,0x77}; memcpy(b, id, n < 8 ? n : 8); return n < 8 ? n : 8; }
int main(void) { printf("%s|%zu\\n", (char *)usb_update_sn_string_descriptor(), strlen((char *)usb_update_sn_string_descriptor())); return 0; }
`;
  const sn = (template: string, role: string[]) => [`CONFIG_USB_DEVICE_SN="${template}"`, ...role];

  test("a peripheral writes R, a central writes L, and both end in their own chip ID with the template's length", async () => {
    const template = "keyloom/4NY1MKBCK6TY-L:0123456789ABCDEF";
    const peripheral = await compile(harness, sn(template, ["CONFIG_ZMK_SPLIT=1"]), ["serial.c"]);
    expect((await Bun.$`${peripheral}`.text()).trim()).toBe(`keyloom/4NY1MKBCK6TY-R:0011223344556677|${template.length}`);
    const central = await compile(harness, sn(template, ["CONFIG_ZMK_SPLIT=1", "CONFIG_ZMK_SPLIT_ROLE_CENTRAL=1"]), ["serial.c"]);
    expect((await Bun.$`${central}`.text()).trim()).toBe(`keyloom/4NY1MKBCK6TY-L:0011223344556677|${template.length}`);
    const unibody = await compile(harness, sn(template, []), ["serial.c"]);
    expect((await Bun.$`${unibody}`.text()).trim()).toContain("-L:0011223344556677");
  });

  test("a longer tail keeps its text and only the last 16 characters become the chip ID", async () => {
    const template = "keyloom/4NY1MKBCK6TY-L:GLV80-0123456789ABCDEF";
    const exe = await compile(harness, sn(template, ["CONFIG_ZMK_SPLIT=1"]), ["serial.c"]);
    expect((await Bun.$`${exe}`.text()).trim()).toBe(`keyloom/4NY1MKBCK6TY-R:GLV80-0011223344556677|${template.length}`);
  });

  test("a template that isn't keyloom's keeps its text and still gets the chip ID, so two halves never share a serial", async () => {
    const exe = await compile(harness, sn("0123456789ABCDEF", ["CONFIG_ZMK_SPLIT=1"]), ["serial.c"]);
    expect((await Bun.$`${exe}`.text()).trim()).toBe("0011223344556677|16");
  });

  test("a template shorter than the chip ID is filled as far as it goes and never written past its end", async () => {
    const exe = await compile(harness, sn("ABCD", []), ["serial.c"]);
    expect((await Bun.$`${exe}`.text()).trim()).toBe("0011|4");
  });
});

describe.skipIf(!cc)("the port watcher", () => {
  // The harness runs the thread body (renamed from watch) against a scripted port: each step is (baud, dtr) as the poll sees it.
  const harness = (script: string, central: boolean) => `
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/sys/reboot.h>
#include <zmk/split/central.h>
struct device;
static const struct { uint32_t baud, dtr; } steps[] = { ${script} };
static unsigned n = 0, slept = 0, relays = 0, reboots = 0, resets = 0;
static uint32_t baud_now = 115200, dtr_now = 1, host_baud = 115200;
/* One host-side state per sleep. The host sets the rate only when it changes it, so a rate the firmware resets stays reset, as on a real port. */
static void advance(void) { if (n < sizeof(steps) / sizeof(steps[0])) { if (steps[n].baud != host_baud) { host_baud = steps[n].baud; baud_now = host_baud; } dtr_now = steps[n].dtr; } n++; }
int usb_enable(void *cb) { (void)cb; return 0; }
int k_sleep(int ms) { slept += ms; advance(); if (n > sizeof(steps) / sizeof(steps[0]) + 1) { printf("reboots=%u relays=%u resets=%u\\n", reboots, relays, resets); exit(0); } return 0; }
int64_t k_uptime_get(void) { return 0; }
bool device_is_ready(const struct device *d) { (void)d; return true; }
int uart_line_ctrl_get(const struct device *d, uint32_t c, uint32_t *v) { (void)d; *v = c == UART_LINE_CTRL_DTR ? dtr_now : baud_now; return 0; }
int uart_line_ctrl_set(const struct device *d, uint32_t c, uint32_t v) { (void)d; if (c == UART_LINE_CTRL_BAUD_RATE) { baud_now = v; resets++; } return 0; }
void sys_reboot(int t) { (void)t; reboots++; printf("reboots=%u relays=%u resets=%u\\n", reboots, relays, resets); exit(0); }
int zmk_split_central_invoke_behavior(uint8_t s, struct zmk_behavior_binding *b, struct zmk_behavior_binding_event e, bool st) {
  (void)s; (void)e; (void)st; if (b->behavior_dev[0] == 'b') relays++; return 0; }
#include "${SRC}/handsfree.c"
int main(void) { watch(0, 0, 0); return 0; }
`;
  const run = async (steps: string, central: boolean) => {
    const defines = ["CONFIG_ZMK_SPLIT=1", ...(central ? ["CONFIG_ZMK_SPLIT_ROLE_CENTRAL=1", "CONFIG_ZMK_USB=1"] : [])];
    const exe = await compile(harness(steps, central), defines, []);
    return (await Bun.$`${exe}`.text()).trim();
  };
  const closed = (baud: number, polls = 6) => Array.from({ length: polls }, () => `{ ${baud}, 0 }`).join(", ");

  test("the rates are the host's constants", () => {
    expect([LOCAL_BAUD, RELAY_BAUD]).toEqual([1200, 1201]);
  });

  test("a port closed at 1200 baud and still closed a poll later restarts this half", async () => {
    expect(await run(closed(1200), false)).toBe("reboots=1 relays=0 resets=0");
  });

  test("a port that is still open at 1200 baud (DTR high) never restarts it", async () => {
    expect(await run(Array.from({ length: 8 }, () => "{ 1200, 1 }").join(", "), false)).toBe("reboots=0 relays=0 resets=0");
  });

  test("a port that is closed at 1200 and reopened before the debounce ends cancels the touch", async () => {
    expect(await run("{ 1200, 0 }, { 1200, 1 }, { 1200, 1 }, { 115200, 1 }, { 115200, 1 }, { 115200, 1 }", false)).toBe("reboots=0 relays=0 resets=0");
  });

  test("any other rate, closed, does nothing", async () => {
    for (const baud of [9600, 115200, 1199, 1202]) expect(await run(closed(baud), true)).toBe("reboots=0 relays=0 resets=0");
  });

  test("on the central, 1201 closed relays once and sets the rate back so the next touch is seen as a change", async () => {
    expect(await run(closed(RELAY_BAUD), true)).toBe("reboots=0 relays=1 resets=1");
  });

  test("on a peripheral, 1201 relays nothing, but the rate is still reset so the touch is forgotten", async () => {
    expect(await run(closed(RELAY_BAUD), false)).toBe("reboots=0 relays=0 resets=1");
  });
});
