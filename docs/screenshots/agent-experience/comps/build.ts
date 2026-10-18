// Rebuilds this static design artifact only. Does not run Keyloom workflows.
// Renderer snapshot is from scripts/dev-editor.ts (synthetic fixture), base c5efcb5.
import { resolve } from 'node:path';
const here = import.meta.dir;
const root = resolve(here, '../../../..');
const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error('Usage: bun docs/screenshots/agent-experience/comps/build.ts <agent-browser renderer JSON>');
const capture = await Bun.file(snapshotPath).json();
const snapshot = capture.data?.result ?? capture;
if (!snapshot.board || !snapshot.width) throw new Error('Missing incumbent renderer snapshot');
const css = (await Promise.all(['tokens.css','keyboard/keyboard.css','keyboard/colourway.css'].map(path=>Bun.file(resolve(root,'src/web',path)).text()))).join('\n');
let template = await Bun.file(resolve(here,'proposal.template.html')).text();
const fontFile = Bun.file(resolve(here,'instrument-sans.woff2'));
const font = await fontFile.exists() ? `@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${Buffer.from(await fontFile.arrayBuffer()).toString('base64')}) format('woff2')}` : '';
template = template.replace('__INCUMBENT_CSS__',css).replace('__FONT__',font).replace('__BOARD__',snapshot.board).replaceAll('__BOARD_WIDTH__',String(snapshot.width)).replaceAll('__BOARD_HEIGHT__',String(snapshot.height));
await Bun.write(resolve(here,'index.html'),template);
await Bun.write(resolve(here,'renderer-snapshot.json'),JSON.stringify(snapshot));
console.log(resolve(here,'index.html'));
