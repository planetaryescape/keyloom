// The put-on confirm while it can't work (R4 residual 1): kanata's setup shows in its place, and Put it on comes back once it can.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog } from "../../src/web/configs/ConfigDialogs.tsx";

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
