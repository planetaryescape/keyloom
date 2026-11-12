/** The build did not produce a usable binary; `message` is fit to show a person, and `code` names a cause the UI can act on. */
export class BuildFailure extends Error {
  override name = "BuildFailure";
  constructor(message: string, readonly code: BuildErrorCode | null = null) {
    super(message);
  }
}

/**
 * `docker_unavailable`: Docker is missing, unreachable or wouldn't start; the UI shows its Install or Start button (D-488).
 * `cancelled`: the person stopped the build (R3-10); the UI offers Build firmware again.
 * `compile_error`: the source keyloom wrote from this layout doesn't compile, a key code the firmware doesn't know included (R5-02).
 * `too_large`: the firmware doesn't fit the keyboard's memory (R5-02).
 * The last two fail the same way every time for this revision, so the UI offers the last revision that built and a question to keyloom,
 * never Build again. A failure with no code may pass (a download, a full disk), so Build again stays for it.
 * `stale_mount`: Docker still sees an old copy of what keyloom wrote (Colima's sshfs share) (R6-09). `stuck_container`: a build container
 * an earlier keyloom left can't be removed (R6-17). Building again hits the same engine state, so the UI offers a forced restart of the
 * engine and then the build (D-529).
 * `source_error`: keyloom can't write this layout as the firmware's source, so every build of it stops the same way, like `compile_error`
 * (R7-02). `folder_not_shared`: Docker mounts an empty folder for the build checkout, because the engine doesn't share it; building again
 * fails the same way until that folder is shared, so the UI says where and offers the engine's own settings (D-536).
 */
export const BUILD_ERROR_CODES = ["docker_unavailable", "cancelled", "compile_error", "too_large", "stale_mount", "stuck_container", "source_error", "folder_not_shared"] as const;
export type BuildErrorCode = (typeof BUILD_ERROR_CODES)[number];
export const isBuildErrorCode = (code: string | null): code is BuildErrorCode => (BUILD_ERROR_CODES as readonly string[]).includes(code ?? "");

/** The codes whose build fails the same way each time, so building again can't help (R5-02). */
export const DETERMINISTIC_BUILD_CODES: ReadonlySet<BuildErrorCode> = new Set(["compile_error", "too_large", "source_error"]);

/** The codes a restart of the Docker engine clears, while Docker itself still answers (R6-09, R6-17). */
export const ENGINE_RESTART_BUILD_CODES: ReadonlySet<BuildErrorCode> = new Set(["stale_mount", "stuck_container"]);

// Colour codes around QMK's messages would split the words the patterns look for.
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * The firmware is bigger than the memory it must fit, by the lines the toolchains print, with the overflow in bytes when a line says it.
 * GNU ld (QMK on ARM, and Zephyr for ZMK) prints both of these, observed with GNU ld 2.45.1 (Arm GNU Toolchain 15.2.Rel1) linking 256 bytes
 * of data into a 64-byte region:
 *   ld: a2.elf section `.data' will not fit in region `FLASH'
 *   ld: region `FLASH' overflowed by 228 bytes
 * QMK's own size check, for AVR boards only (platforms/avr/platform.mk:128 and builddefs/message.mk:97, `MSG_FILE_TOO_BIG`, in ZSA's fork
 * at 93b2b9ec), prints, around colour codes,
 *   The firmware is too large! $(CURRENT_SIZE)/$(MAX_SIZE) ($(OVER_SIZE) bytes over)
 */
export function firmwareOverflow(lines: readonly string[]): { bytes: number | null } | null {
  let found: { bytes: number | null } | null = null;
  for (const raw of lines) {
    const line = raw.replace(ANSI, "");
    const overflow = /region [`'‘]?[\w.]+['’]? overflowed by (\d+) bytes?/.exec(line) ?? /The firmware is too large!.*\((\d+) bytes over\)/.exec(line);
    if (overflow) return { bytes: Number(overflow[1]) };
    if (/will not fit in region/.test(line) || /The firmware is too large!/.test(line)) found = { bytes: null };
  }
  return found;
}

/** What a firmware too large to fit says, for `boardName`. Every way to make it smaller is a change to the layout. */
export function tooLargeMessage(boardName: string, overflow: { bytes: number | null }): string {
  const by = overflow.bytes === null ? "" : ` by ${overflow.bytes} ${overflow.bytes === 1 ? "byte" : "bytes"}`;
  return `The firmware is too big for the ${boardName}'s memory${by}. Fewer combos, macros or features make it smaller.`;
}

/**
 * The failure a build that exited non-zero ends in, in D-523's order: Docker's own trouble first (`docker`, a full disk or a stopped daemon),
 * since it can pass; then a firmware too big to fit; then the driver's compile error (`compileError`, from its own locators); then the
 * driver's `generic` sentence. Only the middle two carry a code, because only they fail the same way every time.
 */
export function classifyBuildFailure(output: readonly string[], driver: { boardName: string; docker: string | undefined; compileError: () => string | undefined; generic: string }): BuildFailure {
  if (driver.docker !== undefined) return new BuildFailure(driver.docker);
  const overflow = firmwareOverflow(output);
  if (overflow !== null) return new BuildFailure(tooLargeMessage(driver.boardName, overflow), "too_large");
  const compiled = driver.compileError();
  if (compiled !== undefined) return new BuildFailure(compiled, "compile_error");
  return new BuildFailure(driver.generic);
}
