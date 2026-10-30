import { describe, expect, test } from "bun:test";
import type { Reference } from "../../src/layout/references.ts";
import { runCli } from "../../src/cli/main.ts";
import { HOLD_CAP, ReplyStream } from "../../src/cli/reference-stream.ts";
import type { Io } from "../../src/cli/output.ts";
import { listConfigs, openApp } from "../../src/app/index.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { type ScriptStep, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { draft } from "../helpers/ops.ts";

/** The names the terminal prints for markers, so a test can read the words without a database. */
const words = (reference: Reference) =>
  reference.kind === "config" ? `config ${reference.id}`
    : reference.kind === "proposal" ? `proposal ${reference.id}`
      : reference.kind === "layer" ? `layer ${reference.layerId}`
        : `key ${reference.position}`;

const stream = (deltas: readonly string[]) => {
  const reply = new ReplyStream(words);
  const out = deltas.map((delta) => reply.push(delta)).join("");
  return out + reply.flush();
};

describe("a reply streamed with markers in it (D-468)", () => {
  test("a marker split across two deltas is read once it closes", () => {
    expect(stream(["on the ", "{layer:ba", "se} now"])).toBe("on the layer base now");
    // Split inside the kind, inside the id and before the closing brace.
    expect(stream(["{", "config:lay_a}"])).toBe("config lay_a");
    expect(stream(["{key:ba", "se:6", "0}"])).toBe("key 60");
    // Two markers, one per delta.
    expect(stream(["{layer:base}", " and ", "{key:base:60}"])).toBe("layer base and key 60");
  });

  test("words go out as they arrive, and nothing is held that is not a possible marker", () => {
    expect(stream(["No braces here. ", "Still none."])).toBe("No braces here. Still none.");
    let reply = new ReplyStream(words);
    expect(reply.push("plain ")).toBe("plain ");
    expect(reply.push("text")).toBe("text");
    expect(reply.flush()).toBe("");
  });

  test("a brace that never closes is printed as the model wrote it, and the hold is capped", () => {
    expect(stream(["half {layer:base"])).toBe("half {layer:base");
    // A `{` with no `}` within the cap is printed, and what follows is read normally.
    const long = `{${"x".repeat(HOLD_CAP)}`;
    expect(stream([long])).toBe(long);
    expect(stream([long, " {layer:base}"])).toBe(`${long} layer base`);
    // A brace group that closes but is not a marker is printed whole, and a marker after it still reads.
    expect(stream(["{screen:history}", " then {layer:base}"])).toBe("{screen:history} then layer base");
  });

  test("a marker inside backticks stays as the model typed it, and one in a bold span still reads", () => {
    expect(stream(["run `keyloom config use {config:lay_a}`"])).toBe("run `keyloom config use {config:lay_a}`");
    expect(stream(["**on {layer:base} now**"])).toBe("**on layer base now**");
    // Split inside a bold span, and inside the marker it holds: the hold crosses the delta and the asterisks are ordinary text.
    expect(stream(["**on {lay", "er:base} now** and {key:base:6", "0}"])).toBe("**on layer base now** and key 60");
    // A backtick that never closes is just a character, so a marker after it is still a marker.
    expect(stream(["half `code {layer:base}"])).toBe("half `code layer base");
  });

  test("a code span split across deltas keeps the marker inside it literal", () => {
    // The code span opens in one delta and closes in the next, with the marker across the same break: before the fix the opening
    // backtick went out as a lone character and the marker resolved inside the code.
    expect(stream(["run `keyloom config use ", "{config:lay_a}` to open it"])).toBe("run `keyloom config use {config:lay_a}` to open it");
    expect(stream(["run `{config:lay_", "a}`"])).toBe("run `{config:lay_a}`");
    expect(stream(["`a ", "b` and {layer:base}"])).toBe("`a b` and layer base");
    // A backtick that never closes still goes out, and the reply behind it is read normally once the hold cap is reached.
    const open = "`" + "x".repeat(HOLD_CAP - 1);
    expect(stream([open])).toBe(open);
    expect(stream([open, " {layer:base}"])).toBe(`${open} layer base`);
  });

  test("a stray brace before a real marker does not swallow it", () => {
    expect(stream(["{ {layer:base}"])).toBe("{ layer base");
    expect(stream(["{oops", " {layer:base} and {key:base:60}"])).toBe("{oops layer base and key 60");
    // The group that does close is still printed whole, and what follows still reads.
    expect(stream(["{screen:history} then {layer:base}"])).toBe("{screen:history} then layer base");
  });
});

async function cli(args: string[], deps: Parameters<typeof runCli>[2] = {}) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io, deps), out, err };
}

const propose = {
  alternatives: [{
    title: "Plain Option on layer 2",
    ops: [{ op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "modifier", mods: ["LALT"] } }],
    explanation: "Hold layer 2 with your right hand, then tap S twice.",
    tradeoffs: { gains: ["Option-Option works"], costs: ["One more layer to remember"] },
    decisionDraft: draft(),
  }],
};

/** The change set the proposal tool just saved, read back out of its own result — the loopback provider, no paid model. */
const proposed = (step: { toolResults: readonly string[] }): string => {
  const id = step.toolResults.join("\n").match(/cs_[0-9A-Z]{26}/)?.[0];
  if (id === undefined) throw new Error(`the proposal result named no change set: ${step.toolResults.join(" | ")}`);
  return id;
};

describe("keyloom chat resolves what a reply names", () => {
  test("prints the names inline, then the command for the config and the proposal only", async () => {
    const { app, dir, layoutId } = await optionOptionApp();
    const other = listConfigs(app).find((config) => config.id !== layoutId);
    if (other === undefined) throw new Error("the fixture needs a second config to name");
    let id = "";
    const script: ScriptStep[] = [
      { blocks: [{ text: "Here is " }, { tool: "propose_changes", input: propose }] },
      (seen) => {
        id = proposed(seen);
        // The loopback provider sends each text block as two deltas split at its midpoint, so this one block is a marker cut in two.
        return {
          blocks: [
            { text: `Saved on {config:${other.id}} and ` },
            { text: "{key:layer-0:30}" },
            { text: ` on the {layer:layer-2} layer, and {proposal:${id}} is on the board.` },
          ],
        };
      },
    ];
    const r = await cli(["chat", "bk", "--message", "Option is on S", "--format", "table", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(script).client) });
    expect(r.code).toBe(0);
    // Proved, not assumed: the marker that arrived in two deltas is the key one.
    const marker = "{key:layer-0:30}";
    expect(Math.ceil(marker.length / 2)).toBeGreaterThan("{key:".length);
    expect(marker.slice(0, Math.ceil(marker.length / 2))).not.toContain("}");
    // Every marker reads as a name: no braces in the reply the reader sees.
    expect(r.out).toContain(`Saved on ${other.name} and S hold ⌥ on the Layer 2 layer, and Plain Option on layer 2 is on the board.`);
    expect(r.out.split("conversation ")[0]).not.toContain("{");
    // One line per reference that has a command, and nothing for the layer or the key.
    expect(r.out.match(/to open it: keyloom config use \S+/g)).toEqual([`to open it: keyloom config use ${other.id}`]);
    expect(r.out.match(/to review it: keyloom change show \S+/g)).toEqual([`to review it: keyloom change show ${id}`]);
  });

  test("an id nothing answers to falls back to words, and an unclosed marker prints literally", async () => {
    const { dir } = await optionOptionApp();
    const script: ScriptStep[] = [{ blocks: [{ text: "Gone: {config:lay_00000000000000000000000000} and {layer:gone} and {key:gone:3}, plus half {config:lay_" }] }];
    const r = await cli(["chat", "bk", "--message", "x", "--format", "table", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(script).client) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Gone: lay_00000000000000000000000000 and gone and gone, plus half {config:lay_");
    expect(r.out).not.toMatch(/to open it|to review it/);
  });

  test("a marker written inside a code span stays code, inline and in the routes", async () => {
    const { app, dir, layoutId } = await optionOptionApp();
    const other = listConfigs(app).find((config) => config.id !== layoutId);
    if (other === undefined) throw new Error("the fixture needs a second config to name");
    // The backticked command is the one BK can paste; the sentence around it names the same config for the chip. Only the marker outside
    // the code span resolves, and only it prints a route.
    const text = `Open it with \`keyloom config use {config:${other.id}}\`, or press {config:${other.id}}.`;
    const r = await cli(["chat", "bk", "--message", "x", "--format", "table", "--data-dir", dir], { model: anthropicModel(fakeAnthropic([{ blocks: [{ text }] }]).client) });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Open it with \`keyloom config use {config:${other.id}}\`, or press ${other.name}.`);
    // One route, for the one reference the reader can see.
    expect(r.out.match(/to open it: keyloom config use \S+/g)).toEqual([`to open it: keyloom config use ${other.id}`]);
  });

  test("a config the same turn made is named, not printed as its id", async () => {
    const { app, dir, layoutId } = await optionOptionApp();
    const other = listConfigs(app).find((config) => config.id !== layoutId);
    if (other === undefined) throw new Error("the fixture needs a second config to name");
    let made = "";
    const script: ScriptStep[] = [
      // Naming an existing config first fills the reader's config list, so the turn's own new config is only found if the reader looks
      // again when a marker names something the list does not have.
      { blocks: [{ text: `Saved on {config:${other.id}} first. ` }, { tool: "create_config", input: { name: "Colemak on this board", from: "this" } }] },
      (seen) => {
        const ids = [...seen.toolResults.join("\n").matchAll(/lay_[0-9A-Z]{26}/g)].map((m) => m[0]).filter((id) => id !== other.id);
        made = ids.at(-1) ?? "";
        if (made === "") throw new Error(`the create_config result named no config: ${seen.toolResults.join(" | ")}`);
        return { blocks: [{ text: `The new one is {config:${made}}, a copy of this config.` }] };
      },
    ];
    const r = await cli(["chat", "bk", "--message", "make me a Colemak config", "--format", "table", "--data-dir", dir], { model: anthropicModel(fakeAnthropic(script).client) });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Saved on ${other.name} first.`);
    expect(r.out).toContain("The new one is Colemak on this board, a copy of this config.");
    // The reply the reader sees names it; the id only appears in the routes and in the "made config" block that follows.
    expect(r.out.split("to open it:")[0]).not.toContain(made);
    expect(r.out).toContain(`to open it: keyloom config use ${made}`);
  });

  test("JSON keeps the reply exactly as the model wrote it, markers included", async () => {
    const { app, dir, layoutId } = await optionOptionApp();
    const other = listConfigs(app).find((config) => config.id !== layoutId);
    if (other === undefined) throw new Error("the fixture needs a second config to name");
    const text = `Saved on {config:${other.id}} and the {key:layer-0:30} key.`;
    const r = await cli(["chat", "bk", "--message", "x", "--format", "json", "--data-dir", dir], { model: anthropicModel(fakeAnthropic([{ blocks: [{ text }] }]).client) });
    expect(r.code).toBe(0);
    // The choice (D-468): the stored and machine-read reply keeps the markers, so a reader that draws no references still has the ids
    // and nothing has to know how this client renders them. Only the human-facing table resolves them.
    expect(JSON.parse(r.out).text).toBe(text);
    // A reply read back later, after a reload, is the same stored text: nothing rewrote the message.
    const reloaded = await cli(["conversations", "show", JSON.parse(r.out).conversation_id, "--format", "json", "--data-dir", dir]);
    expect(reloaded.out).toContain(text);
  });
});
