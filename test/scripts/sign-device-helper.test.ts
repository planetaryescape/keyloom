import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tempDir } from "../helpers/tmp.js";

// Only these fake OS tools are on PATH. No real keychain, identity or Apple service is used.
const fakeTool = `#!/bin/sh
set -eu
command="\${0##*/}"
printf '%s' "$command" >> "$COMMAND_LOG"
for arg do printf '\t%s' "$arg" >> "$COMMAND_LOG"; done
printf '\\n' >> "$COMMAND_LOG"
case "$command" in
  uname) printf 'Darwin\\n' ;;
  uuidgen) printf 'TEST-UUID\\n' ;;
  base64) printf 'synthetic-p12' ;;
  security)
    case "$1" in
      list-keychains)
        if [ "\${4:-}" = -s ]; then
          shift 4
          : > "$KEYCHAIN_STATE"
          for chain do printf '    "%s"\\n' "$chain" >> "$KEYCHAIN_STATE"; done
        else
          while IFS= read -r line; do printf '%s\\n' "$line"; done < "$KEYCHAIN_STATE"
        fi ;;
      create-keychain|set-keychain-settings|unlock-keychain|import|set-key-partition-list|delete-keychain) ;;
      *) exit 90 ;;
    esac ;;
  codesign)
    if [ "$1" = --verify ]; then exit 0; fi
    chain=''
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --keychain ]; then shift; chain="$1"; fi
      shift
    done
    found=false
    while IFS= read -r line; do
      if [ "$line" = "    \\"$chain\\"" ]; then found=true; fi
    done < "$KEYCHAIN_STATE"
    if [ "$found" != true ]; then
      printf 'mock codesign: identity keychain is not on user search list\\n' >&2
      exit 44
    fi
    if [ "\${FAIL_CODESIGN:-}" = 1 ]; then exit 42; fi ;;
  xcrun) printf '{"status":"Accepted"}\\n' ;;
  rm|ditto|jq) ;;
  *) exit 91 ;;
esac
`;

function runSigning(failCodesign = false) {
  const root = tempDir("keyloom-signing-test-");
  const bin = join(root, "fake-bin");
  const runner = join(root, "CI temp π");
  mkdirSync(bin);
  mkdirSync(runner);
  for (const command of ["uname", "uuidgen", "base64", "security", "codesign", "xcrun", "rm", "ditto", "jq"]) {
    writeFileSync(join(bin, command), fakeTool, { mode: 0o755 });
  }
  const state = join(root, "search-list");
  const original = '    "/ci/login.keychain-db"\n    "/ci/Extra "Keychain" π.keychain-db"\n';
  writeFileSync(state, original);
  const log = join(root, "commands");
  const result = Bun.spawnSync(["/bin/sh", resolve(import.meta.dir, "../../scripts/sign-device-helper.sh"), join(root, "helper")], {
    env: {
      PATH: bin,
      RUNNER_TEMP: runner,
      COMMAND_LOG: log,
      KEYCHAIN_STATE: state,
      FAIL_CODESIGN: failCodesign ? "1" : "0",
      APPLE_CERT_P12_BASE64: "synthetic-cert-base64",
      APPLE_CERT_PASSWORD: "synthetic-cert-password",
      APPLE_SIGNING_IDENTITY_NAME: "synthetic-signing-identity",
      APPLE_API_KEY_ID: "synthetic-key-id",
      APPLE_API_ISSUER_ID: "synthetic-issuer",
      APPLE_API_KEY_P8: "synthetic-notary-key",
    },
    timeout: 5_000,
  });
  return {
    result,
    original,
    current: readFileSync(state, "utf8"),
    commands: readFileSync(log, "utf8").trimEnd().split("\n").map((line) => line.split("\t")),
    keychain: join(runner, "helper-TEST-UUID.keychain-db"),
  };
}

describe.skipIf(process.platform === "win32")("CI helper signing search-list lifecycle", () => {
  test("makes the identity available before signing and restores the original search list", () => {
    const { result, current, original, commands, keychain } = runSigning();
    expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exit: 0, stderr: "" });
    expect(current).toBe(original);
    const registration = commands.findIndex((args) => args[0] === "security" && args[1] === "list-keychains" && args.includes(keychain));
    const signing = commands.findIndex((args) => args[0] === "codesign" && args.includes("--force"));
    expect(registration).toBeGreaterThanOrEqual(0);
    expect(signing).toBeGreaterThan(registration);
    expect(commands.some((args) => args[0] === "xcrun")).toBe(true);
    expect(commands).toContainEqual(["security", "delete-keychain", keychain]);
  });

  test("restores the search list after codesign failure without continuing to notarisation", () => {
    const { result, current, original, commands, keychain } = runSigning(true);
    expect(result.exitCode).toBe(42);
    expect(current).toBe(original);
    expect(commands).toContainEqual(["security", "delete-keychain", keychain]);
    expect(commands.some((args) => args[0] === "xcrun")).toBe(false);
    const output = result.stdout.toString();
    expect(output).toContain("helper-signing: codesign\n");
    expect(output).not.toContain("helper-signing: verify signature");
    for (const secret of ["synthetic-cert-base64", "synthetic-cert-password", "synthetic-notary-key"]) {
      expect(output + result.stderr.toString()).not.toContain(secret);
    }
  });
});
