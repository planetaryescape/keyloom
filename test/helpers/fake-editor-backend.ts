// An in-memory EditorBackend and LayoutSource for the dev harness and the server tests. It handles
// only setBinding, checks only what the editor UI can get wrong, and times builds and flashes from
// the clock, so a reader polling it sees the same progression a real build would show.
import {
  KEYCODES,
} from "../../src/layout/keycodes.ts";
import type { ApplyRequest, ApplyResponse, Build, BuildRequest, CheckRequest, Flash, LayoutDetail, RevisionInfo, UndoRequest, UndoResponse } from "../../src/api/http.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import type { Slot } from "../../src/layout/change.ts";
import { EditorError, type EditorBackend } from "../../src/server/editor-backend.ts";
import type { LayoutSource } from "../../src/server/layout-source.ts";
import type { Issue, ValidationResult } from "../../src/validation/result.ts";

export interface FakeOptions {
  buildMs?: number;
  /** How long the flash waits for the reset button, then writes for the same time again. */
  flashStepMs?: number;
  failBuild?: boolean;
  failFlash?: boolean;
  /** Answer 400 usage to a build with no boardRevision, as the real backend does with no keyboard connected. */
  needsBoardRevision?: boolean;
}

type Revision = RevisionInfo & { document: Layout };

const BUILD_LOG: readonly (readonly [number, string])[] = [
  [0, "docker: using image zsa/qmk_modern:latest"],
  [0.05, "Compiling keymap for zsa/moonlander"],
  [0.15, "[1/6] Generating keymap.c"],
  [0.25, "[2/6] Compiling quantum/keymap_common.c"],
  [0.4, "[3/6] Compiling quantum/process_keycode/process_combo.c"],
  [0.55, "[4/6] Compiling keyboards/zsa/moonlander/moonlander.c"],
  [0.7, "[5/6] Compiling keyboards/zsa/moonlander/keymaps/keyloom/keymap.c"],
  [0.85, "[6/6] Linking zsa_moonlander_keyloom.elf"],
  [0.95, "Copying zsa_moonlander_keyloom.bin to the build folder"],
];

const FLASH_LOG: readonly string[] = [
  "zapp: looking for a Moonlander in bootloader mode",
  "zapp: found a Moonlander bootloader",
  "zapp: erasing flash",
  "zapp: writing 51.3 kB",
  "zapp: verifying",
];

export class FakeEditor implements EditorBackend {
  private revisions: Revision[];
  private counter = 0;
  private readonly builds = new Map<string, { build: Build; revisionId: string }>();
  private readonly flashes = new Map<string, { flash: Flash; startedAt: number }>();
  private readonly options: Required<FakeOptions>;

  constructor(
    private readonly base: LayoutDetail,
    options: FakeOptions = {},
  ) {
    this.options = { buildMs: 10_000, flashStepMs: 5_000, failBuild: false, failFlash: false, needsBoardRevision: false, ...options };
    this.revisions = [{ ...base.revision, document: structuredClone(base.document) }];
  }

  private get head(): Revision {
    return this.revisions[this.revisions.length - 1] as Revision;
  }

  /** The read side, so one object serves both interfaces. */
  source(id = "moonlander-daily", name = "Daily driver"): LayoutSource {
    return {
      list: async () => [
        {
          id,
          name,
          boardId: this.base.board.id,
          createdAt: this.base.revision.createdAt,
          updatedAt: this.head.createdAt,
          revisionId: this.head.id,
        },
      ],
      get: async (ref) => (ref === id ? this.detail() : null),
    };
  }

  detail(): LayoutDetail {
    const { document, ...revision } = this.head;
    return { ...this.base, revision, document: structuredClone(document) };
  }

  async check(_ref: string, request: CheckRequest): Promise<ValidationResult> {
    return this.validate(request);
  }

  async apply(_ref: string, request: ApplyRequest): Promise<ApplyResponse> {
    if (request.baseRevisionId !== this.head.id) {
      throw new EditorError(409, "stale_base", "The layout changed since you opened it.");
    }
    const validation = this.validate(request);
    if (!validation.ok) {
      throw new EditorError(409, "invalid_ops", validation.errors[0]?.message ?? "Invalid change.", validation);
    }
    const document = structuredClone(this.head.document);
    for (const op of request.ops) {
      if (op.op === "setBinding") document.layers.find((l) => l.id === op.at.layerId)!.bindings[op.at.position] = op.binding;
    }
    const revision = this.push("editor", request.summary, document);
    return { revisionId: revision.id, changeSetId: `cs_${++this.counter}`, validation };
  }

  async undo(_ref: string, request: UndoRequest): Promise<UndoResponse> {
    if (request.revisionId !== this.head.id) {
      throw new EditorError(409, "stale_head", "The layout changed since you opened it.");
    }
    const parent = this.revisions.find((r) => r.id === this.head.parentId);
    if (parent === undefined) throw new EditorError(409, "not_undoable", "There is nothing to undo.");
    const revision = this.push("undo", `Undid: ${this.head.summary}`, structuredClone(parent.document));
    return { revisionId: revision.id };
  }

  async startBuild(_ref: string, request: BuildRequest): Promise<Build> {
    if (this.options.needsBoardRevision && request.boardRevision === undefined) {
      throw new EditorError(400, "usage", "No Moonlander is connected, so keyloom can't tell which revision to build for. Choose Rev A or Rev B.");
    }
    if (!this.revisions.some((r) => r.id === request.revisionId)) {
      throw new EditorError(404, "not_found", "No such revision.");
    }
    const id = `build_${++this.counter}`;
    const build = this.progressBuild(id, request.revisionId, Date.now());
    this.builds.set(id, { build, revisionId: request.revisionId });
    return build;
  }

  async getBuild(id: string): Promise<Build | null> {
    const entry = this.builds.get(id);
    return entry === undefined ? null : this.progressBuild(id, entry.revisionId, entry.build.startedAt);
  }

  async startFlash(buildId: string): Promise<Flash> {
    const build = await this.getBuild(buildId);
    if (build === null) throw new EditorError(404, "not_found", "No such build.");
    if (build.status !== "succeeded") throw new EditorError(409, "build_not_ready", "Only a finished build can be flashed.");
    const id = `flash_${++this.counter}`;
    const startedAt = Date.now();
    this.flashes.set(id, { flash: this.progressFlash(id, buildId, startedAt), startedAt });
    return this.progressFlash(id, buildId, startedAt);
  }

  async getFlash(id: string): Promise<Flash | null> {
    const entry = this.flashes.get(id);
    return entry === undefined ? null : this.progressFlash(id, entry.flash.buildId, entry.startedAt);
  }

  private push(origin: RevisionInfo["origin"], summary: string, document: Layout): Revision {
    const revision: Revision = {
      id: `rev_${++this.counter}`,
      parentId: this.head.id,
      origin,
      summary,
      createdAt: Date.now(),
      undoable: true,
      document,
    };
    this.revisions.push(revision);
    return revision;
  }

  private validate(request: CheckRequest): ValidationResult {
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    const changed: Slot[] = [];
    const document = this.head.document;
    for (const op of request.ops) {
      if (op.op !== "setBinding") {
        errors.push({ code: "unsupported", message: `The dev backend does not handle ${op.op}.` });
        continue;
      }
      const layer = document.layers.find((l) => l.id === op.at.layerId);
      const slots = [op.at];
      if (layer === undefined || op.at.position >= layer.bindings.length) {
        errors.push({ code: "unknown_slot", message: "That key does not exist on this layer.", slots });
        continue;
      }
      changed.push(op.at);
      errors.push(...this.bindingErrors(op.binding, document, op.at));
      const before = layer.bindings[op.at.position] as Binding;
      const others = layer.bindings.filter((b, i) => i !== op.at.position && b.kind === "key" && b.code === "ESCAPE");
      if (before.kind === "key" && before.code === "ESCAPE" && others.length === 0 && !(op.binding.kind === "key" && op.binding.code === "ESCAPE")) {
        warnings.push({ code: "unreachable_key", message: `Nothing on ${layer.name} sends Escape any more.`, slots });
      }
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      diff: { changed, displaced: [], dropped: [], relearnCount: changed.length, reminders: [] },
    };
  }

  private bindingErrors(binding: Binding, document: Layout, at: Slot): Issue[] {
    const slots = [at];
    const known = (code: string) => KEYCODES.some((k) => k.name === code);
    switch (binding.kind) {
      case "key":
        return known(binding.code) ? [] : [{ code: "unknown_keycode", message: `${binding.code} is not a key keyloom knows.`, slots }];
      case "holdTap": {
        const issues: Issue[] = [];
        if (!known(binding.tap.code)) issues.push({ code: "unknown_keycode", message: `${binding.tap.code} is not a key keyloom knows.`, slots });
        if (!document.holdTapProfiles.some((p) => p.id === binding.profileId)) {
          issues.push({ code: "unknown_profile", message: `There is no hold-tap profile ${binding.profileId}.`, slots });
        }
        if ("layerId" in binding.hold && !document.layers.some((l) => l.id === (binding.hold as { layerId: string }).layerId)) {
          issues.push({ code: "unknown_layer", message: "The hold layer does not exist.", slots });
        }
        return issues;
      }
      case "layer":
        if (!document.layers.some((l) => l.id === binding.layerId)) return [{ code: "unknown_layer", message: "That layer does not exist.", slots }];
        if (binding.layerId === at.layerId && binding.action === "momentary") {
          return [{ code: "layer_self_reference", message: "A key on this layer can't hold this same layer: you would never be able to release it.", slots }];
        }
        return [];
      case "macro":
        return document.macros.some((m) => m.id === binding.macroId) ? [] : [{ code: "unknown_macro", message: "That macro does not exist.", slots }];
      default:
        return [];
    }
  }

  private progressBuild(id: string, revisionId: string, startedAt: number): Build {
    const { buildMs, failBuild } = this.options;
    const elapsed = Date.now() - startedAt;
    const endsAt = failBuild ? buildMs * 0.7 : buildMs;
    const done = elapsed >= endsAt;
    const progress = Math.min(1, elapsed / buildMs);
    const lines = BUILD_LOG.filter(([at]) => at <= progress).map(([, line]) => line);
    if (done && failBuild) {
      lines.push("keymap.c:212:5: error: 'LAYER_9' undeclared (first use in this function)", "make: *** [Makefile:410: keymap.o] Error 1");
    }
    if (done && !failBuild) lines.push("Build finished: zsa_moonlander_keyloom.bin");
    return {
      id,
      revisionId,
      status: !done ? "running" : failBuild ? "failed" : "succeeded",
      error: done && failBuild ? "The compiler stopped with an error. The last lines of the log say where." : null,
      startedAt,
      finishedAt: done ? startedAt + endsAt : null,
      logTail: lines.slice(-12),
    };
  }

  private progressFlash(id: string, buildId: string, startedAt: number): Flash {
    const { flashStepMs, failFlash } = this.options;
    const elapsed = Date.now() - startedAt;
    const writing = elapsed >= flashStepMs;
    const writeEnd = flashStepMs * 2;
    const failed = failFlash && elapsed >= flashStepMs * 1.5;
    const succeeded = !failFlash && elapsed >= writeEnd;
    const status: Flash["status"] = failed ? "failed" : succeeded ? "succeeded" : writing ? "writing" : "waiting_for_bootloader";
    const lines = FLASH_LOG.slice(0, status === "waiting_for_bootloader" ? 1 : writing ? Math.min(FLASH_LOG.length, 3 + Math.floor((elapsed - flashStepMs) / (flashStepMs / 2))) : 1);
    if (succeeded) lines.push("zapp: done. The keyboard is restarting");
    if (failed) lines.push("zapp: write failed at 38%: device disconnected");
    return {
      id,
      buildId,
      status,
      error: failed ? "The keyboard disconnected while keyloom was writing. Plug it in again and press the reset button to retry." : null,
      startedAt,
      finishedAt: failed ? startedAt + flashStepMs * 1.5 : succeeded ? startedAt + writeEnd : null,
      instruction: status === "waiting_for_bootloader" ? "Press the reset button on the Moonlander." : null,
      logTail: lines,
    };
  }
}
