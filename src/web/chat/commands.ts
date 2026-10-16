// ⌘K commands (24#how-it-fits, D-315): when what's typed names something keyloom can just do, the bar offers it as a row above
// "Ask keyloom", and Enter runs it. Matching is plain words, not a model, so it works with no model set up and never guesses wide.

export type Command =
  | { kind: "lab"; label: string; detail: string }
  | { kind: "new-config"; label: string; detail: string }
  | { kind: "switch"; id: string; label: string; detail: string }
  | { kind: "put-on"; id: string; name: string; label: string; detail: string };

export type CommandContext = {
  configs: readonly { id: string; name: string; onKeyboard: boolean }[];
  /** The config on screen. */
  currentId: string;
  /** "Moonlander", for "Put X on your Moonlander". */
  boardName: string;
};

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const has = (text: string, ...any: string[]) => any.some((w) => new RegExp(`(^| )${w}( |$)`).test(text));

// Chapter 24's ways in: "typing lab", "test my home row mods", "how fast are my fingers".
const LAB = (t: string) => has(t, "lab", "typing", "test", "finger speed", "fingers speed", "how fast") || /\bfingers?\b.*\b(speed|fast|slow)\b/.test(t);
const NEW_CONFIG = (t: string) => /\b(new|make|create|add|start)\b.*\b(config|layout)\b/.test(t) || /\b(config|layout)\b.*\bnew\b/.test(t);
const PUT_ON = (t: string) => /\bput\b.*\bon\b/.test(t) || has(t, "flash", "sync", "use") || /\bon (the|my|your) keyboard\b/.test(t);
const SWITCH = (t: string) => has(t, "switch", "open", "edit", "go to", "show", "change to");

/** The commands what's typed asks for, best first; at most four, so "Ask keyloom" stays in reach. */
export function matchCommands(text: string, ctx: CommandContext): Command[] {
  const t = words(text);
  if (t.length < 2) return [];
  const out: Command[] = [];
  if (LAB(t)) out.push({ kind: "lab", label: "Typing lab", detail: "Type for a few minutes; see what each finger does and fixes tried on your typing" });
  if (NEW_CONFIG(t)) out.push({ kind: "new-config", label: "New config", detail: `Another layout for your ${ctx.boardName}, kept beside this one` });

  // A config is named when its whole name is in the text; longer names first, so "Colemak DH" wins over "Colemak".
  const named = [...ctx.configs]
    .filter((c) => {
      const n = words(c.name);
      return n.length >= 2 && (` ${t} `).includes(` ${n} `);
    })
    .sort((a, b) => b.name.length - a.name.length);
  const current = ctx.configs.find((c) => c.id === ctx.currentId);
  const putting = PUT_ON(t);
  for (const c of named) {
    if (putting && !c.onKeyboard) out.push({ kind: "put-on", id: c.id, name: c.name, label: `Put ${c.name} on your ${ctx.boardName}`, detail: "Makes it the config that syncs, after one confirm" });
    else if (!putting && c.id !== ctx.currentId) out.push({ kind: "switch", id: c.id, label: `Switch to ${c.name}`, detail: c.onKeyboard ? `The config on your ${ctx.boardName}` : "Edit it; your keyboard keeps what it runs" });
  }
  // "Put this on the keyboard" names no config: it means the one on screen.
  if (putting && named.length === 0 && current !== undefined && !current.onKeyboard && /\b(this|it|keyboard)\b/.test(t)) {
    out.push({ kind: "put-on", id: current.id, name: current.name, label: `Put ${current.name} on your ${ctx.boardName}`, detail: "Makes it the config that syncs, after one confirm" });
  }
  // "switch to colemak" with no exact name still says what can be switched to, when a word of the text starts a config's name.
  if (named.length === 0 && SWITCH(t)) {
    for (const c of ctx.configs) {
      if (c.id === ctx.currentId) continue;
      const first = words(c.name).split(" ")[0] ?? "";
      if (first.length >= 3 && t.split(" ").some((w) => w.length >= 3 && first.startsWith(w))) {
        out.push({ kind: "switch", id: c.id, label: `Switch to ${c.name}`, detail: c.onKeyboard ? `The config on your ${ctx.boardName}` : "Edit it; your keyboard keeps what it runs" });
      }
    }
  }
  return out.slice(0, 4);
}
