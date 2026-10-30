# keyloom's hands-free flash module (D-095). The devicetree node it needs is added by keyloom-cdc-acm.overlay,
# which the build passes as EXTRA_DTC_OVERLAY_FILE: a module can't add an overlay to a board by itself.
zephyr_library()
zephyr_library_sources_ifdef(CONFIG_KEYLOOM_HANDSFREE src/handsfree.c)
zephyr_library_sources_ifdef(CONFIG_KEYLOOM_SERIAL_OVERRIDE src/serial.c)
zephyr_library_sources_ifdef(CONFIG_KEYLOOM_TYPING_LAB src/typing.c)
# ZMK's headers (zmk/behavior.h, zmk/split/central.h) live in the application, which is ZMK's app/ in every keyloom build.
zephyr_include_directories(${APPLICATION_SOURCE_DIR}/include)
zephyr_library_sources_ifdef(CONFIG_KEYLOOM_RGB_POWER src/rgb_power.c)
if(CONFIG_KEYPAW_RGB_MATRIX)
  zephyr_linker_sources(DATA_SECTIONS SORT_KEY "00-keyloom-rgb" rgb-compat.ld)
  zephyr_compile_options("SHELL:-include ${CMAKE_CURRENT_SOURCE_DIR}/include/keyloom/rgb_compat.h")
endif()
