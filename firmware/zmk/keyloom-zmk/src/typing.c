/*
 * keyloom typing lab (D-281): when the host asks over the module's USB serial port, every key press and release is
 * written to it as one text line, with the central's own millisecond clock. Only the central runs this, because it
 * is the half that sees both halves' keys in one order (split peripherals report to it as position events).
 *
 *   host to keyboard   "KLTYPE START", "KLTYPE PING", "KLTYPE STOP"   each ended by a newline
 *   keyboard to host   "KLTYPE ON <ms>"        the stream began
 *                      "E <position> <1|0> <ms> <source>"   a press (1) or release (0); source 255 is this half
 *                      "KLTYPE DROP <n>"       n events were lost because the host read too slowly
 *                      "KLTYPE OFF <reason>"   0 the host asked, 1 the 10 minute limit, 2 the host stopped pinging
 *
 * Off at power-up. It also stops, without a message, when the host closes the port. 1200 and 1201 baud touches
 * are handled by handsfree.c and are not affected: this file never changes the line settings.
 */
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/sys/printk.h>
#include <zmk/event_manager.h>
#include <zmk/events/position_state_changed.h>

#if !IS_ENABLED(CONFIG_ZMK_SPLIT) || IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)

#define LAB_SESSION_MS (10 * 60 * 1000)
#define LAB_QUIET_MS 3000
#define LAB_QUEUE_LEN 64
#define LAB_LINE_MAX 24
#define LAB_STEP_MS 5

struct lab_event {
    int64_t at;
    uint32_t position;
    uint8_t source;
    uint8_t pressed;
};

K_MSGQ_DEFINE(lab_queue, sizeof(struct lab_event), LAB_QUEUE_LEN, 4);

static const struct device *lab_cdc = DEVICE_DT_GET(DT_NODELABEL(keyloom_cdc_acm));

/* Written by the serial interrupt (commands) and read by the thread; a flag is set by one side and cleared by the other. */
static volatile bool lab_on;
static volatile bool lab_start_requested;
static volatile bool lab_stop_requested;
static volatile int64_t lab_heard;
static volatile uint32_t lab_dropped;
static int64_t lab_started;

static char lab_line[LAB_LINE_MAX];
static size_t lab_line_len;

static void lab_command(const char *line) {
    if (strcmp(line, "KLTYPE START") == 0) {
        lab_heard = k_uptime_get();
        lab_start_requested = true;
    } else if (strcmp(line, "KLTYPE PING") == 0) {
        lab_heard = k_uptime_get();
    } else if (strcmp(line, "KLTYPE STOP") == 0) {
        lab_stop_requested = true;
    }
}

/* One received byte; a command is a short line, and anything longer or unknown is dropped. */
static void lab_feed(uint8_t c) {
    if (c == '\n' || c == '\r') {
        lab_line[lab_line_len] = '\0';
        if (lab_line_len > 0) {
            lab_command(lab_line);
        }
        lab_line_len = 0;
    } else if (lab_line_len + 1 < sizeof(lab_line)) {
        lab_line[lab_line_len++] = (char)c;
    } else {
        lab_line_len = 0;
    }
}

static void lab_irq(const struct device *dev, void *user) {
    ARG_UNUSED(user);
    uint8_t buf[16];
    if (!uart_irq_update(dev)) {
        return;
    }
    while (uart_irq_rx_ready(dev)) {
        const int n = uart_fifo_read(dev, buf, sizeof(buf));
        if (n <= 0) {
            break;
        }
        for (int i = 0; i < n; i++) {
            lab_feed(buf[i]);
        }
    }
}

static void lab_write(const char *text) {
    for (; *text; text++) {
        uart_poll_out(lab_cdc, (unsigned char)*text);
    }
}

static void lab_finish(uint32_t reason) {
    lab_on = false;
    if (reason != 3) {
        char out[LAB_LINE_MAX + 8];
        snprintk(out, sizeof(out), "KLTYPE OFF %u\n", reason);
        lab_write(out);
    }
}

static int keyloom_typing_listener(const zmk_event_t *eh) {
    const struct zmk_position_state_changed *ev = as_zmk_position_state_changed(eh);
    if (ev == NULL || !lab_on) {
        return ZMK_EV_EVENT_BUBBLE;
    }
    const struct lab_event e = {.at = ev->timestamp, .position = ev->position, .source = ev->source, .pressed = ev->state ? 1 : 0};
    if (k_msgq_put(&lab_queue, &e, K_NO_WAIT) != 0) {
        lab_dropped++;
    }
    /* Never captured: the keyboard types exactly as it does with the lab off. */
    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(keyloom_typing, keyloom_typing_listener);
ZMK_SUBSCRIPTION(keyloom_typing, zmk_position_state_changed);

/* One pass of the thread: handle a request, the time limits and the port, then send what has queued up. */
static void lab_step(void) {
    const int64_t now = k_uptime_get();
    char out[LAB_LINE_MAX + 16];

    if (lab_start_requested) {
        lab_start_requested = false;
        if (!lab_on) {
            k_msgq_purge(&lab_queue);
            lab_dropped = 0;
            lab_started = now;
            lab_on = true;
            snprintk(out, sizeof(out), "KLTYPE ON %u\n", (uint32_t)now);
            lab_write(out);
        }
    }
    if (lab_stop_requested) {
        lab_stop_requested = false;
        if (lab_on) {
            lab_finish(0);
        }
    }
    if (lab_on) {
        uint32_t dtr = 1; /* a failed read counts as open */
        if (uart_line_ctrl_get(lab_cdc, UART_LINE_CTRL_DTR, &dtr) == 0 && dtr == 0) {
            lab_finish(3);
        } else if (now - lab_heard > LAB_QUIET_MS) {
            lab_finish(2);
        } else if (now - lab_started > LAB_SESSION_MS) {
            lab_finish(1);
        }
    }

    struct lab_event e;
    while (k_msgq_get(&lab_queue, &e, K_NO_WAIT) == 0) {
        if (!lab_on) {
            continue;
        }
        if (lab_dropped > 0) {
            snprintk(out, sizeof(out), "KLTYPE DROP %u\n", (uint32_t)lab_dropped);
            lab_dropped = 0;
            lab_write(out);
        }
        snprintk(out, sizeof(out), "E %u %u %u %u\n", e.position, e.pressed, (uint32_t)e.at, e.source);
        lab_write(out);
    }
}

static void lab_thread(void *a, void *b, void *c) {
    ARG_UNUSED(a);
    ARG_UNUSED(b);
    ARG_UNUSED(c);

    while (!device_is_ready(lab_cdc)) {
        k_sleep(K_MSEC(200));
    }
    uart_irq_callback_user_data_set(lab_cdc, lab_irq, NULL);
    uart_irq_rx_enable(lab_cdc);

    for (;;) {
        lab_step();
        k_sleep(K_MSEC(LAB_STEP_MS));
    }
}

K_THREAD_DEFINE(keyloom_typing_tid, CONFIG_KEYLOOM_HANDSFREE_STACK_SIZE, lab_thread, NULL, NULL, NULL, K_LOWEST_APPLICATION_THREAD_PRIO, 0, 1500);

#endif
