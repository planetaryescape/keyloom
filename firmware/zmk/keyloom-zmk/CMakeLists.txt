# keyloom's hands-free flash module (D-095). The devicetree node it needs is added by keyloom-cdc-acm.overlay,
# which the build passes as EXTRA_DTC_OVERLAY_FILE: a module can't add an overlay to a board by itself.
zephyr_library()
zephyr_library_sources_ifdef(CONFIG_KEYLOOM_HANDSFREE src/handsfree.c)
zephyr_library_sources_ifdef(CONFIG_KEYLOOM_SERIAL_OVERRIDE src/serial.c)
# ZMK's headers (zmk/behavior.h, zmk/split/central.h) live in the application, which is ZMK's app/ in every keyloom build.
zephyr_include_directories(${APPLICATION_SOURCE_DIR}/include)
