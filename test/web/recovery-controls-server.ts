// agent-work run -- bun test/web/recovery-controls-server.ts build /tmp/keyloom-recovery-controls
// bun test/web/recovery-controls-server.ts serve /tmp/keyloom-recovery-controls 4751
import { join } from "node:path";
const mode = process.argv[2];
const directory = process.argv[3];
if (!directory) throw new Error("Pass build|serve and a task-owned output directory");
if (mode === "build") {
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, "recovery-controls.fixture.tsx")], outdir: directory, target: "browser", format: "esm" });
  if (!result.success) throw new AggregateError(result.logs, "Fixture build failed");
} else if (mode === "serve") {
  const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.argv[4] ?? 4751), fetch(request) {
    const name = new URL(request.url).pathname.slice(1);
    if (name && !name.includes("/") && !name.includes("..")) return new Response(Bun.file(join(directory, name)));
    return new Response('<!doctype html><html lang="en"><head><title>Recovery controls</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/recovery-controls.fixture.css"></head><body><div id="root"></div><script type="module" src="/recovery-controls.fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
  } });
  console.log(server.url.href);
} else throw new Error("Use build or serve");
