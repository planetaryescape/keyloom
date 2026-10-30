// The RGB module blanks pixels but doesn't switch Keebart's LED supply. Follow its logical
// state after settings load, including idle, and repaint once the rail has settled on wake.
#include <zephyr/device.h>
#include <zephyr/init.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <drivers/ext_power.h>
#include <zmk/rgb_matrix.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static const struct device *power = DEVICE_DT_GET(DT_INST(0, zmk_ext_power_generic));
static bool repaint;
static void follow_rgb_power(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(rgb_power_work, follow_rgb_power);

static void follow_rgb_power(struct k_work *work) {
    bool on = false;
    int err = zmk_rgb_matrix_get_state(&on);
    int powered = ext_power_get(power);
    if (err < 0 || powered < 0) {
        LOG_WRN("Could not read RGB power state: %d, %d", err, powered);
    } else if (on != (bool)powered) {
        err = on ? ext_power_enable(power) : ext_power_disable(power);
        if (err < 0) {
            LOG_WRN("Could not switch RGB power: %d", err);
        } else if (on) {
            repaint = true;
            k_work_reschedule(&rgb_power_work, K_MSEC(50));
            return;
        }
    } else if (repaint) {
        repaint = false;
        zmk_rgb_matrix_flush();
    }
    k_work_reschedule(&rgb_power_work, K_MSEC(250));
}

static int keyloom_rgb_power_init(void) {
    if (!device_is_ready(power)) {
        LOG_ERR("RGB external power is not ready");
        return -ENODEV;
    }
    k_work_schedule(&rgb_power_work, K_MSEC(250));
    return 0;
}
SYS_INIT(keyloom_rgb_power_init, APPLICATION, 99);
