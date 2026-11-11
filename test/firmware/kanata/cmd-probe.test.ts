// D-498: the kanata keyloom gives root must refuse a config that runs programs. This runs setup's own probe through the real
// `kanata --check` where one is installed (KEYLOOM_KANATA_BIN or PATH, as the other --check tests here), which reads the file and exits:
// it grabs no keyboard and needs no root. Homebrew's kanata is built without the `cmd` feature, so it must say "refuses".
import { describe, expect, test } from "bun:test";
import { CMD_PROBE_CONFIG, cmdCheckResult, kanataCheck } from "../../../src/firmware/kanata/binary.ts";
import { kanataBinary } from "../../helpers/kanata-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { setupRemapper } from "../../../src/app/remapper.ts";
import { fileSha256 } from "../../../src/firmware/kanata/binary.ts";

const bin = kanataBinary();

describe("the cmd probe against the installed kanata", () => {
  test.skipIf(bin === undefined)("refuses the probe, so setup may give it root", async () => {
    const path = join(tempDir(), "probe.kbd");
    await Bun.write(path, CMD_PROBE_CONFIG);
    const r = await kanataCheck(bin!, path);
    expect(cmdCheckResult(r)).toBe("refuses");
  });

  // Setup probes a private copy of the bytes it hashed (review of #279): the copied binary must still run, or every setup is refused.
  test.skipIf(bin === undefined)("setup's probe of its private copy reaches the same answer, and pins the installed kanata's hash", async () => {
    const setup = await setupRemapper("apple/macbook-ansi", { home: tempDir(), kanataBin: () => bin });
    expect(setup.blocked).toBeNull();
    expect(setup.install?.kanata).toEqual({ source: realpathSync(bin!), sha256: (await fileSha256(bin!))! });
  });
});
