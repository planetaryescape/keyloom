// What a finished QMK build must look like before keyloom keeps it or flashes it. The file's type
// follows the board's MCU (bin for STM32, hex for AVR, uf2 for RP2040), and a Zapp-flashed binary is
// also checked against the bootloader it is built for (S11).
import type { FlashRecipe, QmkDockerBuild } from "../../boards/recipes.ts";
import { uf2Problem } from "../toolchain/uf2.ts";
import { dfuProblem } from "./dfu.ts";

export type ArtifactKind = NonNullable<QmkDockerBuild["artifact"]>;

export const artifactKind = (build: QmkDockerBuild): ArtifactKind => build.artifact ?? "bin";

/** Intel HEX ends with the end-of-file record; a build cut short does not. */
function hexProblem(bytes: Uint8Array): string | undefined {
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0 || !lines.every((l) => l.startsWith(":"))) return "it isn't an Intel HEX file";
  if (lines[lines.length - 1]?.trim().toUpperCase() !== ":00000001FF") return "it has no end-of-file record, so it is incomplete";
  return undefined;
}

/** Why `bytes` must not be kept or flashed, or undefined when it can be. */
export function artifactProblem(bytes: Uint8Array, kind: ArtifactKind, flash: FlashRecipe): string | undefined {
  if (bytes.length === 0) return "the file is empty";
  if (flash.kind === "zapp") return dfuProblem(bytes, flash.bootloader);
  if (kind === "uf2") return uf2Problem(bytes, "single");
  if (kind === "hex") return hexProblem(bytes);
  return undefined;
}
