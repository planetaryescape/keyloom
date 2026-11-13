// R10-08: a plugged-in keyboard's card put off with Not now stays put off across a config switch, which remounts the editor, and no card
// opens by itself over the board review or a dialog. Driven through the real hook, with App's memory shared as App shares it.
import { describe, expect, test } from "bun:test";
import type { DetectedKeyboard } from "../../src/api/detected-keyboards.ts";
import { type CardMemory, useCardMemory, useNewKeyboard } from "../../src/web/keyboards/useNewKeyboard.ts";
import { act, mount, press, setUpDom } from "../helpers/dom.tsx";

await setUpDom();

// A Moonlander keyloom knows, plugged in, with no config on it yet.
const moonlander: DetectedKeyboard = {
  device: { vendorId: "3297", productId: "1969", product: "Moonlander Mark I", maker: "ZSA", bcdDevice: null, serial: null },
  status: "known", knownBoard: { id: "zsa/moonlander", name: "Moonlander" }, candidates: [], ambiguous: false, next: "",
};

/** One editor page: the step its card is on, and Not now. */
function Page({ memory, hold = false }: { memory?: CardMemory; hold?: boolean }) {
  const flow = useNewKeyboard("t", [], [moonlander], undefined, { memory, hold });
  return <><p id="step">{flow.step.kind}</p><button type="button" onClick={flow.notNow}>Not now</button></>;
}

/** App: one memory for the whole page, and a Page keyed by the config on screen, as `LayoutPage` is. */
function App({ config, shared }: { config: string; shared: boolean }) {
  const memory = useCardMemory();
  return <Page key={config} {...(shared ? { memory } : {})} />;
}

const step = () => document.querySelector("#step")?.textContent;

describe("Not now across a config switch", () => {
  test("with App's memory, the card stays closed on the next config", async () => {
    const page = await mount(<App config="daily" shared />);
    expect(step()).toBe("setup");
    await press("Not now");
    expect(step()).toBe("idle");
    await page.render(<App config="travel" shared />);
    expect(step()).toBe("idle");
  });

  test("with a memory per page, as before, the switch opened it again", async () => {
    const page = await mount(<App config="daily" shared={false} />);
    await press("Not now");
    await page.render(<App config="travel" shared={false} />);
    expect(step()).toBe("setup");
  });

  test("a card that opened once and was closed by itself isn't opened again on the next config either", async () => {
    // The card opened on `daily` and the person moved on without Not now; on `travel` it is already shown.
    const page = await mount(<App config="daily" shared />);
    expect(step()).toBe("setup");
    await page.render(<App config="travel" shared />);
    expect(step()).toBe("idle");
  });
});

describe("a card held back", () => {
  test("waits while the review is open, then opens", async () => {
    const page = await mount(<Page hold />);
    expect(step()).toBe("idle");
    await page.render(<Page hold={false} />);
    expect(step()).toBe("setup");
  });

  test("waits while a dialog is open, then opens on the next render after it closes", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const page = await mount(<Page />);
    expect(step()).toBe("idle");
    await act(async () => dialog.remove());
    await page.render(<Page />);
    expect(step()).toBe("setup");
  });
});
