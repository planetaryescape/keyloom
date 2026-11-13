// R11-07: a config list that couldn't be read left the switcher empty and silent, with Archive on for the config on the keyboard, and the
// chat's config card said "Couldn't load this config right now." with no button. Driven through the real hook, menu and card.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiConfig } from "../../src/api/configs.ts";
import { ConfigCardList } from "../../src/web/chat/ConfigCards.tsx";
import { ConfigMenu } from "../../src/web/configs/ConfigMenu.tsx";
import { CARD_READ_FAILED, configCardView } from "../../src/web/configs/config-card.ts";
import { CONFIG_LIST_FAILED, archiveWaits, configListWords } from "../../src/web/configs/config-list-words.ts";
import { useConfigs } from "../../src/web/configs/useConfigs.ts";
import { INTERNAL_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";
import { answerReads, button, mount, press, setUpDom } from "../helpers/dom.tsx";

await setUpDom();

const config = (over: Partial<ApiConfig> = {}): ApiConfig => ({
  id: "lay_daily", name: "Daily", boardId: "zsa/moonlander", boardName: "Moonlander", headRevisionId: "rev_1", createdAt: 0, updatedAt: 0,
  onKeyboard: true, archivedAt: null, copiedFrom: null, ...over,
});

function Switcher() {
  const configs = useConfigs("t", "zsa/moonlander", "k");
  return (
    <ConfigMenu live={configs.live} archived={configs.archived} selectedId="lay_daily" selectedName="Daily" boardName="Moonlander" onSelect={() => {}}
      onNew={() => {}} onRename={() => {}} onArchive={() => {}} onRestore={() => {}} onDelete={() => {}} onImport={() => {}}
      failure={configs.failure} onReadAgain={configs.reload} token="t" />
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const archive = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Archive Daily"));

describe("the config switcher after a failed list read", () => {
  test("says so, keeps Archive off with its reason, and Read them again brings the list back", async () => {
    // No answer for /api/configs: the fake fetch says not_found, which a second read can pass once keyloom has the list.
    await mount(<Switcher />);
    await settle();
    await press("Daily");
    expect(document.body.textContent).toContain(CONFIG_LIST_FAILED);
    expect(archive()?.disabled).toBe(true);
    expect(archive()?.textContent).toContain("until it reads your configs again");

    answerReads({ "/api/configs": { configs: [config(), config({ id: "lay_travel", name: "Travel", onKeyboard: false })] } });
    await press("Read them again");
    await settle();
    expect(document.body.textContent).not.toContain(CONFIG_LIST_FAILED);
    expect(document.body.textContent).toContain("Travel");
    // The list now says Daily is on the Moonlander, so Archive stays off for that reason instead.
    expect(archive()?.textContent).toContain("Put another on your Moonlander first");
  });

  test("an answer the page can't read offers Restart keyloom, not a read that fails the same way", async () => {
    answerReads({ "/api/configs": { not: "a list" } });
    await mount(<Switcher />);
    await settle();
    await press("Daily");
    expect(document.body.textContent).toContain(CONFIG_LIST_FAILED);
    expect(button("Read them again")).toBeUndefined();
    expect(button("Restart keyloom")?.className).toContain("button-primary");
  });

  test("the words add keyloom's sentence only for a failure no screen planned for", () => {
    expect(configListWords({ message: "Can't reach keyloom.", code: "unreachable" })).toBe(CONFIG_LIST_FAILED);
    expect(configListWords({ message: INTERNAL_WORDS, code: "internal" })).toBe(`${CONFIG_LIST_FAILED} ${INTERNAL_WORDS}`);
    expect(archiveWaits(null, "Moonlander")).toBeNull();
  });
});

describe("the chat's config card after a failed list read", () => {
  const render = (failure: { message: string; code?: string }, onReadAgain = () => {}) => renderToStaticMarkup(
    <ConfigCardList
      presentation={{
        version: 1, userMessageId: "m", status: "completed", messages: [], effectsMayHaveOccurred: true, warning: null, detailsTruncated: false,
        operations: [{ id: "op_1", tool: "create_config", label: "create_config", status: "succeeded", durationMs: 1, validationCodes: [], references: [{ kind: "config", id: "c1" }], accepted: 0, declined: 0 }],
      }}
      cards={{ data: new Map([["c1", { state: "error", failure }]]), currentId: "x", origin: null, onOpen: () => {}, onReview: () => {}, onReadAgain, token: "t" }}
    />,
  );

  test("a lost connection offers Try again", () => {
    const html = render({ message: "Can't reach keyloom.", code: "unreachable" });
    expect(html).toContain(CARD_READ_FAILED.replaceAll("'", "&#x27;"));
    expect(html).toContain("Try again");
    expect(html).not.toContain("Restart keyloom");
  });

  test("an exception offers Try again and Restart keyloom with keyloom's sentence; an unreadable answer only Restart keyloom", () => {
    const internal = render({ message: INTERNAL_WORDS, code: "internal" });
    expect(internal).toContain("Try again");
    expect(internal).toContain("Restart keyloom");
    expect(configCardView({ state: "error", failure: { message: INTERNAL_WORDS, code: "internal" } }, "x", null, "c1").note).toBe(`${CARD_READ_FAILED} ${INTERNAL_WORDS}`);
    const unreadable = render({ message: UNREADABLE_WORDS, code: "unreadable" });
    expect(unreadable).not.toContain("Try again");
    expect(unreadable).toContain("Restart keyloom");
  });
});
