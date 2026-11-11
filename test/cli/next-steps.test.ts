// The terminal's next steps (R3-11, R3-25): each failure names the command that gets past it, and the page's shared sentences don't.
import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { classifyModelError } from "../../src/agent/anthropic-model.ts";
import { ModelError } from "../../src/app/index.ts";
import { checkNextStep } from "../../src/cli/commands/firmware.ts";
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
});
