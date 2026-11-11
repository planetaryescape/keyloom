// A fake of kanata's TCP server (21): the same newline-JSON protocol on a loopback port, with a "running config" it reads from the
// file a ReloadFile names. It lets the apply, verify, disable and sync tests run without a remapper, a driver or root.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FakeKanata = {
  port: number;
  /** The path of the file the fake is running, or undefined before the first reload. */
  running(): string | undefined;
  commands: Array<Record<string, unknown>>;
  /** Make the next ReloadFile answer `ok: false` and keep the old config, as kanata does for a file it can't parse. */
  rejectNextReload(): void;
  /** Make the next ReloadFile answer with the old config's layers (a reload that did not take). */
  ignoreNextReload(): void;
  stop(): void;
};

export function parseRunning(text: string): { layers: string[]; fakeKeys: string[] } {
  const layers = [...text.matchAll(/^\(deflayer\s+(\S+)/gm)].map((m) => m[1] as string);
  const block = /\(defvirtualkeys\s+([\s\S]*?)\n\)/.exec(text)?.[1] ?? "";
  const fakeKeys = block.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((n): n is string => !!n && !n.startsWith(";;"));
  return { layers, fakeKeys };
}

export function startFakeKanata(opts: { initialFile?: string; port?: number } = {}): FakeKanata {
  let file: string | undefined;
  let state = { layers: ["base"], fakeKeys: [] as string[] };
  let reject = false;
  let ignore = false;
  const commands: Array<Record<string, unknown>> = [];
  if (opts.initialFile) {
    file = opts.initialFile;
    state = parseRunning(readFileSync(file, "utf8"));
  }
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    socket: {
      open(s) {
        // kanata tells every client about layer changes; the client must skip what it didn't ask for.
        s.write(`${JSON.stringify({ LayerChange: { new: state.layers[0] ?? "base" } })}\n`);
      },
      data(s, chunk) {
        for (const line of Buffer.from(chunk).toString("utf8").split("\n")) {
          if (line.trim() === "") continue;
          const cmd = JSON.parse(line) as Record<string, Record<string, unknown>>;
          commands.push(cmd);
          const reply = (m: unknown) => s.write(`${JSON.stringify(m)}\n`);
          if (cmd.ReloadFile) {
            const path = String(cmd.ReloadFile.path);
            if (reject) {
              reject = false;
              reply({ ReloadResult: { ok: false } });
            } else if (ignore) {
              ignore = false;
              reply({ ReloadResult: { ok: true } });
            } else {
              try {
                state = parseRunning(readFileSync(path, "utf8"));
                file = path;
                reply({ ConfigFileReload: { new: path } });
                reply({ ReloadResult: { ok: true } });
              } catch {
                reply({ ReloadResult: { ok: false } });
              }
            }
          } else if (cmd.RequestLayerNames) reply({ LayerNames: { names: state.layers } });
          else if (cmd.RequestFakeKeyNames) reply({ FakeKeyNames: { names: state.fakeKeys } });
          else if (cmd.Hello) reply({ HelloOk: { version: "1.12.0", protocol: 1, capabilities: [] } });
        }
      },
    },
  });
  return {
    port: server.port,
    running: () => file,
    commands,
    rejectNextReload: () => { reject = true; },
    ignoreNextReload: () => { ignore = true; },
    stop: () => server.stop(true),
  };
}

/**
 * A stand-in kanata binary, for setup's `cmd` check and copy (D-498). It never remaps: `--version` prints a version and `--check` answers
 * a config the way kanata does. `no_cmd` is kanata built with its default features, as Homebrew builds it, which refuses the `cmd`
 * action with kanata's own words (parser/src/cfg/cmd.rs @ v1.12.0). `cmd` is a build with the feature, which accepts it, and `garbled`
 * fails for some other reason.
 */
export function writeFakeKanataBinary(dir: string, mode: "no_cmd" | "cmd" | "garbled" = "no_cmd", version = "1.12.0"): string {
  const path = join(dir, `kanata-${mode}`);
  const onCmd = {
    no_cmd: `printf '%s\\n' "Error:   × cmd is not enabled for this kanata executable. Use a cmd_allowed prebuilt" "  │ executable or compile with the feature: cmd." >&2; exit 1`,
    cmd: `echo "config file is valid"; exit 0`,
    garbled: `echo "Error: unexpected token" >&2; exit 1`,
  }[mode];
  writeFileSync(path, [
    "#!/bin/sh",
    `cfg=""`,
    `while [ $# -gt 0 ]; do case "$1" in -c|--cfg) cfg="$2"; shift ;; --version) echo "kanata ${version}"; exit 0 ;; esac; shift; done`,
    `if grep -q '(cmd' "$cfg"; then ${onCmd}; fi`,
    `echo "config file is valid"`,
    "",
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}
