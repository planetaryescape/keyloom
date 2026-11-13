import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiCandidate, DetectedKeyboard } from "../../api/detected-keyboards.ts";
import type { PreviewResponse, PutPreviewResponse, PutResponse } from "../../api/keyboards.ts";
import type { ReviewActivity } from "../../api/review.ts";
import { ApiError } from "../api.ts";
import { firstFreeName } from "../import/export-steps.ts";
import { createConfig, fetchAllConfigs } from "../configs/api-configs.ts";
import * as api from "./api-keyboards.ts";
import { deriveProblem, type DeriveProblem } from "./derive-words.ts";
import { putProblem, type PutProblem } from "./put-words.ts";
import { keyboardRemoved } from "./RestoreKeyboard.tsx";
import { type PageFailure, failsAgain, pageFailure } from "../shell/unexpected.ts";

// The new-keyboard flow (22, D-336): a keyboard keyloom has no board for is plugged in, BK confirms which it is, says where the home row
// is (and, for a ZMK shield, the controller), sees the board keyloom would add, adds it, and puts one of his configs on it. Nothing here
// writes to a device; the first flash is BK's, from Build and flash.
//
// The same put serves a board keyloom already knows but that has no config yet: the card says so, and offers putting one of BK's configs
// on it, importing its own export, or starting blank. Without that the board is invisible, because the board switch lists only boards
// that have a config (D-336).
export type NewBoardStep =
  | { kind: "idle" }
  /** The stage card: what USB said, the candidates, and a search. */
  | { kind: "card"; keyboard: DetectedKeyboard; choice: string | null }
  /** A known board chosen from USB or the catalogue: put a config on it, import one, or start blank. */
  | { kind: "setup"; keyboard: DetectedKeyboard | null; boardId: string; boardName: string }
  /** The home row, the controller and the QMK layout, with the board drawn. A null layout is the keyboard's default, or keyloom's guess. */
  | { kind: "confirm"; keyboard: DetectedKeyboard | null; candidate: ApiCandidate; homeRow: number | null; controller: string | null; layout: string | null }
  /** The board as keyloom would add it: hands, fingers, the flash. */
  | { kind: "review"; keyboard: DetectedKeyboard | null; candidate: ApiCandidate; homeRow: number; controller: string | null; layout: string | null }
  /**
   * Added, or already known: pick a config to put on it, see it mapped, choose where the keys with no place go. `matched`: the keyboard
   * picked as new is one keyloom already has (R6-07), which may have configs of its own.
   */
  | { kind: "put"; boardId: string; boardName: string; source: string | null; choices: Record<string, number>; origin: "new" | "known" | "matched" };

/** A keyboard is the same one across frames by what it says over USB. */
export const keyboardKey = (k: DetectedKeyboard): string => `${k.device.vendorId}:${k.device.productId}:${k.device.product}:${k.device.serial ?? ""}`;

/** A QMK keyboard with several layouts and no default is drawn on keyloom's guess until the person picks theirs. */
export const layoutUnpicked = (step: { layout: string | null }, preview: Pick<PreviewResponse, "needs">): boolean =>
  preview.needs.includes("--layout") && step.layout === null;

/**
 * "Show me the board": the home row is the one given, or keyloom's guess, which BK has seen marked. A layout keyloom only guessed is never
 * carried on, so Add can't store it (D-525): `keyboard add` asks for --layout, and the page asks which layout is yours.
 */
export function reviewStep(step: NewBoardStep, preview: PreviewResponse | null): Extract<NewBoardStep, { kind: "review" }> | null {
  if (step.kind !== "confirm" || preview === null || layoutUnpicked(step, preview)) return null;
  return { kind: "review", keyboard: step.keyboard, candidate: step.candidate, homeRow: step.homeRow ?? preview.guessedHomeRow, controller: step.controller, layout: step.layout ?? preview.layout };
}

/** The board keyloom already has for a candidate (R6-07), as the `board_known` refusal names it. */
export type KnownBoardRef = { id: string; name: string };

/** The board a `board_known` preview refusal names, by keyloom's own name; the candidate's only if the server sent none. */
export const knownBoardOf = (error: unknown, candidateName: string): KnownBoardRef | null =>
  error instanceof ApiError && error.board !== undefined ? { id: error.board, name: error.boardName ?? candidateName } : null;

const message = (error: unknown): string => (error instanceof ApiError || error instanceof Error ? error.message : "That didn't work.");

type AddContext = { candidate: ApiCandidate };
const addWords = (error: unknown, step: AddContext, preview: Pick<PreviewResponse, "displayName"> | null): DeriveProblem | null =>
  deriveProblem(error instanceof ApiError ? error.code : null, preview?.displayName ?? step.candidate.name);

/**
 * Add refused: a keyboard keyloom can't add yet in words, named as the page names it ("Corne (new)"); the server's sentence names CLI
 * flags (R5-06). The code stays, so a failure no screen planned for offers Restart keyloom (R9-05).
 */
export const addProblem = (error: unknown, step: AddContext, preview: Pick<PreviewResponse, "displayName"> | null): PageFailure => {
  const failure = pageFailure(error, "That didn't work.");
  const words = addWords(error, step, preview);
  return words === null ? failure : { ...failure, message: words.text };
};

/** Add refused because keyloom already has the board (R10-13), such as one another tab added after the preview: that board, or null. */
export const addedElsewhere = (error: unknown, step: AddContext): KnownBoardRef | null =>
  error instanceof ApiError && error.code === "board_known" ? knownBoardOf(error, step.candidate.name) : null;

/**
 * Add refused for a reason the same answers hit again (R7-11), such as a derived board that fails the boards check: the Review step shows
 * why with the contribution guide in place of Add. Null for a refusal that Add again can get past, which shows as a plain problem.
 */
export const blockedAdd = (error: unknown, step: AddContext, preview: Pick<PreviewResponse, "displayName"> | null): DeriveProblem | null => {
  const words = addWords(error, step, preview);
  return words?.blocked === true ? words : null;
};

/**
 * The board Start a config makes a config on: the step's own board, or on the Confirm and Review steps the board keyloom already has for
 * the keyboard picked as new (R7-10). Null when there is none.
 */
export const blankBoardFor = (step: NewBoardStep, knownBoard: KnownBoardRef | null): string | null =>
  step.kind === "setup" || step.kind === "put" ? step.boardId : step.kind === "confirm" || step.kind === "review" ? (knownBoard?.id ?? null) : null;

/**
 * The card that opens by itself (D-336), each once: a keyboard keyloom hasn't met, then a known board with no config. `shown` holds what
 * already opened, by USB key or board id. Null when nothing new is plugged in.
 */
export function cardToOpen(offered: readonly DetectedKeyboard[], setupWaiting: readonly DetectedKeyboard[], shown: ReadonlySet<string>): { step: NewBoardStep; shown: string } | null {
  const next = offered.find((k) => !shown.has(keyboardKey(k)));
  if (next !== undefined) return { step: { kind: "card", keyboard: next, choice: next.ambiguous ? null : (next.candidates[0]?.id ?? null) }, shown: keyboardKey(next) };
  const bare = setupWaiting.find((k) => k.knownBoard !== null && !shown.has(k.knownBoard.id));
  if (bare === undefined || bare.knownBoard === null) return null;
  return { step: { kind: "setup", keyboard: bare, boardId: bare.knownBoard.id, boardName: bare.knownBoard.name }, shown: bare.knownBoard.id };
}

/**
 * What counts as shown once the panel closes on `step` (R9-08). Later on the Put step leaves the board added, or known, with no config,
 * so detection reads it as a known board with no config and would open its setup card at once. Marking its id shown stops that. Not
 * "dismissed", which would also take the board switch's chip away; the welcome lists the board, and Your keyboards has Set up.
 */
export const shownAfterClose = (step: NewBoardStep, shown: ReadonlySet<string>): ReadonlySet<string> =>
  step.kind === "put" && !shown.has(step.boardId) ? new Set([...shown, step.boardId]) : shown;

/** `onAdded`: a board was just added, so whatever lists keyloom's boards reads them again, or it is missing until a reload (R8-06). */
export function useNewKeyboard(token: string, keyboards: readonly DetectedKeyboard[], knownWithNoConfig: readonly DetectedKeyboard[] = [], onAdded?: () => void) {
  const [step, setStep] = useState<NewBoardStep>({ kind: "idle" });
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [putPreview, setPutPreview] = useState<PutPreviewResponse | null>(null);
  const [searchText, setSearchText] = useState("");
  const [found, setFound] = useState<ApiCandidate[]>([]);
  // The text whose answer `found` holds, so an empty answer reads as "none" only once the search for this text came back (R4-12).
  const [foundFor, setFoundFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A failed Add, Start blank or Make, kept whole (R9-05): its code picks Restart keyloom, and a failure that fails the same way every
  // time turns off the button that would send it again.
  const [problem, setProblem] = useState<PageFailure | null>(null);
  // A board preview that failed stops the "Reading…" and offers Try again, which reads it again (R3-08).
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  // The server's code for a preview that can't work for this keyboard (R5-06), so the page offers the guide instead of Try again.
  const [previewProblemCode, setPreviewProblemCode] = useState<string | null>(null);
  // The board keyloom already has for a keyboard picked as new (R6-07): the page offers to put a config on it instead. Its name is
  // keyloom's, not the search result's ("Moonlander", not "Moonlander Mark I"), so the steps after it name the board as keyloom does.
  const [previewProblemBoard, setPreviewProblemBoard] = useState<KnownBoardRef | null>(null);
  // A failed preview as the page keeps it (R8-03): its code picks Restart keyloom for a failure no screen planned for, with Try again only
  // for an exception.
  const [previewFailure, setPreviewFailure] = useState<PageFailure | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  // The Put step's map that failed replaces "Mapping it…"; Try again reads it again (R6-05).
  const [putFailure, setPutFailure] = useState<PutProblem | null>(null);
  const [putAttempt, setPutAttempt] = useState(0);
  // A failed QMK and ZMK search, apart from other problems, so its alert carries Search again (R6-19).
  const [searchProblem, setSearchProblem] = useState<string | null>(null);
  // A config refused because its keyboard was removed (R6-08): the page offers Restore, then does this again.
  const [removed, setRemoved] = useState<"blank" | "make" | null>(null);
  const [activities, setActivities] = useState<ReviewActivity[]>([]);
  // An Add refused for good (R7-11), with the answers it was refused for: other answers may pass, so they offer Add again.
  const [addRefusal, setAddRefusal] = useState<{ key: string; problem: DeriveProblem } | null>(null);
  const searchSequence = useRef(0);
  const waiting = keyboards.filter((k) => k.status !== "known");
  const offered = waiting.filter((k) => !dismissed.has(keyboardKey(k)));
  const setupWaiting = knownWithNoConfig.filter((k) => k.knownBoard !== null && !dismissed.has(k.knownBoard.id));

  // A keyboard or a bare board that appears opens its card once; "Not now" leaves it to the chip in the board switch.
  const shown = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (step.kind !== "idle") return;
    const open = cardToOpen(offered, setupWaiting, shown.current);
    if (open === null) return;
    shown.current = new Set([...shown.current, open.shown]);
    setStep(open.step);
  }, [offered, setupWaiting, step.kind]);

  // The card's keyboard was unplugged: the card goes with it, unless BK is already past choosing.
  useEffect(() => {
    if (step.kind !== "card") return;
    if (!waiting.some((k) => keyboardKey(k) === keyboardKey(step.keyboard))) setStep({ kind: "idle" });
  }, [waiting, step]);

  // A bare board that was set up elsewhere, or unplugged, closes its card.
  useEffect(() => {
    if (step.kind !== "setup" || step.keyboard === null) return;
    const boardId = step.boardId;
    if (!knownWithNoConfig.some((k) => k.knownBoard?.id === boardId)) setStep({ kind: "idle" });
  }, [knownWithNoConfig, step]);

  // The board as it would be added, drawn from the pinned firmware tree; again whenever the home row or the controller changes.
  const confirmKey = step.kind === "confirm" || step.kind === "review" ? `${step.candidate.id}|${step.homeRow ?? ""}|${step.controller ?? ""}|${step.layout ?? ""}` : null;
  const addBlocked = addRefusal !== null && addRefusal.key === confirmKey ? addRefusal.problem : null;
  useEffect(() => {
    if (step.kind !== "confirm" && step.kind !== "review") return;
    const controller = new AbortController();
    setProblem(null);
    setPreviewProblem(null);
    setPreviewProblemCode(null);
    setPreviewProblemBoard(null);
    setPreviewFailure(null);
    // The drawing of the old home row or controller must not stay up while the new one is read, or a failed read would hide behind it.
    setPreview(null);
    api.previewKeyboard(token, {
      candidate: step.candidate.id,
      ...(step.homeRow === null ? {} : { homeRow: step.homeRow }),
      ...(step.controller === null ? {} : { controller: step.controller }),
      ...(step.layout === null ? {} : { layout: step.layout }),
    }, controller.signal).then((p) => { if (!controller.signal.aborted) setPreview(p); }, (e) => {
      if (controller.signal.aborted) return;
      setPreviewProblem(message(e));
      setPreviewProblemCode(e instanceof ApiError ? (e.code ?? null) : null);
      setPreviewProblemBoard(knownBoardOf(e, step.candidate.name));
      setPreviewFailure(pageFailure(e, ""));
    });
    return () => controller.abort();
    // The key stands for the step's inputs; the attempt is Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, confirmKey, previewAttempt]);

  // What the put would make, mapped, before anything is made.
  const putKey = step.kind === "put" && step.source !== null ? `${step.boardId}|${step.source}|${JSON.stringify(step.choices)}` : null;
  useEffect(() => {
    setPutFailure(null);
    if (step.kind !== "put" || step.source === null) {
      setPutPreview(null);
      return;
    }
    const controller = new AbortController();
    const boardName = step.boardName;
    setProblem(null);
    // The map of the config picked before must not stay up while this one is read, or a failure would hide behind it.
    setPutPreview(null);
    api.previewPut(token, { from: step.source, board: step.boardId, placements: step.choices }, controller.signal).then(setPutPreview, (e: unknown) => {
      if (!controller.signal.aborted) setPutFailure(putProblem(e, boardName));
    });
    return () => controller.abort();
    // The key stands for the step's inputs; the attempt is Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, putKey, putAttempt]);

  const search = useCallback(async (text: string) => {
    const sequence = ++searchSequence.current;
    setProblem(null);
    setSearchProblem(null);
    setSearchText(text);
    if (text.trim().length < 2) {
      setFound([]);
      setFoundFor(null);
      return;
    }
    try {
      const result = await api.searchKeyboards(token, text.trim());
      if (searchSequence.current === sequence) {
        setFound(result.candidates);
        setFoundFor(text.trim());
      }
    } catch (e) {
      if (searchSequence.current === sequence) setSearchProblem(message(e));
    }
  }, [token]);

  const candidateOf = (k: DetectedKeyboard, id: string): ApiCandidate | undefined => k.candidates.find((c) => c.id === id) ?? found.find((c) => c.id === id);

  return {
    chooseKnown: (board: { id: string; name: string }) => {
      setProblem(null);
      setStep({ kind: "setup", keyboard: null, boardId: board.id, boardName: board.name });
    },
    chooseCandidate: (candidate: ApiCandidate) => {
      setProblem(null); setPreview(null);
      setStep({ kind: "confirm", keyboard: null, candidate, homeRow: null, controller: null, layout: null });
    },
    /** For Restart keyloom beside a failure no screen planned for (R8-03). */
    token,
    /** The last Add, Start blank or Make failed in a way that sending it again meets the same way (R9-05): its button is off. */
    stuck: failsAgain(problem),
    step, preview, addBlocked, previewProblem, previewFailure, previewProblemCode, previewProblemBoard, putPreview, putFailure, busy, problem, searchProblem, removed, waiting,
    /** Reads the board preview again after it failed. */
    retryPreview: () => setPreviewAttempt((n) => n + 1), setupWaiting, searchText, found, foundFor, activities, setActivities,
    /** Restores a removed keyboard, for a config refused because of it (R6-08). */
    restoreKeyboard: (board: string) => api.restoreKeyboard(token, board),
    /** Maps the picked config again after the map failed (R6-05). */
    retryPut: () => setPutAttempt((n) => n + 1),
    /** Runs the failed QMK and ZMK search again (R6-19). */
    retrySearch: () => void search(searchText),
    /** "Pick another config": the Put step without a config picked, so the list is the next thing to do (R6-05). */
    clearSource: () => setStep((s) => (s.kind === "put" ? { ...s, source: null, choices: {} } : s)),
    /** "Put a config on it": the keyboard picked as new is a board keyloom has (R6-07), so the put step for that board, by its own name. */
    putOnKnown: () => {
      if ((step.kind !== "confirm" && step.kind !== "review") || previewProblemBoard === null) return;
      setPreview(null);
      setPutPreview(null);
      setProblem(null);
      setStep({ kind: "put", boardId: previewProblemBoard.id, boardName: previewProblemBoard.name, source: null, choices: {}, origin: "matched" });
    },
    /** Opens the card again for a keyboard put off with "Not now". */
    reopen: (k: DetectedKeyboard) => {
      setDismissed((d) => new Set([...d].filter((x) => x !== keyboardKey(k))));
      setStep({ kind: "card", keyboard: k, choice: k.ambiguous ? null : (k.candidates[0]?.id ?? null) });
    },
    /** Opens the setup card again for a known board with no config put off with "Not now". */
    reopenSetup: (k: DetectedKeyboard) => {
      if (k.knownBoard === null) return;
      const board = k.knownBoard;
      setDismissed((d) => new Set([...d].filter((x) => x !== board.id)));
      setStep({ kind: "setup", keyboard: k, boardId: board.id, boardName: board.name });
    },
    notNow: () => {
      setActivities([]);
      if ((step.kind === "card" || step.kind === "confirm" || step.kind === "review") && step.keyboard !== null) {
        const keyboard = step.keyboard;
        setDismissed((d) => new Set([...d, keyboardKey(keyboard)]));
      }
      if (step.kind === "setup") setDismissed((d) => new Set([...d, step.boardId]));
      setStep({ kind: "idle" });
      setPreview(null);
      setProblem(null);
      setRemoved(null);
    },
    choose: (id: string) => setStep((s) => (s.kind === "card" ? { ...s, choice: id } : s)),
    search,
    /** The card's "It's a Corne": on to the home row, with the board drawn. */
    confirmCandidate: () => {
      if (step.kind !== "card" || step.choice === null) return;
      const candidate = candidateOf(step.keyboard, step.choice);
      if (candidate === undefined) return;
      setPreview(null);
      setStep({ kind: "confirm", keyboard: step.keyboard, candidate, homeRow: null, controller: null, layout: null });
    },
    /** Back to the candidates, from the Confirm step or from an Add refused for good on the Review step (R7-11). */
    backToCard: () => {
      if (step.kind !== "confirm" && step.kind !== "review") return;
      if (step.keyboard === null) { setStep({ kind: "idle" }); return; }
      setStep({ kind: "card", keyboard: step.keyboard, choice: step.candidate.id });
    },
    setHomeRow: (row: number) => setStep((s) => (s.kind === "confirm" || s.kind === "review" ? { ...s, homeRow: row } : s)),
    setController: (id: string) => setStep((s) => (s.kind === "confirm" ? { ...s, controller: id } : s)),
    /** Another QMK layout has other rows, so the home row goes back to keyloom's guess for it. */
    setLayout: (name: string) => setStep((s) => (s.kind === "confirm" ? { ...s, layout: name, homeRow: null } : s)),
    review: () => {
      const next = reviewStep(step, preview);
      if (next !== null) setStep(next);
    },
    backToConfirm: () => {
      if (step.kind !== "review") return;
      setStep({ kind: "confirm", keyboard: step.keyboard, candidate: step.candidate, homeRow: step.homeRow, controller: step.controller, layout: step.layout });
    },
    /** Stores the board. Resolves to its id, for the put step. */
    add: async () => {
      if (step.kind !== "review") return;
      setBusy(true);
      setProblem(null);
      try {
        const out = await api.addKeyboard(token, {
          candidate: step.candidate.id, homeRow: step.homeRow,
          ...(step.controller === null ? {} : { controller: step.controller }),
          ...(step.layout === null ? {} : { layout: step.layout }),
        });
        setStep({ kind: "put", boardId: out.boardId, boardName: out.displayName, source: null, choices: {}, origin: "new" });
        onAdded?.();
      } catch (e) {
        // Another tab or the CLI added this board after the preview (R10-13). Say so as the preview does, with Put a config on it, never
        // the server's sentence, which names CLI flags.
        const known = addedElsewhere(e, step);
        const blocked = blockedAdd(e, step, preview);
        if (known !== null) { setPreviewProblemCode("board_known"); setPreviewProblemBoard(known); }
        else if (blocked !== null && confirmKey !== null) setAddRefusal({ key: confirmKey, problem: blocked });
        else setProblem(addProblem(e, step, preview));
      } finally {
        setBusy(false);
      }
    },
    /** "Put one of my configs on it": the put step for a board keyloom already knows. */
    startPut: () => {
      if (step.kind !== "setup") return;
      setPreview(null);
      setPutPreview(null);
      setProblem(null);
      // A Start blank refused on the setup card must not follow to the Put step, where its Restore would start a blank config (#299 review).
      setRemoved(null);
      setStep({ kind: "put", boardId: step.boardId, boardName: step.boardName, source: null, choices: {}, origin: "known" });
    },
    /**
     * "Start blank": a new config from the board's own starting point, then open it. Resolves to its id, or null on a failure. `free`:
     * `name` is keyloom's own default, so it becomes "name 2", "name 3"… when a config already has it (R4-16). A typed name is kept. On
     * the Confirm and Review steps, the board is the one keyloom already has for the keyboard picked as new (R7-10).
     */
    startBlank: async (name: string, opts: { free?: boolean } = {}): Promise<string | null> => {
      const board = blankBoardFor(step, previewProblemBoard);
      if (board === null) return null;
      setBusy(true);
      setProblem(null);
      setRemoved(null);
      try {
        // Every config's name, archived ones and removed keyboards' included: they still hold their names (#290 review).
        const taken = opts.free === true ? (await fetchAllConfigs(token)).map((config) => config.name) : [];
        const config = await createConfig(token, { from: "blank", name: firstFreeName(name.trim(), taken), board });
        return config.id;
      } catch (e) {
        if (keyboardRemoved(e)) setRemoved("blank");
        else setProblem(pageFailure(e, "keyloom couldn't start a blank config."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    chooseSource: (id: string) => {
      // A refused Start a config doesn't follow to the config just picked; a refused make stays, and its Restore makes the one picked now.
      setRemoved((r) => (r === "blank" ? null : r));
      setStep((s) => (s.kind === "put" ? { ...s, source: id, choices: {} } : s));
    },
    choosePlacement: (source: number, target: number) => setStep((s) => (s.kind === "put" ? { ...s, choices: { ...s.choices, [String(source)]: target } } : s)),
    /** Makes the config with its proposals. Resolves to what was made, so the page can open it. */
    make: async (): Promise<PutResponse | null> => {
      if (step.kind !== "put" || step.source === null) return null;
      setBusy(true);
      setProblem(null);
      setRemoved(null);
      try {
        const out = await api.putConfig(token, { from: step.source, board: step.boardId, placements: step.choices, ...(activities.length ? { reviewActivities: activities } : {}) });
        setStep({ kind: "idle" });
        setPutPreview(null);
        setPreview(null);
        setActivities([]);
        return out;
      } catch (e) {
        if (keyboardRemoved(e)) setRemoved("make");
        else setProblem(pageFailure(e, "keyloom couldn't make this config."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    close: () => {
      shown.current = shownAfterClose(step, shown.current);
      setActivities([]);
      setRemoved(null);
      setStep({ kind: "idle" });
      setPreview(null);
      setPutPreview(null);
      setProblem(null);
    },
  };
}

export type NewKeyboard = ReturnType<typeof useNewKeyboard>;
