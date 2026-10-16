// keyloom serve with the typing lab on a scripted keyboard, for looking at the lab in a browser and for its screenshot gate (D-314).
// When the lab starts listening, a fake Moonlander types SCRIPT (lab-world.ts) over the real stream protocol; the browser types the
// same text. The replay is the model. Nothing here can reach a real keyboard: the real transports are refused (no-real-flash.ts).
//
//   bun test/helpers/demo-lab.ts <data dir> <port>
import "./no-real-flash.ts";
import { getLayout, listLayouts, openApp } from "../../src/app/index.ts";
import { serve } from "../../src/cli/serve.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPT, scriptedLabDeps } from "./lab-world.ts";

const [dataDir, portArg] = process.argv.slice(2);
if (!dataDir || !portArg) throw new Error("usage: bun test/helpers/demo-lab.ts <data dir> <port>");
const app = openApp({ dataDir });
const moon = listLayouts(app).find((l) => l.boardId === "zsa/moonlander");
if (!moon) throw new Error("the data dir has no Moonlander layout");
const board = getLayout(app, moon.id).board.definition;
// <data dir>/lab-script.txt, when it exists, is what the hands type (the finger drill's text, say); SCRIPT otherwise.
const scriptFile = join(dataDir, "lab-script.txt");
const script = () => (existsSync(scriptFile) ? readFileSync(scriptFile, "utf8").trim() : SCRIPT);
const running = serve(app, { port: Number(portArg), open: false, lab: scriptedLabDeps(board, () => getLayout(app, moon.id).document, { delayMs: 400, script }) });
console.log(running.url);
