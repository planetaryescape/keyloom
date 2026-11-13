// The MacBook's first run, through the real components (R11-01, R11-02): a Karabiner import shows the edit its card promises before the
// layout opens, and kanata's checklist, with its service installed and kanata not answering, restarts the service and shows kanata's log.
import { describe, expect, test } from "bun:test";
import type { BoardChoice, ImportResponse } from "../../src/api/http.ts";
import type { KanataLogResponse, RemapperSetupResponse, SetupActionResponse, SetupFinding } from "../../src/api/system-remapper.ts";
import { BoardCard } from "../../src/web/import/ImportScreen.tsx";
import { RemapperSetup } from "../../src/web/sync/RemapperSetup.tsx";
import type { SyncApi } from "../../src/web/sync/useSync.ts";
import { answerReads, button, mount, press, setUpDom } from "../helpers/dom.tsx";

await setUpDom();

const ENTRY = '{ "identifiers": { "is_keyboard": true, "product_id": 0, "vendor_id": 0 }, "ignore": true }';
const macbook: BoardChoice = {
  id: "apple/macbook-ansi", name: "MacBook keyboard (ANSI)", vendor: "Apple", firmware: "kanata", keyCount: 77, importers: ["karabiner-json"],
  display: undefined as never,
};

describe("the MacBook's import card", () => {
  const imported = (over: Partial<ImportResponse>): ImportResponse => ({ layoutId: "lay_1", revisionId: "rev_1", name: "macbook-from-karabiner", layers: 2, keysPerLayer: 77, warnings: [], ...over });

  test("a Karabiner import shows the entry with Copy and the warnings, and Open … opens the layout", async () => {
    answerReads({
      "/api/system/karabiner-config": { filename: "karabiner.json", content: "{}" },
      "/api/import": imported({ warnings: ["Not imported, left as it is in Karabiner: Hyper (an entry isn't a plain key to key mapping)"], karabinerEdit: { entry: ENTRY, unimported: 1 } }),
    });
    const opened: string[] = [];
    await mount(<BoardCard board={macbook} boards={[macbook]} token="t" onImported={(r) => opened.push(r.layoutId)} onStartedBlank={() => {}} activities={[]} />);
    await press("Read it from this Mac");
    // The layout waits for the person: the edit is what the card promised.
    expect(opened).toEqual([]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Imported macbook-from-karabiner, 2 layers");
    expect(text).toContain(ENTRY);
    expect(text).toContain("add this entry to the \"devices\" list");
    expect(text).toContain("Not imported, left as it is in Karabiner: Hyper");
    expect(text).toContain("1 rule keyloom didn't import stops working");
    expect(button("Copy")?.getAttribute("aria-label")).toBe("Copy the entry");
    // The drop zone is gone: a second drop would import the file again.
    expect(button("choose it")).toBeUndefined();
    await press("Open macbook-from-karabiner");
    expect(opened).toEqual(["lay_1"]);
  });

  // The first-run screen shows only while there are no layouts, and the new layout's event can come before the import's answer, so the
  // card holds the screen from the moment it sends the file until the person goes on.
  test("the card holds the screen behind it from the send until Open …, and lets go at once when there is nothing to tell", async () => {
    answerReads({ "/api/system/karabiner-config": { filename: "karabiner.json", content: "{}" }, "/api/import": imported({ karabinerEdit: { entry: ENTRY, unimported: 0 } }) });
    const holds: boolean[] = [];
    await mount(<BoardCard board={macbook} boards={[macbook]} token="t" onImported={() => {}} onStartedBlank={() => {}} activities={[]} onHold={(h) => holds.push(h)} />);
    await press("Read it from this Mac");
    expect(holds).toEqual([true]);
    await press("Open macbook-from-karabiner");
    expect(holds).toEqual([true, false]);
  });

  test("a card that goes away while it holds lets go", async () => {
    answerReads({ "/api/system/karabiner-config": { filename: "karabiner.json", content: "{}" }, "/api/import": imported({ warnings: ["w"] }) });
    const holds: boolean[] = [];
    const view = await mount(<BoardCard board={macbook} boards={[macbook]} token="t" onImported={() => {}} onStartedBlank={() => {}} activities={[]} onHold={(h) => holds.push(h)} />);
    await press("Read it from this Mac");
    await view.render(<p>gone</p>);
    expect(holds).toEqual([true, false]);
  });

  test("a failed import lets the hold go", async () => {
    answerReads({ "/api/system/karabiner-config": { filename: "karabiner.json", content: "{}" } });
    const holds: boolean[] = [];
    await mount(<BoardCard board={macbook} boards={[macbook]} token="t" onImported={() => {}} onStartedBlank={() => {}} activities={[]} onHold={(h) => holds.push(h)} />);
    await press("Read it from this Mac");
    expect(holds).toEqual([true, false]);
  });

  test("an import with nothing to tell opens the layout at once", async () => {
    answerReads({ "/api/system/karabiner-config": { filename: "karabiner.json", content: "{}" }, "/api/import": imported({}) });
    const opened: string[] = [];
    await mount(<BoardCard board={macbook} boards={[macbook]} token="t" onImported={(r) => opened.push(r.layoutId)} onStartedBlank={() => {}} activities={[]} />);
    await press("Read it from this Mac");
    expect(opened).toEqual(["lay_1"]);
  });
});

describe("kanata's checklist when its service is installed and kanata doesn't answer", () => {
  const f = (code: SetupFinding["code"], status: SetupFinding["status"]): SetupFinding => ({ code, name: code, status, detail: "x" });
  const notAnswering = (driver: SetupFinding["status"] = "ok"): RemapperSetupResponse => ({
    platform: "darwin", canInstall: true, install: { state: "idle", action: null, log: [], failure: null },
    kanata: { version: "1.12.0", wanted: "1.12.0", update: null, path: "/opt/homebrew/bin/kanata", copyVersion: null }, driverVersion: "6.2.0",
    findings: [f("kanata_version", "ok"), f("driver_mismatch", driver), f("permissions", "unknown"), f("daemon_missing", "ok"), f("kanata_updated", "ok"), f("port_closed", "warn")],
  });

  function fakeSync(status: RemapperSetupResponse, answers: { restart?: SetupActionResponse; log?: KanataLogResponse } = {}) {
    const calls: string[] = [];
    const sync = {
      token: "t",
      remapperSetup: {
        status: async () => status,
        installKanata: async () => ({ ok: true }), cancelInstall: async () => ({ ok: true }), openSettings: async () => ({ ok: true }),
        startKanata: async (id: string) => (calls.push(`start ${id}`), { ok: true }),
        restartKanata: async (id: string) => (calls.push(`restart ${id}`), answers.restart ?? { ok: true }),
        kanataLog: async () => (calls.push("log"), answers.log ?? { ok: true, lines: ["kanata line one", "kanata line two"] }),
      },
    } as unknown as SyncApi;
    return { sync, calls };
  }

  test("the permissions come first, then the step with Restart kanata's service and Show kanata's log; the log shows in place", async () => {
    const { sync, calls } = fakeSync(notAnswering());
    await mount(<RemapperSetup sync={sync} boardId="apple/macbook-ansi" />);
    const titles = [...document.querySelectorAll(".sync-setup-title")].map((el) => el.textContent);
    expect(titles.indexOf("Allow kanata in Privacy & Security")).toBeLessThan(titles.indexOf("kanata's service is installed, but kanata isn't answering"));
    expect(button("Set up and start kanata")).toBeUndefined();
    await press("Show kanata's log");
    expect(calls).toEqual(["log"]);
    expect(document.querySelector('[aria-label="What kanata wrote last"]')?.textContent).toBe("kanata line one\nkanata line two");
  });

  test("a restart kanata still doesn't answer after says so, beside the step's own Show kanata's log", async () => {
    const { sync, calls } = fakeSync(notAnswering(), { restart: { ok: false, code: "still_not_answering", reason: "x" } });
    await mount(<RemapperSetup sync={sync} boardId="apple/macbook-ansi" />);
    await press("Restart kanata's service");
    expect(calls).toEqual(["restart apple/macbook-ansi"]);
    expect(document.querySelector(".sync-setup-problem")?.textContent).toContain("keyloom restarted kanata's service, but kanata still doesn't answer.");
    // One Show kanata's log, the step's own, right above the line.
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent === "Show kanata's log")).toHaveLength(1);
  });

  test("a restart refused because the service isn't setup's offers Set up and start kanata beside the reason", async () => {
    const { sync, calls } = fakeSync(notAnswering(), { restart: { ok: false, code: "service_outdated", reason: "x" } });
    await mount(<RemapperSetup sync={sync} boardId="apple/macbook-ansi" />);
    await press("Restart kanata's service");
    await press("Set up and start kanata");
    expect(calls).toEqual(["restart apple/macbook-ansi", "start apple/macbook-ansi"]);
  });

  test("with the driver still to install, Restart is off with the reason beside it, and the log still opens", async () => {
    const { sync } = fakeSync(notAnswering("fail"));
    await mount(<RemapperSetup sync={sync} boardId="apple/macbook-ansi" />);
    expect(button("Restart kanata's service")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Install the driver above first.");
    expect(button("Show kanata's log")?.disabled).toBe(false);
  });
});
