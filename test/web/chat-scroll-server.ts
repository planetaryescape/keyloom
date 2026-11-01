// Synthetic long-reply fixture. No database, credentials, builds or physical keyboards.
import { startServer } from "../../src/server/start-server.ts";
import { FakeChat } from "../helpers/fake-chat-backend.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { devSample } from "../helpers/dev-sample.ts";

const editor = new FakeEditor(await devSample());
const chat = new FakeChat(editor, "moonlander-daily", {
  tokenDelayMs: 0,
  stepMs: 0,
  replyText: Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: Preview this dedicated Option key on the keyboard before applying.`).join("\n\n"),
});
const server = startServer({ port: Number(process.argv[2] ?? 4517), token: "dev-editor-token", source: editor.source(), editor, chat });
console.log(server.url);
