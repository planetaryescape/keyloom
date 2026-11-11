// The page for an address the server doesn't know (R1-07). It is plain HTML with its own few styles, because the app's bundle
// is what failed to match; the colours are tokens.css's room, surface and ink, light and dark. The token goes into the link only
// when the request carried this session's own, so the page never echoes a value someone else put in the address.
const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function notFoundPage(token: string | null): Response {
  const home = token === null ? "/" : `/?t=${encodeURIComponent(token)}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · keyloom</title>
<style>
  :root { color-scheme: light dark; --room: #e4e5e8; --surface: #ffffff; --ink: #141519; --ink-2: #464a52; --line: rgb(16 18 24 / 0.09); --primary: #141519; --primary-ink: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --room: #0e0f12; --surface: #191a1e; --ink: #eef0f3; --ink-2: #b3b7bf; --line: rgb(255 255 255 / 0.08); --primary: #f3f4f6; --primary-ink: #111214; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--room); color: var(--ink);
    font: 14px/1.5 "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 420px; width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: var(--ink-2); }
  a { display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 8px; background: var(--primary); color: var(--primary-ink); text-decoration: none; font-weight: 600; }
  a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
</head>
<body>
<main>
<h1>keyloom has no page here</h1>
<p>This address isn't part of keyloom. Your layouts are where you left them.</p>
<a href="${escapeHtml(home)}">Open keyloom</a>
</main>
</body>
</html>
`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}
