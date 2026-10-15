/*
 * keyloom: the USB serial number carries the build marker, so the host can tell which firmware a half runs
 * and which half it is. Zephyr's default replaces the whole string with the chip ID; this keeps the template
 * (CONFIG_USB_DEVICE_SN, "keyloom/<12>-L:<16 characters>") and fills in only what differs per half.
 * The Glove80 has its own function that does the same for its template, so this file is not built there.
 */
#include <stdbool.h>
#include <string.h>
#include <zephyr/sys/util.h>
#include <zephyr/drivers/hwinfo.h>
#include <zephyr/usb/usb_device.h>

#define ID_CHARS 16
/* "keyloom/" is 8 characters, the build ID 12, then "-" and the half letter. */
#define HALF_LETTER_AT 21

/* A byte loop rather than memcmp: GCC rejects memcmp's fixed bound against a template shorter than the prefix, even behind a length check. */
static bool has_keyloom_prefix(const uint8_t *s, size_t len) {
    static const char prefix[] = "keyloom/";
    if (len < sizeof(prefix) - 1) {
        return false;
    }
    for (size_t i = 0; i < sizeof(prefix) - 1; i++) {
        if (s[i] != (uint8_t)prefix[i]) {
            return false;
        }
    }
    return true;
}

uint8_t *usb_update_sn_string_descriptor(void) {
    const size_t template_len = sizeof(CONFIG_USB_DEVICE_SN);
    static uint8_t serial[sizeof(CONFIG_USB_DEVICE_SN)];

    memcpy(serial, CONFIG_USB_DEVICE_SN, template_len);

    /* A template without keyloom's marker (a build keyloom did not make) keeps whatever it is, but still gets the chip ID, so two halves never share a serial number. */
    if (template_len >= HALF_LETTER_AT + 2 && has_keyloom_prefix(serial, template_len)) {
#if IS_ENABLED(CONFIG_ZMK_SPLIT) && !IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
        serial[HALF_LETTER_AT] = 'R';
#else
        serial[HALF_LETTER_AT] = 'L';
#endif
    }

    uint8_t hwid[8] = {0};
    const ssize_t hwlen = hwinfo_get_device_id(hwid, sizeof(hwid));
    static const char hex[] = "0123456789ABCDEF";
    const size_t id_chars = MIN((size_t)ID_CHARS, template_len - 1);
    uint8_t *id = serial + template_len - 1 - id_chars;
    for (size_t i = 0; i < id_chars && (ssize_t)(i / 2) < hwlen; i++) {
        id[i] = hex[(i % 2 == 0) ? hwid[i / 2] >> 4 : hwid[i / 2] & 0xF];
    }
    serial[template_len - 1] = '\0';
    return serial;
}
