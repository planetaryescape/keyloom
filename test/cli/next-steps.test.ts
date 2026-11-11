// The terminal's next steps (R3-11, R3-25): each failure names the command that gets past it, and the page's shared sentences don't.
import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { classifyModelError } from "../../src/agent/anthropic-model.ts";
import { ModelError } from "../../src/app/index.ts";
import { checkNextStep } from "../../src/cli/commands/firmware.ts";
import { remapApplyFailure } from "../../src/cli/commands/remap.ts";
import { commandArg } from "../../src/app/command-words.ts";
import { misfitHint } from "../../src/app/firmware.ts";
import type { LayoutView } from "../../src/app/index.ts";
import { classify } from "../../src/cli/errors.ts";

describe("flash --check", () => {
  test("names what to run for each finding, and nothing once the keyboard runs this or a later build", () => {
    expect(checkNextStep("other_build", "fl_1", "bld_1")).toEqual([["next", "keyloom flash --build bld_1"]]);
    expect(checkNextStep("bootloader", "fl_1", "bld_1")).toEqual([["next", "keyloom flash --build bld_1"]]);
    expect(checkNextStep("absent", "fl_1", "bld_1")).toEqual([["next", "plug the keyboard in by USB, then keyloom flash --check fl_1"]]);
    expect(checkNextStep("missing_halves", "fl_1", "bld_1")[0]?.[1]).toContain("keyloom flash --check fl_1");
    expect(checkNextStep("this_build", "fl_1", "bld_1")).toEqual([]);
    expect(checkNextStep("later_build", "fl_1", "bld_1")).toEqual([]);
  });
});

describe("a refused API key", () => {
  test("the shared sentence names the environment variable and no command; the terminal adds provider key set", () => {
    const err = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
    const shared = classifyModelError(err, "openrouter");
    expect(shared?.message).toContain("OPENROUTER_API_KEY");
    expect(shared?.message).not.toContain("keyloom provider");
    expect(classify(new ModelError("auth", shared?.message ?? ""), "unused").message).toContain("`keyloom provider key set <provider>`");
    expect(classify(new ModelError("rate_limit", "busy"), "unused").message).toBe("busy");
  });

  test("the page's out-of-credits and full-conversation sentences name no flag; the terminal adds one (D-517, D-518)", () => {
    expect(classify(new ModelError("no_credits", "OpenRouter says the account is out of credits."), "unused").message).toContain("--provider");
    expect(classify(new ModelError("context_full", "This conversation is too long."), "unused").message).toContain("omit --conversation");
  });
});

describe("names in suggested commands (#285 review)", () => {
  test("a name that a shell would split or expand is quoted; a plain one is left as it is", () => {
    expect(commandArg("synchronized")).toBe("synchronized");
    expect(commandArg("lay_01J9")).toBe("lay_01J9");
    expect(commandArg("My Layout")).toBe("'My Layout'");
    expect(commandArg("BK's $HOME")).toBe(`'BK'\\''s $HOME'`);
  });

  test("the misfit hint quotes a layout name with spaces", () => {
    const view = { layout: { name: "My Layout" }, board: { definition: { keyCount: 2, name: "Tiny" } }, document: { layers: [{ bindings: [1] }] } } as unknown as LayoutView;
    expect(misfitHint(view)).toContain("`keyloom version list 'My Layout'`");
    expect(misfitHint(view)).toContain("`keyloom version restore 'My Layout' <version>`");
  });

  test("remap apply over a file keyloom didn't write names --overwrite with the layout, quoted, in the terminal only", () => {
    expect(remapApplyFailure("not_keyloom", "keyloom.kbd wasn't written by keyloom, so keyloom left it alone.", "My Layout")).toBe("not_keyloom: keyloom.kbd wasn't written by keyloom, so keyloom left it alone. To replace it and keep a copy, run `keyloom remap apply 'My Layout' --overwrite`.");
    expect(remapApplyFailure("check", "kanata refused it", "base")).toBe("check: kanata refused it");
  });
});
