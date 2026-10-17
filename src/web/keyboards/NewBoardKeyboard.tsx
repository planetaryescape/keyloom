import { useMemo } from "react";
import type { PreviewBoard, PutPreviewResponse } from "../../api/keyboards.ts";
import { describeKey } from "../../layout/describe.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";
import type { Layout } from "../../layout/schema.ts";
import { Keyboard } from "../keyboard/Keyboard.tsx";
import "./keyboards.css";

const NONE: ReadonlySet<number> = new Set();
const noop = () => {};

/** "pinky", "ring", "thumb": the finger keyloom expects, as a cap's front legend says it. */
const fingerWord = (finger: string | undefined): string => (finger === undefined ? "" : finger.replace(/^(left|right)-/, ""));

// The new keyboard on the stage (n2 to n4, D-336), drawn by the board renderer every board uses, so it looks like itself and not a diagram.
// Confirming, its caps are blank and the home row is lit; reviewing, each cap's front says the finger keyloom expects; putting, the caps
// carry the mapped config. Clicking a key while confirming picks its row as the home row.
export function NewBoardKeyboard({ board, mode, homeRow, mapped, placed, onPickRow, half = null }: {
  board: PreviewBoard;
  mode: "confirm" | "review" | "put";
  /** The row to light, 1-based from the top: the one given, or keyloom's guess. */
  homeRow: number | null;
  mapped: PutPreviewResponse | null;
  /** Keys a layer key with no counterpart is placed on: amber, as a proposal's keys are. */
  placed: ReadonlySet<number>;
  onPickRow: (row: number) => void;
  /** On a phone, the half shown, as the board on any other screen there. */
  half?: "left" | "right" | null;
}) {
  const rowOf = useMemo(() => {
    const at = new Map<number, number>();
    board.rows.forEach((r, i) => {
      for (const p of r.positions) at.set(p, i + 1);
    });
    return at;
  }, [board.rows]);
  const lit = useMemo(() => new Set(homeRow === null ? [] : (board.rows[homeRow - 1]?.positions ?? [])), [board.rows, homeRow]);
  // Before a config is mapped, every key is described as empty, so the renderer draws a blank cap where each key sits.
  const blank = useMemo<Layout>(() => ({
    schemaVersion: 1, boardId: "new", firmware: "zmk",
    layers: [{ id: "base", name: "Base", bindings: board.keys.map(() => ({ kind: "none" as const })) }],
    macros: [], tapDances: [], combos: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [],
  }), [board.keys]);
  const descriptions = useMemo(
    () => board.keys.map((_, i) => describeKey(mode === "put" && mapped !== null ? mapped.after : blank, 0, i)),
    [board.keys, mode, mapped, blank],
  );
  const overrides = useMemo(
    // An empty key has no front to print on, so the finger is the cap's one word.
    () => board.keys.map((_, i) => (mode === "review" ? { tap: fingerWord(board.fingers[String(i)]) } : mode === "confirm" ? { tap: "" } : undefined)),
    [board.keys, board.fingers, mode],
  );
  const marks = useMemo(() => new Map([...placed].map((p) => [p, "changed" as const])), [placed]);
  return (
    <Keyboard
      keys={board.keys}
      hands={board.hands}
      descriptions={descriptions}
      fingers={board.fingers}
      layerName={mode === "put" ? niceLayerName(mapped?.after.layers[0]?.name ?? "Base") : "Base"}
      selected={null}
      partners={NONE}
      comboKeys={NONE}
      onSelect={noop}
      onHover={noop}
      onPress={(index) => {
        const row = rowOf.get(index);
        if (mode === "confirm" && row !== undefined) onPickRow(row);
      }}
      legendOverrides={mode === "put" ? undefined : overrides}
      highlighted={mode === "put" ? NONE : lit}
      marks={marks}
      half={half}
    />
  );
}
