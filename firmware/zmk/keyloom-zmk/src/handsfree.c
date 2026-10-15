/*
 * keyloom: restart a half into its UF2 bootloader when the host touches its USB serial port.
 *
 *   1200 baud, then the port closed: this half reboots into the bootloader.
 *   1201 baud, then the port closed (central half only): every peripheral is told to run &bootloader.
 *
 * "Closed" is DTR low, so a program that merely holds the port open at 1200 baud does not restart the
 * keyboard. `stty -f <port> 1200` opens, sets the rate and closes, which is what the host side runs.
 * The idea and the debounce are from tadakado/zmk-bootloader-1200 (MIT), which needs Zephyr's boot-mode
 * retention and has no split relay; neither keyloom pin has the first, and the Glove80 needs the second.
 */
#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/sys/reboot.h>
#include <zephyr/usb/usb_device.h>
#include <zephyr/logging/log.h>

#if IS_ENABLED(CONFIG_RETENTION_BOOT_MODE)
#include <zephyr/retention/bootmode.h>
#endif

#if IS_ENABLED(CONFIG_ZMK_SPLIT) && IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#include <zmk/behavior.h>
#include <zmk/split/central.h>
#define KEYLOOM_RELAY 1
#endif

LOG_MODULE_REGISTER(keyloom_handsfree, LOG_LEVEL_INF);

#define LOCAL_BAUD 1200
#define RELAY_BAUD 1201
#define POLL_MS 250
/* What the port is set back to after a relay, so that the next 1201 touch is a change the poll can see. */
#define IDLE_BAUD 115200

/* Adafruit's bootloader reads this from GPREGRET and starts UF2 mode. */
#define DFU_MAGIC_UF2_RESET 0x57

static const struct device *cdc = DEVICE_DT_GET(DT_NODELABEL(keyloom_cdc_acm));

static void reboot_to_uf2(void) {
    LOG_INF("restarting into the bootloader");
    k_sleep(K_MSEC(50)); /* let the log flush */
#if IS_ENABLED(CONFIG_RETENTION_BOOT_MODE)
    /* Zephyr 4.x: ZMK maps this boot mode to the bootloader's magic. */
    bootmode_set(BOOT_MODE_TYPE_BOOTLOADER);
    sys_reboot(SYS_REBOOT_WARM);
#else
    /* Zephyr 3.5: with NRF_STORE_REBOOT_TYPE_GPREGRET (ZMK's default) the type is written to GPREGRET. */
    sys_reboot(DFU_MAGIC_UF2_RESET);
#endif
}

#ifdef KEYLOOM_RELAY
static void relay_to_peripherals(void) {
    /* The same call &bootloader makes for a key pressed on a peripheral. The peripheral looks the behavior up by name, which is why that name is at most 8 characters. */
    for (uint8_t i = 0; i < ZMK_SPLIT_CENTRAL_PERIPHERAL_COUNT; i++) {
        struct zmk_behavior_binding binding = {.behavior_dev = "bootload"};
        struct zmk_behavior_binding_event event = {.position = 0, .timestamp = k_uptime_get(), .source = i};
        const int err = zmk_split_central_invoke_behavior(i, &binding, event, true);
        if (err) {
            LOG_WRN("peripheral %d did not take the bootloader command (%d)", i, err);
        } else {
            LOG_INF("sent the bootloader command to peripheral %d", i);
        }
    }
}
#else
/* Only the central can reach the peripherals; on a peripheral the touch just has to be forgotten. */
static void relay_to_peripherals(void) {}
#endif

/* The baud rate the host left the port at, if it has closed the port; 0 while the port is open. */
static uint32_t closed_at(void) {
    uint32_t baud = 0;
    uint32_t dtr = 1; /* a failed read counts as open, so it never triggers */
    if (uart_line_ctrl_get(cdc, UART_LINE_CTRL_DTR, &dtr) != 0 || dtr != 0) {
        return 0;
    }
    if (uart_line_ctrl_get(cdc, UART_LINE_CTRL_BAUD_RATE, &baud) != 0) {
        return 0;
    }
    return baud;
}

static void watch(void *a, void *b, void *c) {
    ARG_UNUSED(a);
    ARG_UNUSED(b);
    ARG_UNUSED(c);

    /* A split peripheral has no ZMK USB, so nothing else brings USB up. On the central it is already up and this returns an error that is ignored. */
#if !IS_ENABLED(CONFIG_ZMK_USB)
    usb_enable(NULL);
#endif

    while (!device_is_ready(cdc)) {
        k_sleep(K_MSEC(200));
    }

    for (;;) {
        const uint32_t baud = closed_at();
        if (baud == LOCAL_BAUD || baud == RELAY_BAUD) {
            /* A host that opens the port again within this time cancels the touch. */
            k_sleep(K_MSEC(POLL_MS));
            if (closed_at() == baud) {
                if (baud == LOCAL_BAUD) {
                    reboot_to_uf2();
                }
                relay_to_peripherals();
                uart_line_ctrl_set(cdc, UART_LINE_CTRL_BAUD_RATE, IDLE_BAUD);
            }
        }
        k_sleep(K_MSEC(POLL_MS));
    }
}

K_THREAD_DEFINE(keyloom_handsfree_tid, CONFIG_KEYLOOM_HANDSFREE_STACK_SIZE, watch, NULL, NULL, NULL,
                K_LOWEST_APPLICATION_THREAD_PRIO, 0, 1000);
