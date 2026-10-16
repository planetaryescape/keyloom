// firmware/zmk/keyloom-zmk/src/typing.c compiled for the host against stand-ins for Zephyr and ZMK, and driven with a script of
// commands, key events, clock steps and port states. The Docker builds prove it links into the Glove80 and the Corne; this proves what it does.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TYPING_PING, TYPING_START, TYPING_STOP, parseStreamLine, SESSION_LIMIT_MS, HOST_QUIET_MS, eventLine } from "../../../src/firmware/zmk/typing-stream.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { SLOW_RUNNER_MS } from "../../helpers/timeouts.ts";

const SRC = `${import.meta.dir}/../../../firmware/zmk/keyloom-zmk/src`;
const cc = Bun.which("cc") ?? Bun.which("gcc") ?? Bun.which("clang");

const STUBS: Record<string, string> = {
  "zephyr/kernel.h": `
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
#define _XXXX1 _YYYY,
#define Z_IS_ENABLED1(m) Z_IS_ENABLED2(_XXXX##m)
#define Z_IS_ENABLED2(a) Z_IS_ENABLED3(a 1, 0)
#define Z_IS_ENABLED3(ignore, val, ...) val
#define IS_ENABLED(m) Z_IS_ENABLED1(m)
#define ARG_UNUSED(x) (void)(x)
#define K_MSEC(ms) (ms)
#define K_NO_WAIT 0
#define K_LOWEST_APPLICATION_THREAD_PRIO 0
#define DEVICE_DT_GET(x) ((const struct device *)0)
#define DT_NODELABEL(x) x
#define CONFIG_KEYLOOM_HANDSFREE_STACK_SIZE 2048
#define K_THREAD_DEFINE(name, stack, fn, ...) void (*name##_fn)(void *, void *, void *) = fn
struct device;
int k_sleep(int ms);
int64_t k_uptime_get(void);
bool device_is_ready(const struct device *d);
struct k_msgq { size_t size; unsigned max; unsigned used; unsigned char buf[128 * 32]; };
#define K_MSGQ_DEFINE(name, msg_size, max_msgs, align) struct k_msgq name = {msg_size, max_msgs, 0, {0}}
static inline int k_msgq_put(struct k_msgq *q, const void *d, int t) { (void)t; if (q->used == q->max) return -35; memcpy(q->buf + q->used * q->size, d, q->size); q->used++; return 0; }
static inline int k_msgq_get(struct k_msgq *q, void *d, int t) { (void)t; if (q->used == 0) return -35; memcpy(d, q->buf, q->size); memmove(q->buf, q->buf + q->size, (q->used - 1) * q->size); q->used--; return 0; }
static inline void k_msgq_purge(struct k_msgq *q) { q->used = 0; }
`,
  "zephyr/device.h": `#pragma once\n#include <zephyr/kernel.h>\n`,
  "zephyr/sys/printk.h": `#pragma once\n#include <stdio.h>\n#define snprintk snprintf\n`,
  "zephyr/drivers/uart.h": `
#pragma once
#include <zephyr/kernel.h>
#define UART_LINE_CTRL_DTR 4
int uart_line_ctrl_get(const struct device *d, uint32_t ctrl, uint32_t *val);
int uart_irq_update(const struct device *d);
int uart_irq_rx_ready(const struct device *d);
int uart_fifo_read(const struct device *d, uint8_t *buf, int n);
void uart_irq_callback_user_data_set(const struct device *d, void (*cb)(const struct device *, void *), void *u);
void uart_irq_rx_enable(const struct device *d);
void uart_poll_out(const struct device *d, unsigned char c);
`,
  "zmk/event_manager.h": `
#pragma once
#include <zephyr/kernel.h>
typedef struct { int unused; } zmk_event_t;
#define ZMK_EV_EVENT_BUBBLE 0
#define ZMK_LISTENER(name, cb)
#define ZMK_SUBSCRIPTION(name, ev)
#define ZMK_EVENT_DECLARE(ev)
`,
  "zmk/events/position_state_changed.h": `
#pragma once
#include <zmk/event_manager.h>
struct zmk_position_state_changed { uint8_t source; uint32_t position; bool state; int64_t timestamp; };
#define as_zmk_position_state_changed(eh) ((const struct zmk_position_state_changed *)(eh))
`,
};

const hex = (s: string) => [...Buffer.from(s)].map((b) => b.toString(16).padStart(2, "0")).join("");

const HARNESS = `
#include <stdio.h>
#include <stdlib.h>
#include <zephyr/drivers/uart.h>
#include <zmk/events/position_state_changed.h>
static int64_t now = 0;
static uint32_t dtr_now = 1;
static unsigned char out[8192];
static size_t out_n = 0;
int k_sleep(int ms) { (void)ms; return 0; }
int64_t k_uptime_get(void) { return now; }
bool device_is_ready(const struct device *d) { (void)d; return true; }
int uart_line_ctrl_get(const struct device *d, uint32_t c, uint32_t *v) { (void)d; (void)c; *v = dtr_now; return 0; }
int uart_irq_update(const struct device *d) { (void)d; return 1; }
int uart_irq_rx_ready(const struct device *d) { (void)d; return 0; }
int uart_fifo_read(const struct device *d, uint8_t *b, int n) { (void)d; (void)b; (void)n; return 0; }
void uart_irq_callback_user_data_set(const struct device *d, void (*cb)(const struct device *, void *), void *u) { (void)d; (void)cb; (void)u; }
void uart_irq_rx_enable(const struct device *d) { (void)d; }
void uart_poll_out(const struct device *d, unsigned char c) { (void)d; if (out_n < sizeof out) out[out_n++] = c; }
#include "${SRC}/typing.c"
static int hexv(char c) { return c <= '9' ? c - '0' : c - 'a' + 10; }
int main(void) {
  char line[512];
  while (fgets(line, sizeof line, stdin)) {
    unsigned a, b, c;
    if (sscanf(line, "t %u", &a) == 1) now = a;
    else if (sscanf(line, "dtr %u", &a) == 1) dtr_now = a;
    else if (sscanf(line, "ev %u %u %u", &a, &b, &c) == 3) {
      struct zmk_position_state_changed e = {(uint8_t)c, a, b != 0, now};
      keyloom_typing_listener((const zmk_event_t *)&e);
    }
    else if (strncmp(line, "step", 4) == 0) lab_step();
    else if (strncmp(line, "feed ", 5) == 0) { for (const char *p = line + 5; p[0] && p[1] && p[0] != '\\n'; p += 2) lab_feed((uint8_t)(hexv(p[0]) * 16 + hexv(p[1]))); }
  }
  fwrite(out, 1, out_n, stdout);
  return 0;
}`;

let exe: string | undefined;
async function build(): Promise<string> {
  if (exe) return exe;
  const dir = tempDir("keyloom-typing-c-");
  for (const [path, text] of Object.entries(STUBS)) await Bun.write(join(dir, "inc", path), text);
  await Bun.write(join(dir, "harness.c"), HARNESS);
  const r = await Bun.$`${cc} -Wall -Werror -I${join(dir, "inc")} -DCONFIG_ZMK_SPLIT=1 -DCONFIG_ZMK_SPLIT_ROLE_CENTRAL=1 -o ${join(dir, "harness")} ${join(dir, "harness.c")}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`typing.c did not compile:\n${r.stderr.toString()}`);
  exe = join(dir, "harness");
  return exe;
}

async function drive(...steps: string[]): Promise<string[]> {
  const text = await Bun.$`${await build()} < ${new Response(steps.join("\n") + "\n")}`.quiet().text();
  return text.split("\n").filter((l) => l !== "");
}
const feed = (text: string) => `feed ${hex(text)}`;
const START = feed(TYPING_START);
const PING = feed(TYPING_PING);
const STOP = feed(TYPING_STOP);

describe.skipIf(!cc)("the ZMK stream, compiled for the host", () => {
  test("is off at power-up: key events and steps send nothing", async () => {
    expect(await drive("t 5", "ev 3 1 255", "step", "t 10", "ev 3 0 255", "step")).toEqual([]);
  }, SLOW_RUNNER_MS);

  test("a start answers with the clock, then each key is one line with its position, state, time and source", async () => {
    const out = await drive("t 1000", START, "step", "t 1010", "ev 41 1 255", "t 1030", "ev 7 1 0", "t 1060", "ev 41 0 255", "step");
    expect(out).toEqual(["KLTYPE ON 1000", "E 41 1 1010 255", "E 7 1 1030 0", "E 41 0 1060 255"]);
    expect(out.map((l) => parseStreamLine(l)?.kind)).toEqual(["on", "event", "event", "event"]);
  }, SLOW_RUNNER_MS);

  test("a stop ends it with its reason, and a later key is not sent", async () => {
    expect(await drive("t 0", START, "step", STOP, "step", "ev 1 1 255", "step")).toEqual(["KLTYPE ON 0", "KLTYPE OFF 0"]);
  }, SLOW_RUNNER_MS);

  test("keys that arrive before a start are not sent after it", async () => {
    expect(await drive("t 0", "ev 1 1 255", START, "step", "ev 2 1 255", "step")).toEqual(["KLTYPE ON 0", "E 2 1 0 255"]);
  }, SLOW_RUNNER_MS);

  test("pings hold it open past the quiet time and silence ends it", async () => {
    const alive = await drive("t 0", START, "step", "t 2000", PING, "step", "t 4000", PING, "step", "t 5500", "step");
    expect(alive).toEqual(["KLTYPE ON 0"]);
    const quiet = await drive("t 0", START, "step", `t ${HOST_QUIET_MS + 1}`, "step");
    expect(quiet).toEqual(["KLTYPE ON 0", "KLTYPE OFF 2"]);
  }, SLOW_RUNNER_MS);

  test("it ends at the time limit however well the host pings", async () => {
    const steps = ["t 0", START, "step"];
    for (let t = 1000; t <= SESSION_LIMIT_MS + 1000; t += 1000) steps.push(`t ${t}`, PING, "step");
    expect((await drive(...steps)).at(-1)).toBe("KLTYPE OFF 1");
  }, SLOW_RUNNER_MS);

  test("a closed port ends it without writing to the port", async () => {
    expect(await drive("t 0", START, "step", "dtr 0", "t 10", "ev 1 1 255", "step")).toEqual(["KLTYPE ON 0"]);
  }, SLOW_RUNNER_MS);

  test("events the queue had no room for are counted, and the count comes before the next event", async () => {
    const events = Array.from({ length: 70 }, (_, i) => `ev ${i % 10} 1 255`);
    const out = await drive("t 0", START, "step", ...events, "step");
    expect(out[0]).toBe("KLTYPE ON 0");
    expect(out.filter((l) => l.startsWith("E "))).toHaveLength(64);
    expect(out).toContain("KLTYPE DROP 6");
    expect(out.indexOf("KLTYPE DROP 6")).toBe(1);
  }, SLOW_RUNNER_MS);

  test("a second start while on does not restart it, and unknown or over-long lines are ignored", async () => {
    const out = await drive("t 0", START, "step", feed("hello\n"), feed(`${"x".repeat(80)}\n`), START, "step", "ev 5 1 255", "step");
    expect(out).toEqual(["KLTYPE ON 0", "E 5 1 0 255"]);
  }, SLOW_RUNNER_MS);

  test("a command split across reads still works", async () => {
    const out = await drive("t 0", feed("KLTYP"), feed("E START\n"), "step");
    expect(out).toEqual(["KLTYPE ON 0"]);
  }, SLOW_RUNNER_MS);
});

describe("the line format", () => {
  test("parses what the firmware writes and nothing else", () => {
    expect(parseStreamLine(eventLine(12, true, 5000))).toEqual({ kind: "event", position: 12, pressed: true, deviceMs: 5000, source: 255 });
    expect(parseStreamLine("KLTYPE OFF 2")).toEqual({ kind: "off", reason: "the host stopped answering" });
    expect(parseStreamLine("KLTYPE DROP 3")).toEqual({ kind: "drop", count: 3 });
    expect(parseStreamLine("E 1 2 3 4")).toBeUndefined();
    expect(parseStreamLine("E 5 1")).toBeUndefined();
    expect(parseStreamLine("hello")).toBeUndefined();
  });
});
