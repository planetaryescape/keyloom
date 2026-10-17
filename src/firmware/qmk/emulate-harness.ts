// The files `keyloom emulate` adds to QMK's own host test harness (platforms/test, tests/test_common,
// gtest) so the generated keymap.c runs on the real QMK core on this machine (05#emulate). They are
// strings, not template files, because the released CLI is one compiled binary.
import type { GeneratedFile } from "./generate.ts";

/** Features that change what keys send. Everything else in rules.mk is hardware (RGB, audio, split, USB protocols) and is left out. */
export const CARRIED_FEATURES: readonly string[] = [
  "COMBO_ENABLE", "TAP_DANCE_ENABLE", "SPACE_CADET_ENABLE", "KEY_OVERRIDE_ENABLE", "LEADER_ENABLE", "CAPS_WORD_ENABLE", "REPEAT_KEY_ENABLE",
  "AUTO_SHIFT_ENABLE", "GRAVE_ESC_ENABLE", "LAYER_LOCK_ENABLE", "DYNAMIC_MACRO_ENABLE", "SECURE_ENABLE", "PROGRAMMABLE_BUTTON_ENABLE",
  "DEFERRED_EXEC_ENABLE", "MOUSEKEY_ENABLE", "EXTRAKEY_ENABLE",
];

/** Features the Moonlander (and nearly every board) has, switched on so mouse and media keys in a layout still compile and report. */
const ALWAYS_ON = ["EXTRAKEY_ENABLE", "MOUSEKEY_ENABLE"];

const FEATURE_LINE = /^\s*([A-Z][A-Z0-9_]*)\s*[:?]?=\s*(\S+)\s*(?:#.*)?$/;

export type RulesSplit = { carried: string; dropped: string[] };

/**
 * rules.mk as the emulator uses it: the carried features, as plain `NAME = value` lines. Anything else
 * (SRC additions, hardware drivers, includes) is returned in `dropped` so the result can say so.
 */
export function carriedRules(rulesMk: string | undefined): RulesSplit {
  const lines: string[] = [];
  const dropped: string[] = [];
  for (const raw of (rulesMk ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = FEATURE_LINE.exec(line);
    if (m?.[1] && CARRIED_FEATURES.includes(m[1]) && (m[2] === "yes" || m[2] === "no")) lines.push(`${m[1]} = ${m[2]}`);
    else if (m?.[1] && m[2] === "no") continue; // a hardware feature turned off is what the emulator does anyway
    else dropped.push(line);
  }
  return { carried: `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, dropped };
}

/**
 * QMK's test names can't contain `-`. Each run gets a folder of its own: on Colima a container read a rewritten
 * events.txt cut to the previous run's length (14-decision-log.md D-081).
 */
export const harnessName = (qmkTarget: string, runId: string): string => `keyloom_emu_${qmkTarget.replace(/[^A-Za-z0-9]/g, "_")}_${runId}`;

export const OUTPUT_BEGIN = "@@keyloom-emulate-output-begin";
export const OUTPUT_END = "@@keyloom-emulate-output-end";

export type HarnessInput = {
  name: string;
  /** The generated keymap folder's files. */
  keymapFiles: readonly GeneratedFile[];
  /** `LAYOUT_moonlander`: the macro whose argument order is the position order. */
  layoutMacro: string;
  keyCount: number;
  /** ZSA's Oryx keymaps call into RGB, raw HID and keyboard-config code that only exists on the keyboard. */
  zsa: boolean;
  /** Community modules the board builds with; `zsa/defaults` supplies ZSA's keycodes. */
  modules: readonly string[];
  /** The `qmk compile -kb` target (`zsa/moonlander/reva`), which a real build passes to the compiler as QMK_KEYBOARD (D-377). */
  qmkTarget: string;
};

const TEST_MK = (name: string, rules: string): string => `CUSTOM_MATRIX = yes
KEYCODE_STRING_ENABLE = yes
# The generated keymap.c is built for a keyboard; its unused-function and similar warnings are not the emulator's to fail on.
ALLOW_WARNINGS = yes
${rules}SRC += tests/${name}/stubs.c
# ZSA's fork uses _Static_assert in report.h, which g++ doesn't know.
CXXFLAGS += -D_Static_assert=static_assert
`;

const BOARD_HEADER_ZSA = (modules: readonly string[]): string => `#pragma once
#include "keyloom_layout.h"
#include "color.h"
${modules.includes("zsa/defaults") ? '#include "../../modules/zsa/defaults/defaults.h"\n' : ""}
// Stand-ins for what Oryx's keymap.c reads from moonlander.h, the oryx module and the RGB driver. They are output only.
typedef union {
  uint32_t raw;
  struct {
    bool         disable_layer_led   :1;
    bool         rgb_matrix_enable   :1;
    bool         led_level           :1;
    uint8_t      led_level_res       :2;
  };
} keyboard_config_t;
extern keyboard_config_t keyboard_config;
typedef struct { bool rgb_control; } keyloom_rawhid_state_t;
extern keyloom_rawhid_state_t rawhid_state;
typedef struct { bool enable; HSV hsv; } rgb_config_t;
extern rgb_config_t rgb_matrix_config;
#define LED_FLAG_NONE 0
// QMK's own default keymap for the Moonlander has a WebUSB pairing key; WebUSB is a USB feature this host build doesn't have, so the key does nothing.
#ifndef WEBUSB_PAIR
#define WEBUSB_PAIR KC_NO
#endif
void rgb_matrix_set_color(int index, uint8_t red, uint8_t green, uint8_t blue);
void rgb_matrix_set_color_all(uint8_t red, uint8_t green, uint8_t blue);
uint8_t rgb_matrix_get_flags(void);
void rgb_matrix_enable(void);
void rgblight_mode(uint8_t mode);
`;

const BOARD_HEADER_PLAIN = `#pragma once
#include "keyloom_layout.h"
`;

const STUBS_ZSA = `keyboard_config_t keyboard_config;
keyloom_rawhid_state_t rawhid_state;
rgb_config_t rgb_matrix_config;
void rgb_matrix_set_color(int index, uint8_t red, uint8_t green, uint8_t blue) {}
void rgb_matrix_set_color_all(uint8_t red, uint8_t green, uint8_t blue) {}
uint8_t rgb_matrix_get_flags(void) { return 0; }
void rgb_matrix_enable(void) {}
void rgblight_mode(uint8_t mode) {}
void raw_hid_receive(uint8_t *data, uint8_t length) {}
RGB hsv_to_rgb(HSV hsv) { RGB rgb = {0, 0, 0}; return rgb; }
`;

const probeSource = (layoutMacro: string, keyCount: number): string => {
  // Argument n+1 lands in the matrix cell where the real LAYOUT puts position n, so the table is the board's own wiring.
  const args = Array.from({ length: keyCount }, (_, i) => i + 1).join(",");
  return `#include "version.h"
const uint16_t keyloom_probe[MATRIX_ROWS][MATRIX_COLS] = ${layoutMacro}(${args});
`;
};

const EMU_CPP = `// Replays a script of key events on the generated keymap and writes every HID report it sends.
// Input (KEYLOOM_EMU_EVENTS): lines of "<ms> <position> press|release". Output (KEYLOOM_EMU_OUT):
//   K <ms> <mods hex> <key name>...    keyboard report
//   C <ms> <key name>                  consumer report
//   M <ms> <buttons hex>               mouse report
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>
#include "test_fixture.hpp"
#include "gtest/gtest.h"
extern "C" {
#include "keymap_introspection.h"
#include "keycode_string.h"
#include "timer.h"
#include "host.h"
#include "report.h"
#include "matrix.h"
extern const uint16_t keyloom_probe[MATRIX_ROWS][MATRIX_COLS];
}

namespace {
FILE* out = nullptr;
uint8_t leds(void) { return 0; }

void on_keyboard(report_keyboard_t* r) {
    fprintf(out, "K %u %02x", (unsigned)timer_read32(), r->mods);
    for (int i = 0; i < KEYBOARD_REPORT_KEYS; i++) {
        if (r->keys[i]) fprintf(out, " %s", get_keycode_string(r->keys[i]));
    }
    fprintf(out, "\\n");
}
void on_nkro(report_nkro_t*) {}
void on_mouse(report_mouse_t* r) { fprintf(out, "M %u %02x\\n", (unsigned)timer_read32(), r->buttons); }
void on_extra(report_extra_t* r) {
    // QMK turns a media keycode into a usage; the keycode's own name is the name keyloom knows it by.
    const char* name = nullptr;
    for (uint16_t kc = 0xA5; kc <= 0xDF && !name; kc++) {
        if (r->usage != 0 && KEYCODE2CONSUMER(kc) == r->usage) name = get_keycode_string(kc);
    }
    if (name) fprintf(out, "C %u %s\\n", (unsigned)timer_read32(), name);
    else fprintf(out, "C %u usage-%04x\\n", (unsigned)timer_read32(), r->usage);
}
host_driver_t driver = {&leds, &on_keyboard, &on_nkro, &on_mouse, &on_extra};
}

class Emulate : public TestFixture {};

TEST_F(Emulate, Run) {
    const char* events = getenv("KEYLOOM_EMU_EVENTS");
    const char* outPath = getenv("KEYLOOM_EMU_OUT");
    const char* settle = getenv("KEYLOOM_EMU_SETTLE_MS");
    ASSERT_TRUE(events && outPath);

    // The fixture answers keymap lookups from its own table, so it is filled from the compiled keymap.
    for (uint8_t l = 0; l < keymap_layer_count(); l++)
        for (uint8_t r = 0; r < MATRIX_ROWS; r++)
            for (uint8_t c = 0; c < MATRIX_COLS; c++) add_key(KeymapKey(l, c, r, keycode_at_keymap_location(l, r, c)));

    out = fopen(outPath, "w");
    ASSERT_TRUE(out);
    host_set_driver(&driver);

    std::ifstream in(events);
    unsigned at, position;
    std::string action;
    // The clock is QMK's own, not a count kept here: firmware code that waits (Oryx's tap dance reset calls
    // wait_ms(10)) moves it, and a count kept here would then put every later event that much too late.
    const uint32_t start = timer_read32();
    while (in >> at >> position >> action) {
        uint8_t row = 255, col = 255;
        for (uint8_t r = 0; r < MATRIX_ROWS; r++)
            for (uint8_t c = 0; c < MATRIX_COLS; c++)
                if (keyloom_probe[r][c] == position + 1) { row = r; col = c; }
        ASSERT_NE(row, 255) << "position " << position << " is not on the matrix";
        const uint32_t now = timer_read32() - start;
        if (at > now) idle_for(at - now);
        if (action == "press") press_key(col, row); else release_key(col, row);
        idle_for(1);
    }
    idle_for(settle ? atoi(settle) : 1000);
    fclose(out);
    out = nullptr;
    clear_all_keys();
}
`;

/** The files of the harness folder that do not depend on QMK's generated headers. */
export function harnessFiles(input: HarnessInput, rules: string): GeneratedFile[] {
  const user = (path: string): string => input.keymapFiles.find((f) => f.path === path)?.content ?? "";
  const files: GeneratedFile[] = [
    { path: "keymap.c", content: user("keymap.c") },
    { path: "user_config.h", content: user("config.h") },
    { path: "config.h", content: '#pragma once\n#include "info_config.h"\n#define QMK_KEYBOARD_H "keyloom_board.h"\n#include "user_config.h"\n' },
    // Oryx's keymap includes version.h, which a real build generates.
    { path: "version.h", content: `#pragma once\n#define QMK_VERSION "keyloom-emulate"\n#define QMK_BUILDDATE "1970-01-01-00:00:00"\n// The build system defines these two on the compiler's command line; a keymap may print them (QMK's own default does, on its version key).\n#define QMK_KEYBOARD "${input.qmkTarget}"\n#define QMK_KEYMAP "keyloom"\n` },
    { path: "test.mk", content: TEST_MK(input.name, rules) },
    { path: "keyloom_board.h", content: input.zsa ? BOARD_HEADER_ZSA(input.modules) : BOARD_HEADER_PLAIN },
    { path: "stubs.c", content: `#include QMK_KEYBOARD_H\n${input.zsa ? STUBS_ZSA : ""}${probeSource(input.layoutMacro, input.keyCount)}` },
    { path: "emu.cpp", content: EMU_CPP },
  ];
  return files;
}

export const rulesWithDefaults = (carried: string): string => {
  const have = new Set([...carried.matchAll(/^([A-Z0-9_]+) =/gm)].map((m) => m[1]));
  return `${ALWAYS_ON.filter((f) => !have.has(f)).map((f) => `${f} = yes\n`).join("")}${carried}`;
};

/**
 * The shell script that runs in QMK's image. It asks qmk itself for the board's layout macros and
 * config defines (the same ones a real build uses), then builds and runs the harness as QMK's
 * make test:<name> does.
 */
export function harnessScript(name: string, qmkTarget: string): string {
  return [
    "set -e",
    `D=tests/${name}`,
    // A run that was killed leaves its folder behind; runs are serialised by the checkout lock, so any other one is dead.
    `for old in tests/keyloom_emu_* .build/test_obj/keyloom_emu_* .build/test/keyloom_emu_*; do case "$old" in *${name}*) ;; *) rm -rf "$old";; esac; done`,
    "mkdir -p $D/gen",
    `qmk generate-keyboard-h -kb ${qmkTarget} -o $D/gen/keyboard.h > /dev/null`,
    `qmk generate-config-h -kb ${qmkTarget} -o $D/gen/info_config.h > /dev/null`,
    // The keyboard's own header (moonlander.h) pulls in drivers that don't exist on the host; only the layout macros are wanted.
    `sed '/^#include "/{/"quantum.h"/!d;}' $D/gen/keyboard.h > $D/keyloom_layout.h`,
    "cp $D/gen/info_config.h $D/info_config.h",
    // Cleaning up happens inside the container too: the host deleting a folder leaves Colima's mount with a stale view of it (see build.ts).
    `trap 'rm -rf $D .build/test_obj/${name} .build/test/${name}.elf' EXIT`,
    `make -j4 test:${name}`,
    // The result comes back on stdout: reading a file the container just wrote through Colima's mount can show a stale view of it.
    `echo ${OUTPUT_BEGIN}`,
    "cat $D/out.txt",
    `echo ${OUTPUT_END}`,
  ].join("\n");
}
