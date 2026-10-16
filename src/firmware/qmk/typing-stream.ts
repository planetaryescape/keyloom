// The typing lab's key-event stream on a ZSA keyboard (D-281, 24-typing-lab.md): a second raw-HID command beside the
// bootloader one (handsfree.ts). The host turns the stream on, the firmware reports every matrix press and release with
// its own millisecond clock, and the stream turns itself off after a time limit or when the host stops answering.
// The C below and the decoder here read their constants from this file so they cannot drift apart.
import { RAW_HID_REPORT_SIZE } from "../toolchain/hid.ts";

/** First byte of every lab packet, both ways. Oryx's commands are 0x00-0x0C and 0xFE, VIA's 0x01-0x15 and 0xFF, keyloom's bootloader one 0xE7. */
export const TYPING_COMMAND = 0xe8;
/** Eight bytes after the command byte in a packet from the host, so a stray packet from other software never starts a stream. */
export const TYPING_MAGIC = "KLTYPING";
export const TYPING_ACTION = { stop: 0, start: 1, keepalive: 2 } as const;
export type TypingAction = keyof typeof TYPING_ACTION;

/** The stream stops this long after it started, however the host behaves (D-281: a forgotten session must not run forever). */
export const SESSION_LIMIT_MS = 10 * 60_000;
/** The stream stops when the host has not sent a start or keepalive for this long, so a closed or crashed host ends it. */
export const HOST_QUIET_MS = 3000;
/** The host sends a keepalive this often; well inside HOST_QUIET_MS so one lost packet does not end the stream. */
export const KEEPALIVE_MS = 1000;
/** A raw_hid_send that blocks this long means nobody is reading the endpoint (QMK's send waits up to 100 ms), and typing would lag. */
export const SLOW_SEND_MS = 20;
/** Events wait this long for company before a report is sent, bounding how late the host hears of a key. */
export const FLUSH_MS = 8;
export const EVENTS_PER_REPORT = 5;
const RING_SIZE = 64;

const TYPE_EVENTS = 1;
const TYPE_STATUS = 2;
const HEADER_BYTES = 8;
const EVENT_BYTES = 4;
const DROPPED_AT = HEADER_BYTES + EVENTS_PER_REPORT * EVENT_BYTES;

/** Why the firmware turned the stream off, as it reports it. */
export const STOP_REASONS = ["the host asked", "the 10 minute limit", "the host stopped answering", "the host stopped reading reports"] as const;

function packet(action: number): Uint8Array {
  const p = new Uint8Array(RAW_HID_REPORT_SIZE);
  p[0] = TYPING_COMMAND;
  p.set(new TextEncoder().encode(TYPING_MAGIC), 1);
  p[1 + TYPING_MAGIC.length] = action;
  return p;
}

/** The packet for a start, a stop or a keepalive. A start while the stream is on counts as a keepalive. */
export const typingPacket = (action: TypingAction): Uint8Array => packet(TYPING_ACTION[action]);

export type TypingEvent = { position: number; pressed: boolean; /** The keyboard's timer_read32() when the matrix changed. */ atMs: number };

export type TypingReport =
  | { kind: "events"; seq: number; events: TypingEvent[]; /** Events the firmware had no room to hold since its last report (saturates at 255). */ dropped: number }
  | { kind: "status"; seq: number; on: boolean; reason: (typeof STOP_REASONS)[number] | undefined; deviceMs: number };

/** A report from the keyboard, or undefined when it is not one of ours (Oryx and VIA answer on the same endpoint). */
export function decodeTypingReport(bytes: Uint8Array): TypingReport | undefined {
  if (bytes.length < RAW_HID_REPORT_SIZE || bytes[0] !== TYPING_COMMAND) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seq = bytes[2] as number;
  if (bytes[1] === TYPE_STATUS) {
    const on = bytes[3] === 1;
    return { kind: "status", seq, on, reason: on ? undefined : STOP_REASONS[bytes[4] as number], deviceMs: view.getUint32(5, true) };
  }
  if (bytes[1] !== TYPE_EVENTS) return undefined;
  const count = bytes[3] as number;
  if (count > EVENTS_PER_REPORT) return undefined;
  const base = view.getUint32(4, true);
  const events: TypingEvent[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_BYTES + i * EVENT_BYTES;
    events.push({ position: bytes[at] as number, pressed: ((bytes[at + 1] as number) & 1) === 1, atMs: (base + view.getUint16(at + 2, true)) >>> 0 });
  }
  return { kind: "events", seq, events, dropped: bytes[DROPPED_AT] as number };
}

/** Builds a report as the firmware would, for tests and for the fake keyboard the CLI's end-to-end test uses. */
export function encodeEventsReport(seq: number, events: readonly TypingEvent[], dropped = 0): Uint8Array {
  if (events.length === 0 || events.length > EVENTS_PER_REPORT) throw new Error(`a report holds 1 to ${EVENTS_PER_REPORT} events, not ${events.length}`);
  const p = new Uint8Array(RAW_HID_REPORT_SIZE);
  const view = new DataView(p.buffer);
  const base = (events[0] as TypingEvent).atMs >>> 0;
  p[0] = TYPING_COMMAND;
  p[1] = TYPE_EVENTS;
  p[2] = seq & 0xff;
  p[3] = events.length;
  view.setUint32(4, base, true);
  events.forEach((e, i) => {
    const dt = (e.atMs - base) >>> 0;
    if (dt > 0xffff) throw new Error("events in one report must be within 65 seconds of the first");
    const at = HEADER_BYTES + i * EVENT_BYTES;
    p[at] = e.position;
    p[at + 1] = e.pressed ? 1 : 0;
    view.setUint16(at + 2, dt, true);
  });
  p[DROPPED_AT] = Math.min(dropped, 255);
  return p;
}

export function encodeStatusReport(seq: number, on: boolean, deviceMs: number, reasonIndex = 0): Uint8Array {
  const p = new Uint8Array(RAW_HID_REPORT_SIZE);
  p[0] = TYPING_COMMAND;
  p[1] = TYPE_STATUS;
  p[2] = seq & 0xff;
  p[3] = on ? 1 : 0;
  p[4] = reasonIndex;
  new DataView(p.buffer).setUint32(5, deviceMs >>> 0, true);
  return p;
}

/** Added to rules.mk beside the raw_hid_receive wrap so the linker routes the matrix scan's action_exec calls to the recorder. */
export const WRAP_ACTION_EXEC_FLAG = "LDFLAGS += -Wl,--wrap=action_exec";
export const STREAM_SYMBOL = "__wrap_action_exec";

const hex = (n: number): string => `0x${n.toString(16)}`;

/**
 * The firmware half. `action_exec` is called once for every matrix press and release (quantum/keyboard.c matrix_task) and
 * once a millisecond with a tick, which is where a part-full batch is sent. The matrix position becomes a keyloom position
 * through the board's own layout macro: each cell of the table holds its key's position plus one, and zero where no key is.
 * Called by `__wrap_raw_hid_receive` for packets that carry the lab's command byte.
 */
export function streamSource(layoutMacro: string, keyCount: number): string {
  const args = Array.from({ length: keyCount }, (_, i) => String(i + 1)).join(", ");
  const magic = [...new TextEncoder().encode(TYPING_MAGIC)].map((b) => `'${String.fromCharCode(b)}'`).join(", ");
  return [
    "// keyloom typing lab (D-281): when the host asks, every key press and release is reported over raw HID with the keyboard's own clock.",
    "// Off at power-up. It switches itself off after the time limit, when the host stops sending keepalives, or when sending blocks.",
    `#define KEYLOOM_LAB_COMMAND ${hex(TYPING_COMMAND)}`,
    `#define KEYLOOM_LAB_SESSION_MS ${SESSION_LIMIT_MS}UL`,
    `#define KEYLOOM_LAB_QUIET_MS ${HOST_QUIET_MS}UL`,
    `#define KEYLOOM_LAB_SLOW_SEND_MS ${SLOW_SEND_MS}UL`,
    `#define KEYLOOM_LAB_FLUSH_MS ${FLUSH_MS}UL`,
    `#define KEYLOOM_LAB_PER_REPORT ${EVENTS_PER_REPORT}`,
    `#define KEYLOOM_LAB_RING ${RING_SIZE}`,
    `static const uint8_t keyloom_lab_magic[] = {${magic}};`,
    `static const uint8_t keyloom_lab_position[MATRIX_ROWS][MATRIX_COLS] = ${layoutMacro}(${args});`,
    "typedef struct { uint32_t at; uint8_t position; uint8_t pressed; } keyloom_lab_event;",
    "static keyloom_lab_event keyloom_lab_ring[KEYLOOM_LAB_RING];",
    "static uint8_t keyloom_lab_tail, keyloom_lab_count, keyloom_lab_dropped, keyloom_lab_seq;",
    "static bool keyloom_lab_on;",
    "static uint32_t keyloom_lab_started, keyloom_lab_heard;",
    "",
    "// Returns false when the send blocked: the host is not reading, and waiting for it would stall the keyboard.",
    "static bool keyloom_lab_send(uint8_t *report) {",
    "  const uint32_t before = timer_read32();",
    "  raw_hid_send(report, 32);",
    "  return timer_read32() - before < KEYLOOM_LAB_SLOW_SEND_MS;",
    "}",
    "",
    "static void keyloom_lab_status(uint8_t on, uint8_t reason) {",
    "  uint8_t r[32] = {0};",
    "  const uint32_t now = timer_read32();",
    "  r[0] = KEYLOOM_LAB_COMMAND;",
    "  r[1] = 2;",
    "  r[2] = keyloom_lab_seq++;",
    "  r[3] = on;",
    "  r[4] = reason;",
    "  r[5] = now; r[6] = now >> 8; r[7] = now >> 16; r[8] = now >> 24;",
    "  keyloom_lab_send(r);",
    "}",
    "",
    "// reason 3 is a host that stopped reading: the status would block the same way, so it is not sent.",
    "static void keyloom_lab_stop(uint8_t reason) {",
    "  if (!keyloom_lab_on) return;",
    "  keyloom_lab_on = false;",
    "  keyloom_lab_count = 0;",
    "  if (reason != 3) keyloom_lab_status(0, reason);",
    "}",
    "",
    "static void keyloom_lab_flush(void) {",
    "  uint8_t r[32] = {0};",
    "  const uint32_t base = keyloom_lab_ring[keyloom_lab_tail].at;",
    "  uint8_t n = 0;",
    "  while (n < KEYLOOM_LAB_PER_REPORT && n < keyloom_lab_count) {",
    "    const keyloom_lab_event *e = &keyloom_lab_ring[(keyloom_lab_tail + n) % KEYLOOM_LAB_RING];",
    "    const uint32_t dt = e->at - base;",
    "    if (dt > 0xffff) break;",
    "    r[8 + 4 * n] = e->position;",
    "    r[9 + 4 * n] = e->pressed;",
    "    r[10 + 4 * n] = dt;",
    "    r[11 + 4 * n] = dt >> 8;",
    "    n++;",
    "  }",
    "  r[0] = KEYLOOM_LAB_COMMAND;",
    "  r[1] = 1;",
    "  r[2] = keyloom_lab_seq++;",
    "  r[3] = n;",
    "  r[4] = base; r[5] = base >> 8; r[6] = base >> 16; r[7] = base >> 24;",
    `  r[${DROPPED_AT}] = keyloom_lab_dropped;`,
    "  keyloom_lab_dropped = 0;",
    "  keyloom_lab_tail = (keyloom_lab_tail + n) % KEYLOOM_LAB_RING;",
    "  keyloom_lab_count -= n;",
    "  if (!keyloom_lab_send(r)) keyloom_lab_stop(3);",
    "}",
    "",
    "// True when the packet was the lab's, so the caller does not pass it on to Oryx.",
    "static bool keyloom_lab_receive(uint8_t *data, uint8_t length) {",
    "  if (length <= sizeof(keyloom_lab_magic) + 1 || data[0] != KEYLOOM_LAB_COMMAND || memcmp(data + 1, keyloom_lab_magic, sizeof(keyloom_lab_magic)) != 0) return false;",
    "  const uint32_t now = timer_read32();",
    `  const uint8_t action = data[1 + sizeof(keyloom_lab_magic)];`,
    `  if (action == ${TYPING_ACTION.start}) {`,
    "    if (!keyloom_lab_on) {",
    "      keyloom_lab_on = true;",
    "      keyloom_lab_started = now;",
    "      keyloom_lab_tail = keyloom_lab_count = keyloom_lab_dropped = 0;",
    "      keyloom_lab_status(1, 0);",
    "    }",
    "    keyloom_lab_heard = now;",
    `  } else if (action == ${TYPING_ACTION.keepalive}) {`,
    "    if (keyloom_lab_on) keyloom_lab_heard = now;",
    `  } else if (action == ${TYPING_ACTION.stop}) {`,
    "    keyloom_lab_stop(0);",
    "  }",
    "  return true;",
    "}",
    "",
    "void __real_action_exec(keyevent_t event);",
    "void __wrap_action_exec(keyevent_t event) {",
    "  if (keyloom_lab_on) {",
    "    const uint32_t now = timer_read32();",
    "    if (now - keyloom_lab_heard > KEYLOOM_LAB_QUIET_MS) {",
    "      keyloom_lab_stop(2);",
    "    } else if (now - keyloom_lab_started > KEYLOOM_LAB_SESSION_MS) {",
    "      keyloom_lab_stop(1);",
    "    } else {",
    "      if (event.type == KEY_EVENT && event.key.row < MATRIX_ROWS && event.key.col < MATRIX_COLS && keyloom_lab_position[event.key.row][event.key.col] != 0) {",
    "        if (keyloom_lab_count == KEYLOOM_LAB_RING) {",
    "          if (keyloom_lab_dropped < 255) keyloom_lab_dropped++;",
    "        } else {",
    "          keyloom_lab_event *e = &keyloom_lab_ring[(keyloom_lab_tail + keyloom_lab_count) % KEYLOOM_LAB_RING];",
    "          e->at = now;",
    "          e->position = keyloom_lab_position[event.key.row][event.key.col] - 1;",
    "          e->pressed = event.pressed;",
    "          keyloom_lab_count++;",
    "        }",
    "      }",
    "      if (keyloom_lab_count >= KEYLOOM_LAB_PER_REPORT || (keyloom_lab_count > 0 && now - keyloom_lab_ring[keyloom_lab_tail].at >= KEYLOOM_LAB_FLUSH_MS)) keyloom_lab_flush();",
    "    }",
    "  }",
    "  __real_action_exec(event);",
    "}",
  ].join("\n");
}
