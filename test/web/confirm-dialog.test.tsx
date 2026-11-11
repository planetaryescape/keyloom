// The put-on confirm while it can't work (R4 residual 1): kanata's setup shows in its place, and Put it on comes back once it can.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog, shownDetail } from "../../src/web/configs/ConfigDialogs.tsx";

const dialog = (blocked: boolean) =>
  renderToStaticMarkup(
    <ConfirmDialog title="Put Travel on your MacBook?" lines={["keyloom loads Travel into kanata."]} confirmLabel="Put it on" onConfirm={async () => {}} onClose={() => {}}
      blocked={blocked} extra={blocked ? <p>kanata setup checklist</p> : null} />,
  );

test("a blocked confirm hides Put it on and shows what gets past it; unblocked, it is offered again", () => {
  const blocked = dialog(true);
  expect(blocked).toContain("kanata setup checklist");
  expect(blocked).not.toContain("Put it on</button>");
  expect(blocked).toContain("Not now");
  const open = dialog(false);
  expect(open).toContain("Put it on</button>");
  expect(open).not.toContain("kanata setup checklist");
});

test("a refused put-on drops its keyboard-status detail while the setup checklist shows, and keeps a detail that has its button (R5-14)", () => {
  const kanata = { message: "kanata isn't running", detail: "The keyboard's status lists what is missing, with a button for each." };
  expect(shownDetail(kanata, true)).toBeUndefined();
  expect(shownDetail(kanata, false)).toBe(kanata.detail);
  const archived = { message: "This config is archived", detail: "Restore it to put it on the keyboard.", action: { label: "Restore", run: () => {} } };
  expect(shownDetail(archived, true)).toBe(archived.detail);
});
