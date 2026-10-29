// Build through agent-work; serve the resulting isolated fixture outside the build queue.
// agent-work run -- bun test/web/chat-handoff-recovery-server.ts build /tmp/keyloom-handoff-fixed
// bun test/web/chat-handoff-recovery-server.ts serve /tmp/keyloom-handoff-fixed 4514
import { join } from "node:path";
const mode = process.argv[2];
const directory = process.argv[3];
if (!directory) throw new Error("Pass build|serve and a task-owned output directory");
if (mode === "build") {
  const baseline = process.argv.includes("--baseline");
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "chat-handoff-recovery.fixture.tsx")], outdir: directory, target: "browser", format: "esm",
    plugins: baseline ? [{ name: "reviewed-baseline-hook", setup(build) {
      build.onLoad({ filter: /\/chat\/useChat\.ts$/ }, () => {
        const source = Bun.spawnSync(["git", "show", "8c3dfe7733d62a175976af80281e6ca1f3b460e1:src/web/chat/useChat.ts"], { stdout: "pipe", stderr: "pipe" });
        if (source.exitCode !== 0) throw new Error(source.stderr.toString());
        return { contents: source.stdout.toString(), loader: "ts" };
      });
    } }] : [],
  });
  if (!result.success) throw new AggregateError(result.logs, "Fixture build failed");
  console.log(`Built ${baseline ? "8c3dfe7 baseline" : "current"} hook fixture in ${directory}`);
} else if (mode === "serve") {
  const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.argv[4] ?? 0), fetch(request) {
    return new URL(request.url).pathname === "/fixture.js"
      ? new Response(Bun.file(join(directory, "chat-handoff-recovery.fixture.js")), { headers: { "content-type": "text/javascript" } })
      : new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
  } });
  console.log(server.url.href);
} else throw new Error("Use build or serve");
