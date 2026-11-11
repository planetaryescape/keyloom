// A refused put-on in its dialog (R3-01): the server's code becomes the words and the button the toast would offer, and the CLI's own
// sentence, which names commands, is never shown.
import { describe, expect, test } from "bun:test";
import { refusalProblem } from "../../src/web/sync/useSyncToasts.ts";
import { refusalOf } from "../../src/web/sync/words.ts";

const cli = "the Moonlander is running firmware keyloom didn't build. run `keyloom build x` and `keyloom flash --layout x`";

describe("refusalProblem", () => {
  test("a refusal gets its words and the page's own handler", () => {
    let opened = 0;
    const problem = refusalProblem({ code: "foreign_firmware", message: cli }, { open_release: () => void opened++ });
    expect(problem).toMatchObject({ message: "The keyboard runs firmware keyloom didn't build", action: { label: "Build and flash…" } });
    expect(JSON.stringify(problem)).not.toContain("keyloom build");
    problem?.action?.run();
    expect(opened).toBe(1);
  });

  test("kanata not running opens the keyboard's status, which every page has", () => {
    expect(refusalProblem({ code: "kanata_not_running", message: cli }, {})?.action?.label).toBe("Open keyboard status");
  });

  test("an archived config offers Restore, and a foreign kanata config Replace it…", () => {
    expect(refusalProblem({ code: "archived", message: cli }, { restore: () => {} })?.action?.label).toBe("Restore");
    expect(refusalProblem({ code: "kanata_foreign", message: cli }, { replace_foreign: () => {} })?.action?.label).toBe("Replace it…");
  });

  test("a refusal the page has no handler for keeps its words and has no button", () => {
    const problem = refusalProblem({ code: "archived", message: cli }, {});
    expect(problem?.message).toBe("This config is archived");
    expect(problem?.action).toBeUndefined();
  });

  test("a failure that isn't a refusal is left to the caller", () => {
    expect(refusalProblem({ code: "usage", message: "no" }, {})).toBeNull();
    expect(refusalProblem({ message: "Failed to fetch" }, {})).toBeNull();
    expect(refusalOf({ code: "not_found", message: "gone" })).toBeNull();
  });
});
