import { executeLegacyMessage } from "./agent-runs.ts";
import { messageModel, storeMessage, type SendMessageInput, type ChatOutcome } from "./conversations.ts";
import { transact } from "../persistence/transaction.ts";
import type { App } from "./context.ts";

/** Legacy streams retain their ownership; a copy enters the same durable handoff coordinator. */
export async function sendMessage(app: App, ref: string, input: SendMessageInput): Promise<ChatOutcome> {
  const model = await messageModel(app, ref, input);
  const prepared = transact(app.db, () => storeMessage(app, ref, input, model));
  return executeLegacyMessage(app, prepared, input);
}
