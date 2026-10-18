// Mounted in the isolated synthetic browser to exercise the non-menu picker path too.
import { createRoot } from "react-dom/client";
import { ChatProviderStatusSchema } from "../../src/api/http.ts";
import { ProviderPicker } from "../../src/web/chat/ProviderPicker.tsx";
const status = ChatProviderStatusSchema.parse(await (await fetch("/api/chat/provider", { headers: { "x-keyloom-token": "dev-editor-token" } })).json());
const root = document.createElement("div");
document.body.append(root);
createRoot(root).render(<div style={{ transform: "translateZ(0)", overflow: "hidden", height: 80 }}><div className="chat" style={{ height: 80 }}><ProviderPicker token="dev-editor-token" status={status} pinned={null} onChanged={() => {}} /></div></div>);
