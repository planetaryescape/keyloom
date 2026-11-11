// A refused put-on in its dialog (R3-01): the server's code becomes the words and the button the toast would offer, and the CLI's own
// sentence, which names commands, is never shown.
import { describe, expect, test } from "bun:test";
import { ApiError } from "../../src/web/api.ts";
import { refusalProblem } from "../../src/web/sync/useSyncToasts.ts";
import { knownRefusal } from "../../src/web/sync/words.ts";

const cli = "the Moonlander is running firmware keyloom didn't build. run `keyloom build x` and `keyloom flash --layout x`";
const refused = (code?: string) => new ApiError(400, cli, code === undefined ? {} : { code });

describe("refusalProblem", () => {
  test("a refusal gets its words and the page's own handler", () => {
    let opened = 0;
    const problem = refusalProblem(refused("foreign_firmware"), { open_release: () => void opened++ });
    expect(problem).toMatchObject({ message: "The keyboard runs firmware keyloom didn't build", action: { label: "Build and flash…" } });
    expect(JSON.stringify(problem)).not.toContain("keyloom build");
    problem?.action?.run();
    expect(opened).toBe(1);
  });

  test("kanata not running opens the keyboard's status where the page has it", () => {
    expect(refusalProblem(refused("kanata_not_running"), { open_status: () => {} })?.action?.label).toBe("Open keyboard status");
  });

  test("an archived config offers Restore, and a foreign kanata config Replace it…", () => {
    expect(refusalProblem(refused("archived"), { restore: () => {} })?.action?.label).toBe("Restore");
    expect(refusalProblem(refused("kanata_foreign"), { replace_foreign: () => {} })?.action?.label).toBe("Replace it…");
  });

  test("a refusal the page has no handler for keeps its words and has no button", () => {
    const problem = refusalProblem(refused("kanata_not_running"), {});
    expect(problem?.message).toBe("kanata isn't running");
    expect(problem?.action).toBeUndefined();
  });

  test("a refusal whose fix this page lacks opens the config whose page has it, and says which button is there", () => {
    let opened = 0;
    const problem = refusalProblem(refused("kanata_not_running"), {}, () => ({ name: "Travel", open: () => void opened++ }));
    expect(problem).toMatchObject({
      message: "kanata isn't running",
      detail: "The keyboard's status lists what is missing, with a button for each. Travel's page has Open keyboard status.",
      action: { label: "Open Travel" },
    });
    problem?.action?.run();
    expect(opened).toBe(1);
    expect(refusalProblem(refused("foreign_firmware"), {}, () => ({ name: "Travel", open: () => {} }))?.detail).toEndWith("Travel's page has Build and flash.");
    // A handler on this page wins, and a refusal with no fix anywhere gets no button.
    expect(refusalProblem(refused("foreign_firmware"), { open_release: () => {} }, () => ({ name: "Travel", open: () => {} }))?.action?.label).toBe("Build and flash…");
    expect(refusalProblem(refused("not_connected"), {}, () => ({ name: "Travel", open: () => {} }))?.action).toBeUndefined();
  });

  test("the page with the fix is chosen per fix: a fix no other page has keeps the words and no button", () => {
    const onlyBuild = (action: string) => (action === "open_release" ? { name: "Travel", open: () => {} } : undefined);
    expect(refusalProblem(refused("foreign_firmware"), {}, onlyBuild)?.action?.label).toBe("Open Travel");
    const status = refusalProblem(refused("kanata_not_running"), {}, onlyBuild);
    expect(status?.action).toBeUndefined();
    expect(status?.detail).not.toContain("Travel");
  });

  test("a failure that isn't a refusal is left to the caller", () => {
    expect(refusalProblem(refused("usage"), {})).toBeNull();
    expect(refusalProblem(refused(), {})).toBeNull();
    expect(knownRefusal("not_found")).toBeNull();
  });
});
