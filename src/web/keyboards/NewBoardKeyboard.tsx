import { useMemo } from "react";
import type { PreviewBoard, PutPreviewResponse } from "../../api/keyboards.ts";
import type { BoardChoice } from "../../api/http.ts";
import { isOnePiece } from "../../boards/one-piece.ts";
import { describeKey } from "../../layout/describe.ts";
import { niceLayerName } from "../../layout/layer-ops.ts";
import type { Layout } from "../../layout/schema.ts";
import { Keyboard } from "../keyboard/Keyboard.tsx";
import { MIN_UNIT } from "../keyboard/useFitUnit.ts";
import "./keyboards.css";

const NONE: ReadonlySet<number> = new Set();
const noop = () => {};

/** "pinky", "ring", "thumb": the finger keyloom expects, as a cap's front legend says it. */
const fingerWord = (finger: string | undefined): string => (finger === undefined ? "" : finger.replace(/^(left|right)-/, ""));

/**
 * A cap too small for its finger's word shows the word's first letter instead, on every key of the board, never a word cut by the cap's
 * edge (PR #307 review: "midd" on a 12-column board on a phone). The key's accessible name keeps the whole word, and Review's lead says
 * what each letter means (FINGER_LETTERS).
 */
const fingerLegend = (finger: string | undefined): { tap: string; short?: string } => {
  const word = fingerWord(finger);
  return word === "" ? { tap: "" } : { tap: word, short: word.charAt(0).toUpperCase() };
};

/**
 * The half of the new board a phone shows: one half of a split board, the whole of a one-piece one (D-351). It follows the new board,
 * never the board of the config open behind it (PR #307 review: a Glove80 open halved a one-piece board).
 */
export function newBoardHalf(phone: boolean, board: Pick<PreviewBoard, "keys" | "hands"> | null, display: BoardChoice["display"], half: "left" | "right"): "left" | "right" | null {
  return phone && board !== null && !isOnePiece({ hands: board.hands, display }, board.keys) ? half : null;
}

/** What each finger letter means, for Review's lead. */
export const FINGER_LETTERS = "A key too small for the word shows its first letter: P pinky, R ring, M middle, I index, T thumb.";

// The new keyboard on the stage (n2 to n4, D-336), drawn by the board renderer every board uses, so it looks like itself and not a diagram.
// Confirming, its caps are blank and the home row is lit; reviewing, each cap's front says the finger keyloom expects; putting, the caps
// carry the mapped config. Clicking a key while confirming picks its row as the home row. The board fits the stage's width, phone included
// (R8-02): nothing on it is edited, and Review exists to show every key's finger.
export function NewBoardKeyboard({ board, display, mode, homeRow, mapped, placed, onPickRow, half = null, onSwipe }: {
  board: Pick<PreviewBoard, "keys" | "hands" | "fingers" | "rows">;
  display?: BoardChoice["display"];
  mode: "confirm" | "review" | "put";
  /** The row to light, 1-based from the top: the one given, or keyloom's guess. */
  homeRow: number | null;
  mapped: PutPreviewResponse | null;
  /** Keys a layer key with no counterpart is placed on: amber, as a proposal's keys are. */
  placed: ReadonlySet<number>;
  onPickRow: (row: number) => void;
  /** On a phone, the half shown, as the board on any other screen there. */
  half?: "left" | "right" | null;
  /** A sideways swipe on a phone's half, to show the other one. */
  onSwipe?: ((direction: "left" | "right") => void) | undefined;
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
    () => board.keys.map((_, i) => {
      const description = describeKey(mode === "put" && mapped !== null ? mapped.after : blank, 0, i);
      // A blank key hides its print (keyboard.css), so on Review its finger is printed as a key's legend is, or every cap is blank (R8-02).
      return mode === "review" && description !== null ? { ...description, kind: "key" as const } : description;
    }),
    [board.keys, mode, mapped, blank],
  );
  const overrides = useMemo(
    // An empty key has no front to print on, so the finger is the cap's one word.
    () => board.keys.map((_, i) => (mode === "review" ? fingerLegend(board.fingers[String(i)]) : mode === "confirm" ? { tap: "" } : undefined)),
    [board.keys, board.fingers, mode],
  );
  const marks = useMemo(() => new Map([...placed].map((p) => [p, "changed" as const])), [placed]);
  return (
    <Keyboard
      keys={board.keys}
      hands={board.hands}
      display={display}
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
      {...(onSwipe === undefined ? {} : { onSwipe })}
      fitMin={MIN_UNIT.preview}
    />
  );
}
