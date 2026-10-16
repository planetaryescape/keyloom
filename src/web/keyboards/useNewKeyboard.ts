import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiCandidate, DetectedKeyboard } from "../../api/detected-keyboards.ts";
import type { PreviewResponse, PutPreviewResponse, PutResponse } from "../../api/keyboards.ts";
import { ApiError } from "../api.ts";
import * as api from "./api-keyboards.ts";

// The new-keyboard flow (22, D-336): a keyboard keyloom has no board for is plugged in, BK confirms which it is, says where the home row
// is (and, for a ZMK shield, the controller), sees the board keyloom would add, adds it, and puts one of his configs on it. Nothing here
// writes to a device; the first flash is BK's, from Build and flash.
export type NewBoardStep =
  | { kind: "idle" }
  /** The stage card: what USB said, the candidates, and a search. */
  | { kind: "card"; keyboard: DetectedKeyboard; choice: string | null }
  /** The home row and the controller, with the board drawn. */
  | { kind: "confirm"; keyboard: DetectedKeyboard; candidate: ApiCandidate; homeRow: number | null; controller: string | null }
  /** The board as keyloom would add it: hands, fingers, the flash. */
  | { kind: "review"; keyboard: DetectedKeyboard; candidate: ApiCandidate; homeRow: number; controller: string | null }
  /** Added: pick a config to put on it, see it mapped, choose where the keys with no place go. */
  | { kind: "put"; boardId: string; boardName: string; source: string | null; choices: Record<string, number> };

/** A keyboard is the same one across frames by what it says over USB. */
export const keyboardKey = (k: DetectedKeyboard): string => `${k.device.vendorId}:${k.device.productId}:${k.device.product}:${k.device.serial ?? ""}`;

const message = (error: unknown): string => (error instanceof ApiError || error instanceof Error ? error.message : "That didn't work.");

export function useNewKeyboard(token: string, keyboards: readonly DetectedKeyboard[]) {
  const [step, setStep] = useState<NewBoardStep>({ kind: "idle" });
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [putPreview, setPutPreview] = useState<PutPreviewResponse | null>(null);
  const [searchText, setSearchText] = useState("");
  const [found, setFound] = useState<ApiCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = keyboards.filter((k) => k.status !== "known");
  const offered = waiting.filter((k) => !dismissed.has(keyboardKey(k)));

  // A keyboard that appears opens the card once; "Not now" leaves it to the chip in the board switch.
  const shown = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (step.kind !== "idle") return;
    const next = offered.find((k) => !shown.current.has(keyboardKey(k)));
    if (next === undefined) return;
    shown.current = new Set([...shown.current, keyboardKey(next)]);
    setStep({ kind: "card", keyboard: next, choice: next.ambiguous ? null : (next.candidates[0]?.id ?? null) });
  }, [offered, step.kind]);

  // The card's keyboard was unplugged: the card goes with it, unless BK is already past choosing.
  useEffect(() => {
    if (step.kind !== "card") return;
    if (!waiting.some((k) => keyboardKey(k) === keyboardKey(step.keyboard))) setStep({ kind: "idle" });
  }, [waiting, step]);

  // The board as it would be added, drawn from the pinned firmware tree; again whenever the home row or the controller changes.
  const confirmKey = step.kind === "confirm" || step.kind === "review" ? `${step.candidate.id}|${step.homeRow ?? ""}|${step.controller ?? ""}` : null;
  useEffect(() => {
    if (step.kind !== "confirm" && step.kind !== "review") return;
    const controller = new AbortController();
    setProblem(null);
    api.previewKeyboard(token, {
      candidate: step.candidate.id,
      ...(step.homeRow === null ? {} : { homeRow: step.homeRow }),
      ...(step.controller === null ? {} : { controller: step.controller }),
    }, controller.signal).then((p) => setPreview(p), (e: unknown) => {
      if (!controller.signal.aborted) setProblem(message(e));
    });
    return () => controller.abort();
    // The key stands for the step's inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, confirmKey]);

  // What the put would make, mapped, before anything is made.
  const putKey = step.kind === "put" && step.source !== null ? `${step.boardId}|${step.source}|${JSON.stringify(step.choices)}` : null;
  useEffect(() => {
    if (step.kind !== "put" || step.source === null) {
      setPutPreview(null);
      return;
    }
    const controller = new AbortController();
    setProblem(null);
    api.previewPut(token, { from: step.source, board: step.boardId, placements: step.choices }, controller.signal).then(setPutPreview, (e: unknown) => {
      if (!controller.signal.aborted) setProblem(message(e));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, putKey]);

  const search = useCallback(async (text: string) => {
    setSearchText(text);
    if (text.trim().length < 2) {
      setFound([]);
      return;
    }
    try {
      setFound((await api.searchKeyboards(token, text.trim())).candidates);
    } catch (e) {
      setProblem(message(e));
    }
  }, [token]);

  const candidateOf = (k: DetectedKeyboard, id: string): ApiCandidate | undefined => k.candidates.find((c) => c.id === id) ?? found.find((c) => c.id === id);

  return {
    step, preview, putPreview, busy, problem, waiting, searchText, found,
    /** Opens the card again for a keyboard put off with "Not now". */
    reopen: (k: DetectedKeyboard) => {
      setDismissed((d) => new Set([...d].filter((x) => x !== keyboardKey(k))));
      setStep({ kind: "card", keyboard: k, choice: k.ambiguous ? null : (k.candidates[0]?.id ?? null) });
    },
    notNow: () => {
      if (step.kind === "card" || step.kind === "confirm" || step.kind === "review") setDismissed((d) => new Set([...d, keyboardKey(step.keyboard)]));
      setStep({ kind: "idle" });
      setPreview(null);
      setProblem(null);
    },
    choose: (id: string) => setStep((s) => (s.kind === "card" ? { ...s, choice: id } : s)),
    search,
    /** The card's "It's a Corne": on to the home row, with the board drawn. */
    confirmCandidate: () => {
      if (step.kind !== "card" || step.choice === null) return;
      const candidate = candidateOf(step.keyboard, step.choice);
      if (candidate === undefined) return;
      setPreview(null);
      setStep({ kind: "confirm", keyboard: step.keyboard, candidate, homeRow: null, controller: null });
    },
    backToCard: () => {
      if (step.kind !== "confirm") return;
      setStep({ kind: "card", keyboard: step.keyboard, choice: step.candidate.id });
    },
    setHomeRow: (row: number) => setStep((s) => (s.kind === "confirm" || s.kind === "review" ? { ...s, homeRow: row } : s)),
    setController: (id: string) => setStep((s) => (s.kind === "confirm" ? { ...s, controller: id } : s)),
    /** "Show me the board": the home row is the one given, or keyloom's guess, which BK has seen marked. */
    review: () => {
      if (step.kind !== "confirm" || preview === null) return;
      setStep({ kind: "review", keyboard: step.keyboard, candidate: step.candidate, homeRow: step.homeRow ?? preview.guessedHomeRow, controller: step.controller });
    },
    backToConfirm: () => {
      if (step.kind !== "review") return;
      setStep({ kind: "confirm", keyboard: step.keyboard, candidate: step.candidate, homeRow: step.homeRow, controller: step.controller });
    },
    /** Stores the board. Resolves to its id, for the put step. */
    add: async () => {
      if (step.kind !== "review") return;
      setBusy(true);
      setProblem(null);
      try {
        const out = await api.addKeyboard(token, { candidate: step.candidate.id, homeRow: step.homeRow, ...(step.controller === null ? {} : { controller: step.controller }) });
        setStep({ kind: "put", boardId: out.boardId, boardName: out.displayName, source: null, choices: {} });
      } catch (e) {
        setProblem(message(e));
      } finally {
        setBusy(false);
      }
    },
    chooseSource: (id: string) => setStep((s) => (s.kind === "put" ? { ...s, source: id, choices: {} } : s)),
    choosePlacement: (source: number, target: number) => setStep((s) => (s.kind === "put" ? { ...s, choices: { ...s.choices, [String(source)]: target } } : s)),
    /** Makes the config with its proposals. Resolves to what was made, so the page can open it. */
    make: async (): Promise<PutResponse | null> => {
      if (step.kind !== "put" || step.source === null) return null;
      setBusy(true);
      setProblem(null);
      try {
        const out = await api.putConfig(token, { from: step.source, board: step.boardId, placements: step.choices });
        setStep({ kind: "idle" });
        setPutPreview(null);
        setPreview(null);
        return out;
      } catch (e) {
        setProblem(message(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    close: () => {
      setStep({ kind: "idle" });
      setPreview(null);
      setPutPreview(null);
      setProblem(null);
    },
  };
}

export type NewKeyboard = ReturnType<typeof useNewKeyboard>;
