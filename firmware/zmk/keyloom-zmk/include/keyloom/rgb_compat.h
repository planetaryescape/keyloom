#pragma once
// Zephyr 3.5 has the child iterator but not the count helper used by zmk-rgb-matrix.
// Count only enabled children, matching Zephyr 4.1's documented semantics. No vendor fork needed.
#ifndef __ASSEMBLER__
#include <zephyr/devicetree.h>
#ifndef DT_CHILD_NUM_STATUS_OKAY
#define KEYLOOM_COUNT_CHILD(node_id) +1
#define DT_CHILD_NUM_STATUS_OKAY(node_id) (0 DT_FOREACH_CHILD_STATUS_OKAY(node_id, KEYLOOM_COUNT_CHILD))
#endif

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <version.h>
#if ZEPHYR_VERSION_CODE == ZEPHYR_VERSION(3, 5, 0)
// The older ARM IRQ header defines a two-token CONCAT. Include it first, then
// use the existing map-and-concatenate helper for RGB's five-token enum names.
#undef CONCAT
#define CONCAT(...) MACRO_MAP_CAT(IDENTITY, __VA_ARGS__)

// Adapted from zmkfirmware/zephyr include/zephyr/device.h @ dacab4875df72109b96cc8977547a0dc04875bcd.
// Copyright (c) 2015 Intel Corporation. Apache-2.0 (upstream LICENSE).
// RGB behaviours depend on the strip's POST_KERNEL initialization. Put composite binding
// devices (macros, hold-taps and tap dances that reference other behaviours) at APPLICATION 80,
// in devicetree dependency order, before ZMK initializes its keymap/scanner at 90.
// Newer DEVICE_DT_DEFINE also terminates its declaration.
BUILD_ASSERT(CONFIG_APPLICATION_INIT_PRIORITY > 80, "Behaviours must precede the keymap");
#define KEYLOOM_BEHAVIOR_LEVEL(node_id, level) \
    COND_CODE_1(DT_NODE_HAS_PROP(node_id, bindings), (APPLICATION), (level))
#define KEYLOOM_BEHAVIOR_PRIORITY(node_id, prio) \
    COND_CODE_1(DT_NODE_HAS_PROP(node_id, bindings), (80), (prio))
#undef DEVICE_DT_DEFINE
#define DEVICE_DT_DEFINE(node_id, init_fn, pm, data, config, level, prio, api, ...) \
    Z_DEVICE_STATE_DEFINE(Z_DEVICE_DT_DEV_ID(node_id)); \
    Z_DEVICE_DEFINE(node_id, Z_DEVICE_DT_DEV_ID(node_id), DEVICE_DT_NAME(node_id), \
                    init_fn, pm, data, config, KEYLOOM_BEHAVIOR_LEVEL(node_id, level), \
                    KEYLOOM_BEHAVIOR_PRIORITY(node_id, prio), api, \
                    &Z_DEVICE_STATE_NAME(Z_DEVICE_DT_DEV_ID(node_id)), __VA_ARGS__);
#endif

#include <limits.h>
#include <zephyr/init.h>
#include <zephyr/settings/settings.h>
#ifndef SETTINGS_STATIC_HANDLER_DEFINE_WITH_CPRIO
// Zephyr 3.5 commits dynamic handlers after all static handlers, in registration
// order. Register RGB after ZMK's Bluetooth handlers so its INT_MAX commit still
// restores settings and starts conditions last (upstream rgb-matrix 1605305c).
#define SETTINGS_STATIC_HANDLER_DEFINE_WITH_CPRIO(id, tree, get, set, commit, export, priority) \
    BUILD_ASSERT((priority) == INT_MAX, "Only last-priority settings handlers are supported"); \
    BUILD_ASSERT(IS_ENABLED(CONFIG_SETTINGS_DYNAMIC_HANDLERS), "Dynamic settings required"); \
    BUILD_ASSERT(CONFIG_ZMK_BLE_INIT_PRIORITY < 99, "RGB settings must follow Bluetooth"); \
    static struct settings_handler keyloom_settings_##id = { \
        .name = tree, .h_get = get, .h_set = set, .h_commit = commit, .h_export = export}; \
    static int keyloom_register_##id(void) { return settings_register(&keyloom_settings_##id); } \
    SYS_INIT(keyloom_register_##id, APPLICATION, 99)
#endif
#endif
