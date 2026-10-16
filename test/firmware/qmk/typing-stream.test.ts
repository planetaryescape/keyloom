// The typing lab's QMK stream (D-281). The C that goes into keymap.c is compiled for the host against stand-ins for QMK's headers and
// driven with a script of packets, key events and clock steps, so the cases that decide whether a keyboard can be trusted run for real:
// off at power-up, batching, the position table, and the three ways the stream switches itself off.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HOST_QUIET_MS, SESSION_LIMIT_MS, TYPING_COMMAND, decodeTypingReport, encodeEventsReport, encodeStatusReport, typingPacket, type TypingReport } from "../../../src/firmware/qmk/typing-stream.ts";
import { bootloaderPacket, wrapperSource } from "../../../src/firmware/qmk/handsfree.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { SLOW_RUNNER_MS } from "../../helpers/timeouts.ts";

const cc = Bun.which("cc") ?? Bun.which("gcc") ?? Bun.which("clang");

// Five keys on a 2x3 matrix: position 0..2 on row 0, 3..4 on row 1, and (1,2) is no key.
const HARNESS = `
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define MATRIX_ROWS 2
#define MATRIX_COLS 3
#define LAYOUT_t(a, b, c, d, e) {{a, b, c}, {d, e, 0}}
typedef enum { TICK_EVENT = 0, KEY_EVENT = 1 } keyevent_type_t;
typedef struct { uint8_t col; uint8_t row; } keypos_t;
typedef struct { keypos_t key; uint16_t time; keyevent_type_t type; bool pressed; } keyevent_t;
static uint32_t now_ms = 0, block_ms = 0;
static uint8_t sent[512][32];
static int sent_n = 0, real_exec = 0, forwarded = 0, resets = 0;
uint32_t timer_read32(void) { return now_ms; }
void raw_hid_send(uint8_t *d, uint8_t l) { (void)l; memcpy(sent[sent_n++], d, 32); now_ms += block_ms; }
void reset_keyboard(void) { resets++; }
void __real_raw_hid_receive(uint8_t *d, uint8_t l) { (void)d; (void)l; forwarded++; }
void __real_action_exec(keyevent_t e) { (void)e; real_exec++; }
@@WRAPPER@@
static int hexv(char c) { return c <= '9' ? c - '0' : c - 'a' + 10; }
int main(void) {
  char line[256];
  while (fgets(line, sizeof line, stdin)) {
    unsigned a, b, c;
    if (sscanf(line, "t %u", &a) == 1) now_ms = a;
    else if (sscanf(line, "block %u", &a) == 1) block_ms = a;
    else if (sscanf(line, "key %u %u %u", &a, &b, &c) == 3) { keyevent_t e = {{(uint8_t)b, (uint8_t)a}, 0, KEY_EVENT, c != 0}; __wrap_action_exec(e); }
    else if (sscanf(line, "other %u %u", &a, &b) == 2) { keyevent_t e = {{(uint8_t)b, (uint8_t)a}, 0, (keyevent_type_t)5, true}; __wrap_action_exec(e); }
    else if (strncmp(line, "tick", 4) == 0) { keyevent_t e = {{0, 0}, 0, TICK_EVENT, false}; __wrap_action_exec(e); }
    else if (strncmp(line, "rx ", 3) == 0) {
      uint8_t buf[32] = {0}; unsigned n = 0; const char *p = line + 3;
      while (p[0] && p[1] && p[0] != '\\n' && n < 32) { buf[n++] = (uint8_t)(hexv(p[0]) * 16 + hexv(p[1])); p += 2; }
      __wrap_raw_hid_receive(buf, (uint8_t)n);
    }
  }
  printf("real_exec=%d forwarded=%d resets=%d sent=%d\\n", real_exec, forwarded, resets, sent_n);
  for (int i = 0; i < sent_n; i++) { for (int j = 0; j < 32; j++) printf("%02x", sent[i][j]); printf("\\n"); }
  return 0;
}`;

type Outcome = { realExec: number; forwarded: number; resets: number; reports: TypingReport[] };
let exe: string | undefined;

async function build(): Promise<string> {
  if (exe) return exe;
  const dir = tempDir("keyloom-lab-");
  const source = HARNESS.replace("@@WRAPPER@@", wrapperSource({ layoutMacro: "LAYOUT_t", keyCount: 5 }));
  await Bun.write(join(dir, "harness.c"), source);
  const r = await Bun.$`${cc} -Wall -Werror -o ${join(dir, "harness")} ${join(dir, "harness.c")}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`the stream did not compile:\n${r.stderr.toString()}`);
  exe = join(dir, "harness");
  return exe;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function drive(...steps: string[]): Promise<Outcome> {
  const out = (await Bun.$`${await build()} < ${new Response(steps.join("\n") + "\n")}`.quiet().text()).trim().split("\n");
  const m = /real_exec=(\d+) forwarded=(\d+) resets=(\d+) sent=(\d+)/.exec(out[0] as string) as RegExpExecArray;
  const reports = out.slice(1).map((l) => decodeTypingReport(Uint8Array.from(l.match(/../g) as string[], (h) => Number.parseInt(h, 16))) as TypingReport);
  return { realExec: Number(m[1]), forwarded: Number(m[2]), resets: Number(m[3]), reports };
}
const rx = (action: "start" | "stop" | "keepalive") => `rx ${hex(typingPacket(action))}`;
const events = (r: TypingReport | undefined) => (r?.kind === "events" ? r.events : []);

describe.skipIf(!cc)("the firmware stream, compiled for the host", () => {
  test("is off at power-up: keys are passed on and nothing is sent", async () => {
    const o = await drive("t 100", "key 0 0 1", "t 150", "key 0 0 0", "tick");
    expect(o.reports).toEqual([]);
    expect(o.realExec).toBe(3);
  }, SLOW_RUNNER_MS);

  test("a start answers with a status, then reports keys by keyloom position with the keyboard's clock", async () => {
    const o = await drive("t 1000", rx("start"), "t 1010", "key 0 1 1", "t 1012", "key 1 0 1", "t 1015", "key 0 1 0", "t 1020", "tick");
    expect(o.reports[0]).toMatchObject({ kind: "status", on: true, deviceMs: 1000 });
    expect(o.reports).toHaveLength(2);
    expect(events(o.reports[1])).toEqual([
      { position: 1, pressed: true, atMs: 1010 },
      { position: 3, pressed: true, atMs: 1012 },
      { position: 1, pressed: false, atMs: 1015 },
    ]);
    expect(o.realExec).toBe(4);
  }, SLOW_RUNNER_MS);

  test("a full batch is sent at once and a part-full one waits for its flush time", async () => {
    const o = await drive(rx("start"), ...[0, 1, 2, 3].flatMap((p, i) => [`t ${10 + i}`, `key ${p < 3 ? 0 : 1} ${p % 3} 1`]), "t 14", "key 1 1 1");
    expect(o.reports.map((r) => r.kind)).toEqual(["status", "events"]);
    expect(events(o.reports[1]).map((e) => e.position)).toEqual([0, 1, 2, 3, 4]);
    const part = await drive(rx("start"), "t 10", "key 0 0 1", "t 17", "tick", "t 18", "tick");
    expect(part.reports.map((r) => r.kind)).toEqual(["status", "events"]);
    expect(events(part.reports[1])).toEqual([{ position: 0, pressed: true, atMs: 10 }]);
  }, SLOW_RUNNER_MS);

  test("a cell with no key and an event that is not a key are ignored but still reach QMK", async () => {
    const o = await drive(rx("start"), "t 5", "key 1 2 1", "other 0 0", "t 20", "tick");
    expect(o.reports.map((r) => r.kind)).toEqual(["status"]);
    expect(o.realExec).toBe(3);
  }, SLOW_RUNNER_MS);

  test("a stop packet ends the stream with its reason, and later keys are not reported", async () => {
    const o = await drive(rx("start"), "t 10", rx("stop"), "t 20", "key 0 0 1", "t 40", "tick");
    expect(o.reports).toHaveLength(2);
    expect(o.reports[1]).toMatchObject({ kind: "status", on: false, reason: "the host asked" });
  }, SLOW_RUNNER_MS);

  test("the stream ends at the time limit even when the host keeps answering", async () => {
    const steps = ["t 0", rx("start")];
    for (let t = 1000; t <= SESSION_LIMIT_MS + 1000; t += 1000) steps.push(`t ${t}`, rx("keepalive"));
    steps.push(`t ${SESSION_LIMIT_MS + 1500}`, "tick");
    const o = await drive(...steps);
    expect(o.reports.at(-1)).toMatchObject({ kind: "status", on: false, reason: "the 10 minute limit" });
  }, SLOW_RUNNER_MS);

  test("the stream ends when the host stops sending keepalives, and keepalives hold it open", async () => {
    const quiet = await drive("t 0", rx("start"), `t ${HOST_QUIET_MS + 1}`, "tick");
    expect(quiet.reports.at(-1)).toMatchObject({ kind: "status", on: false, reason: "the host stopped answering" });
    const alive = await drive("t 0", rx("start"), "t 2000", rx("keepalive"), "t 4000", rx("keepalive"), "t 5500", "tick");
    expect(alive.reports).toHaveLength(1);
  }, SLOW_RUNNER_MS);

  test("a send that blocks means nobody reads: the stream stops silently instead of stalling the keyboard on every key", async () => {
    const o = await drive(rx("start"), "block 100", "t 10", "key 0 0 1", "t 20", "tick", "t 40", "key 0 1 1", "t 60", "tick");
    // The status for the start went out before the host stopped reading; one blocked report, then nothing more is sent.
    expect(o.reports.map((r) => r.kind)).toEqual(["status", "events"]);
  }, SLOW_RUNNER_MS);

  test("a stray start while the stream is on is a keepalive, not a second stream", async () => {
    const o = await drive("t 0", rx("start"), "t 2000", rx("start"), "t 4000", "tick");
    expect(o.reports).toHaveLength(1);
  }, SLOW_RUNNER_MS);

  test("the bootloader command and Oryx's packets still behave as before, and a short lab packet is passed on", async () => {
    const o = await drive(`rx ${hex(bootloaderPacket())}`, "rx fe0000", `rx ${hex(typingPacket("start")).slice(0, 18)}`);
    expect(o).toMatchObject({ resets: 1, forwarded: 2, reports: [] });
  }, SLOW_RUNNER_MS);
});

describe("the report format", () => {
  test("round-trips events with their timestamps, including a timer that wrapped", () => {
    const at = 0xffff_fff0;
    const report = encodeEventsReport(7, [{ position: 71, pressed: true, atMs: at }, { position: 3, pressed: false, atMs: at + 0x20 }], 2);
    expect(report).toHaveLength(32);
    expect(report[0]).toBe(TYPING_COMMAND);
    expect(decodeTypingReport(report)).toEqual({ kind: "events", seq: 7, dropped: 2, events: [{ position: 71, pressed: true, atMs: at }, { position: 3, pressed: false, atMs: (at + 0x20) >>> 0 }] });
  });

  test("a status report says why the stream stopped", () => {
    expect(decodeTypingReport(encodeStatusReport(1, false, 4242, 2))).toEqual({ kind: "status", seq: 1, on: false, reason: "the host stopped answering", deviceMs: 4242 });
  });

  test("other software's reports are not ours", () => {
    const oryx = new Uint8Array(32);
    oryx[0] = 0xfe;
    expect(decodeTypingReport(oryx)).toBeUndefined();
    expect(decodeTypingReport(new Uint8Array(8))).toBeUndefined();
    const bad = encodeEventsReport(0, [{ position: 0, pressed: true, atMs: 0 }]);
    bad[3] = 9;
    expect(decodeTypingReport(bad)).toBeUndefined();
  });

  test("the command byte is not one Oryx, VIA or keyloom's bootloader answers to", () => {
    expect([0xfe, 0xff, 0xe7]).not.toContain(TYPING_COMMAND);
    expect(TYPING_COMMAND).toBeGreaterThan(0x15);
  });
});
