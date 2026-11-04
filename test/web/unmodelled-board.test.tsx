import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Keyboard } from "../../src/web/keyboard/Keyboard.tsx";
import { NewBoardKeyboard } from "../../src/web/keyboards/NewBoardKeyboard.tsx";
import { describeKey } from "../../src/layout/describe.ts";
import { getBoard } from "../../src/boards/registry.ts";
import { tiny } from "../helpers/tiny.ts";

const board = getBoard("foostan/corne");
const layout = tiny({ layers: [{ id: "base", name: "Base", bindings: board.geometry.keys.map(() => ({ kind: "key", code: "A" })) }] });
const NONE = new Set<number>();
const noop = () => {};
const render = (display?: typeof board.definition.display) => renderToStaticMarkup(
  <Keyboard keys={board.geometry.keys} hands={board.definition.hands} descriptions={board.geometry.keys.map((_, i) => describeKey(layout, 0, i))}
    fingers={{}} layerName="Base" selected={null} partners={NONE} comboKeys={NONE} onSelect={noop} onHover={noop} onPress={noop} display={display} />,
);

describe("unmodelled boards keep the keyboard under the light", () => {
  test("no display data still renders every key with a skirt and dished face, over shaded, raised bodies", () => {
    for (const display of [undefined, { case: [] }]) {
      const html = render(display);
      expect(html.match(/class="cap-body"/g)).toHaveLength(board.geometry.keys.length);
      expect(html.match(/class="cap-top"/g)).toHaveLength(board.geometry.keys.length);
      expect(html.match(/class="case-edge"/g)).toHaveLength(2);
      expect(html).toContain("linearGradient");
      expect(html).toContain('class="keyboard-contact"');
      expect(html).toContain('class="keyboard-glow"');
      expect(html).toContain('tabindex="0"');
    }
  });

  test("a crafted enclosure keeps its own paths without inferred walls", () => {
    const html = render(board.definition.display);
    expect(html).not.toContain('class="case-edge"');
    for (const part of board.definition.display?.case ?? []) expect(html).toContain(part.d);
  });

  test("the add-keyboard preview uses the same dimensional body and caps, including one half on a phone", () => {
    const html = renderToStaticMarkup(<NewBoardKeyboard board={{ keys: board.geometry.keys, hands: board.definition.hands, fingers: {}, rows: [] }}
      mode="confirm" homeRow={null} mapped={null} placed={NONE} onPickRow={noop} half="right" />);
    expect(html.match(/class="case-edge"/g)).toHaveLength(1);
    expect(html.match(/class="cap-body"/g)).toHaveLength(board.definition.hands.right.length);
    expect(html).not.toContain('data-hand="left"');
  });
});
