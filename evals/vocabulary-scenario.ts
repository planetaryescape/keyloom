import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatOutcome, type SendMessageInput, closeApp, openApp, sendMessage } from "../src/app/index.ts";
import { createLayout } from "../src/persistence/layouts.ts";
import { tempDir } from "../test/helpers/tmp.ts";
import { costLine, evalProvider, namesNoKeyNumbers, reportFile } from "./provider.ts";
import { vocabularyFixture } from "./vocabulary-fixture.ts";
import type { homeRowModsPasses } from "./vocabulary-oracles.ts";

export async function runVocabularyScenario(name: string, message: string, passes: typeof homeRowModsPasses): Promise<void> {
  const { board, before } = vocabularyFixture();
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layout } = createLayout(app.db, { name: "Synthetic QWERTY", layout: before, summary: "D-006 eval start", origin: "import" });
    const outcomes: ChatOutcome[] = [];
    let conversationId: string | undefined;
    for (let turn = 0; turn < 3; turn++) {
      const input: SendMessageInput = {
        provider: evalProvider,
        message: turn === 0 ? message : "Use the defaults and propose the change now. Keep the requested letters and modifiers exactly as asked.",
      };
      if (conversationId) input.conversationId = conversationId;
      const outcome = await sendMessage(app, layout.id, input);
      outcomes.push(outcome);
      conversationId = outcome.conversationId;
      if (outcome.proposals.length > 0 || outcome.status !== "complete") break;
    }
    const proposals = outcomes.flatMap((o) => o.proposals);
    const checks = {
      completed: outcomes.length > 0 && outcomes.every((o) => o.status === "complete"),
      namesKeysNotNumbers: namesNoKeyNumbers(outcomes),
      proposedSomething: proposals.length > 0,
      everyAlternativeMeetsRequest: proposals.length > 0 && proposals.every((p) => passes(board, before, p)),
    };
    const usage = outcomes.reduce((a, o) => ({
      inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens,
      cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens,
    }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
    const date = new Date().toISOString().slice(0, 10);
    const first = outcomes[0];
    const report = [
      `# ${name} eval, ${date}, ${evalProvider}, ${first?.model} (effort ${first?.effort})`, "",
      ...Object.entries(checks).map(([key, ok]) => `- ${ok ? "pass" : "FAIL"}: ${key}`), "",
      `Turns: ${outcomes.length}. Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache read, ${usage.cacheCreationTokens} cache write.`,
      costLine(outcomes, usage), "", "## Agent replies",
      ...outcomes.map((o, i) => `### Turn ${i + 1}\n${o.text}`), "", "## Proposals",
      ...proposals.map((p) => `### ${p.title}\n${p.explanation}\n\nOps: ${JSON.stringify(p.ops)}\nValidation: ${JSON.stringify(p.validation)}`),
    ].join("\n");
    const dir = join(import.meta.dir, "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, reportFile(date, first?.model, first?.effort, name)), `${report}\n`);
    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)).toEqual([]);
  } finally {
    closeApp(app);
  }
}
