// A fake of kanata's TCP server (21): the same newline-JSON protocol on a loopback port, with a "running config" it reads from the
// file a ReloadFile names. It lets the apply, verify, disable and sync tests run without a remapper, a driver or root.
import { readFileSync } from "node:fs";

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
