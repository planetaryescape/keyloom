// UI-only synthetic fixture. No API, data directory, device or model adapter is attached.
import page from "./index.html";
const server = Bun.serve({
  hostname: "127.0.0.1", port: 4501,
  routes: { "/": page, "/instrument-sans.woff2": () => new Response(Bun.file("docs/screenshots/agent-experience/comps/instrument-sans.woff2")) },
});
console.log(`Synthetic component fixture: ${server.url}`);
