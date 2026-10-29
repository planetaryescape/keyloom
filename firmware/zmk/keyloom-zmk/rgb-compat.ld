/* Zephyr 3.5's iterable sections use four-byte alignment. Load this before
 * the RGB module's section declaration; newer Zephyr supplies its own value. */
#include <zephyr/linker/iterable_sections.h>
#ifndef Z_LINK_ITERABLE_SUBALIGN
#define Z_LINK_ITERABLE_SUBALIGN 4
#endif
