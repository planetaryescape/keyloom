// R9-05: a Docker start or an install whose request failed no way the page planned for keeps its code, so the callout offers Restart
// keyloom, and never a Try again that fails the same way.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DockerCallout } from "../../src/web/release/DockerCallout.tsx";
import { ToolCallout } from "../../src/web/release/FlashPrerequisites.tsx";
import type { Docker } from "../../src/web/release/useDocker.ts";
import type { Install } from "../../src/web/release/useInstall.ts";
import type { PageFailure } from "../../src/web/shell/unexpected.ts";

const noop = () => undefined;
const docker = (problemFailure: PageFailure | null): Docker => ({
  readiness: null, unanswered: false, starting: false, problem: problemFailure?.message ?? null, problemCode: null, problemFailure, token: "t", linkedFile: null,
  lastAction: "start", start: noop, restart: noop, fixFiles: noop, refresh: noop,
});
const install = (failure: PageFailure | null): Install => ({ state: null, problem: failure?.message ?? null, failure, token: "t", start: noop, cancel: noop });
const startFailed = (failure: PageFailure | null) =>
  renderToStaticMarkup(<DockerCallout view={{ kind: "start-failed", reason: failure?.message ?? "Docker didn't start.", retry: "start", restartEngine: null, helpUrl: null }} docker={docker(failure)} install={install(null)} />);

test("a start whose answer this page can't read offers Restart keyloom and no Try again", () => {
  const html = startFailed({ message: "keyloom sent an answer this page can't read.", code: "unreadable" });
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain(">Try again<");
});

test("a start that hit an exception keeps Try again beside Restart keyloom", () => {
  const html = startFailed({ message: "keyloom hit a problem it didn't expect.", code: "internal" });
  expect(html).toContain(">Try again<");
  expect(html).toContain("Restart keyloom");
});

test("Docker's own refusal keeps the callout's buttons alone", () => {
  const html = startFailed(null);
  expect(html).toContain(">Try again<");
  expect(html).not.toContain("Restart keyloom");
});

test("an install that couldn't start for an unexpected reason offers Restart keyloom under its words", () => {
  const html = renderToStaticMarkup(
    <ToolCallout view={{ kind: "needs-tool", name: "zapp", canInstall: true, url: "https://github.com/zsa/zapp" } as never} boardName="Moonlander" install={install({ message: "keyloom couldn't find what this page asked for.", code: "not_found", generic: true })} onCheck={noop} />,
  );
  expect(html).toContain("keyloom couldn&#x27;t find what this page asked for.");
  expect(html).toContain("Restart keyloom");
});
