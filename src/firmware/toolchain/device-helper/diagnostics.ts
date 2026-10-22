import pkg from "../../../../package.json" with { type: "json" };
import { diagnoseHelper } from "./client.ts";
import { HelperFailure, type HelperFailureCode } from "./errors.ts";
import { currentTarget, extractHelper } from "./extract.ts";
import { packagedHelper } from "./packaged.ts";
import { deviceBackend } from "./selection.ts";
import { HID_CAPABILITIES, SERIAL_CAPABILITIES, NATIVE_CAPABILITIES, type Capability } from "./transport-protocol.ts";

type DiagnosticIdentity = { hostVersion: string; protocol: 1; target: string; capabilities: Capability[] };
export type HelperDiagnostic = DiagnosticIdentity & (
  | { available: true; helperVersion: string; helperSha256: string }
  | { available: false; code: HelperFailureCode | "not_bundled"; detail?: string }
);

/** Source/dev use reports not_bundled without starting a process. Installed builds carry the only trusted pair. */
export async function deviceHelperDiagnostic(): Promise<HelperDiagnostic> {
  const pair = packagedHelper;
  const base: DiagnosticIdentity = { hostVersion: pkg.version, protocol: 1, target: `${process.platform}-${process.arch}`, capabilities: [] };
  if (!pair) return { ...base, available: false, code: "not_bundled" };
  try {
    base.target = currentTarget();
    const bytes = await Bun.file(pair.asset).bytes();
    const extracted = extractHelper(bytes, pair.manifest, pkg.version);
    const hello = await diagnoseHelper(extracted.path, extracted.manifest, undefined, deviceBackend() === "native" ? NATIVE_CAPABILITIES : deviceBackend() === "native-hid" ? HID_CAPABILITIES : deviceBackend() === "native-serial" ? SERIAL_CAPABILITIES : []);
    return { ...base, available: true, helperVersion: hello.helperVersion, helperSha256: extracted.manifest.sha256, target: hello.target, capabilities: hello.capabilities };
  } catch (error) {
    return { ...base, available: false, code: error instanceof HelperFailure ? error.code : "helper_unavailable", ...(error instanceof HelperFailure && error.detail ? { detail: error.detail } : {}) };
  }
}
