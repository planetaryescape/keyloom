// kanata's TCP server (21): newline-terminated JSON on a loopback port, started by the daemon with `-p 127.0.0.1:<port>`.
// keyloom asks it to reload a file and waits for the answer, then reads back the layer names and virtual keys. The port is
// plaintext and unauthenticated, which is acceptable on a single-user laptop because it is bound to loopback.

export class KanataConnectionError extends Error {
  override name = "KanataConnectionError";
}
export class KanataProtocolError extends Error {
  override name = "KanataProtocolError";
}

export type KanataEndpoint = { port: number; host?: string };

type Json = Record<string, unknown>;

/**
 * Sends one command and resolves with the first message that carries `reply`. kanata also pushes events (`LayerChange`,
 * `ConfigFileReload`) to every client, so lines that are not the answer are skipped.
 */
export function kanataRequest(endpoint: KanataEndpoint, command: Json, reply: string, timeoutMs: number): Promise<Json> {
  return new Promise<Json>((resolve, reject) => {
    let buffer = "";
    let done = false;
    let socket: { end(): void; write(data: string): number } | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.end();
      } catch {
        // already closed
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new KanataConnectionError(`kanata did not answer ${reply} within ${timeoutMs} ms`))), timeoutMs);
    Bun.connect({
      hostname: endpoint.host ?? "127.0.0.1",
      port: endpoint.port,
      socket: {
        open(s) {
          socket = s;
          s.write(`${JSON.stringify(command)}\n`);
        },
        data(_s, chunk) {
          buffer += Buffer.from(chunk).toString("utf8");
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf("\n");
            if (line === "") continue;
            let message: unknown;
            try {
              message = JSON.parse(line);
            } catch {
              continue;
            }
            if (typeof message !== "object" || message === null) continue;
            const m = message as Json;
            if (reply in m) return finish(() => resolve((m[reply] ?? {}) as Json));
            if ("Error" in m) return finish(() => reject(new KanataProtocolError(`kanata said: ${JSON.stringify(m.Error)}`)));
          }
        },
        error(_s, err) {
          finish(() => reject(new KanataConnectionError(`couldn't talk to kanata on port ${endpoint.port}: ${err.message}`)));
        },
        close() {
          finish(() => reject(new KanataConnectionError(`kanata closed the connection before answering ${reply}`)));
        },
        connectError(_s, err) {
          finish(() => reject(new KanataConnectionError(`kanata isn't listening on port ${endpoint.port} (${err.message})`)));
        },
      },
    }).catch((err: Error) => finish(() => reject(new KanataConnectionError(`kanata isn't listening on port ${endpoint.port} (${err.message})`))));
  });
}

export const DEFAULT_TIMEOUT_MS = 3000;

export async function reloadFile(e: KanataEndpoint, path: string, timeoutMs = 5000): Promise<{ ok: boolean }> {
  // `wait` makes kanata answer once the reload finished, so a bad file is an answer and not a silence.
  const r = await kanataRequest(e, { ReloadFile: { path, wait: true, timeout_ms: timeoutMs } }, "ReloadResult", timeoutMs + 1000);
  return { ok: r.ok === true };
}

export async function layerNames(e: KanataEndpoint, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string[]> {
  const r = await kanataRequest(e, { RequestLayerNames: {} }, "LayerNames", timeoutMs);
  return Array.isArray(r.names) ? r.names.filter((n): n is string => typeof n === "string") : [];
}

export async function fakeKeyNames(e: KanataEndpoint, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string[]> {
  const r = await kanataRequest(e, { RequestFakeKeyNames: {} }, "FakeKeyNames", timeoutMs);
  return Array.isArray(r.names) ? r.names.filter((n): n is string => typeof n === "string") : [];
}

export async function hello(e: KanataEndpoint, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ version: string; protocol: number | null }> {
  const r = await kanataRequest(e, { Hello: {} }, "HelloOk", timeoutMs);
  return { version: typeof r.version === "string" ? r.version : "unknown", protocol: typeof r.protocol === "number" ? r.protocol : null };
}
