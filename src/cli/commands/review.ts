// `keyloom review` (D-340, 10#command-tree): what keyloom found in a config's head revision. Without --run it shows the review the
// server made (or the last one); with --run it makes the head's review now, agent part included, and waits for it.
import type { Command } from "commander";
import {
  type BoardReview, PROVIDERS, type ProviderId, type ReviewItem, type ReviewView, ReviewEngine, UsageError, defaultAgentModel, dismissReviewItem, listLayouts, restoreReviewItem, reviewWords,
} from "../../app/index.ts";
import { parseProvider, type ChatDeps } from "./chat.ts";
import { type Format, print } from "../output.ts";
import type { CliContext } from "./context.ts";

const itemJson = (i: ReviewItem) => ({
  id: i.id, source: i.source, kind: i.kind, severity: i.severity, code: i.code, title: i.title, body: i.body,
  keys: i.keys.map((k) => ({ layer_id: k.layerId, position: k.position })), layers: i.layers, proposal_id: i.proposalId, fixes: i.fixes, dismissed_at: i.dismissedAt,
});

const reviewJson = (r: BoardReview) => ({
  id: r.id, layout_id: r.layoutId, revision_id: r.revisionId, trigger: r.trigger, checked_at: r.checkedAt,
  checks: { status: r.checks.status, summary: r.checks.summary }, ai: r.ai,
  items: r.items.map(itemJson), fixed: r.fixed.map((f) => ({ ...itemJson(f), fixed_since: f.fixedSince })),
});

export const viewJson = (v: ReviewView) => ({ layout_id: v.layoutId, head_revision_id: v.headRevisionId, stale: v.review !== null && v.review.revisionId !== v.headRevisionId, review: v.review && reviewJson(v.review) });

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const AI_WORDS: Record<BoardReview["ai"]["status"], string> = {
  pending: "keyloom's own look has not started", running: "keyloom is still looking", done: "keyloom looked it over",
  unavailable: "keyloom's own look needs a model", failed: "keyloom's own look did not finish",
};

/** The review in plain words: problems first, then suggestions, then hints; hidden items are counted, not listed. */
export function reviewText(app: Parameters<typeof reviewWords>[0], v: ReviewView, name: string): string {
  const r = v.review;
  if (r === null) return `No review of ${name} yet. Make one with: keyloom review ${name} --run`;
  const words = (t: string) => reviewWords(app, r, t);
  const shown = r.items.filter((i) => i.dismissedAt === null);
  const hidden = r.items.length - shown.length;
  const section = (title: string, kind: ReviewItem["kind"]): string[] => {
    const items = shown.filter((i) => i.kind === kind);
    return items.length === 0 ? [] : [
      "", title,
      ...items.flatMap((i) => [
        `  ${words(i.title)}${i.source === "agent" ? "  (keyloom)" : ""}`, `    ${words(i.body)}`,
        ...(i.proposalId ? [`    Proposed change: ${i.proposalId}. See it with: keyloom change show ${i.proposalId}`] : []),
      ]),
    ];
  };
  const tally = (["problem", "suggestion", "hint"] as const).flatMap((kind) => {
    const n = shown.filter((i) => i.kind === kind).length;
    return n === 0 ? [] : [count(n, kind)];
  });
  const checked = `${count(r.checks.summary.layers, "layer")}, ${count(r.checks.summary.keys, "key")} and ${count(r.checks.summary.combos, "combo")} checked`;
  return [
    `${name}: ${shown.length === 0 ? "nothing to note" : tally.join(", ")}`,
    ...(v.headRevisionId !== r.revisionId ? ["This is the review of an earlier version of the config; run it again for the latest."] : []),
    ...section("Problems", "problem"), ...section("Suggestions", "suggestion"), ...section("Hints", "hint"),
    ...(r.fixed.length === 0 ? [] : ["", "Fixed since the last look", ...r.fixed.map((f) => `  ${words(f.title)}`)]),
    "",
    `${checked}. ${AI_WORDS[r.ai.status]}${r.ai.reason ? `: ${r.ai.reason}` : ""}.${hidden > 0 ? ` ${count(hidden, "hidden item")}.` : ""}`,
  ].join("\n");
}

function resolveLayoutArg(app: Parameters<typeof listLayouts>[0], ref?: string): string {
  if (ref !== undefined) return ref;
  const layouts = listLayouts(app);
  if (layouts.length !== 1) throw new UsageError(layouts.length === 0 ? "no layouts yet; import one first" : `name a config: ${layouts.map((l) => l.name).join(", ")}`);
  return (layouts[0] as { id: string }).id;
}

export function registerReviewCommand(program: Command, ctx: CliContext, deps: ChatDeps = {}): void {
  const review = program
    .command("review")
    .description("what keyloom found in a config: problems, suggestions and hints. --run looks again now, with the agent");

  review
    .command("show", { isDefault: true })
    .description("show the review for a config")
    .argument("[layout]", "config ID or name (optional when there is only one)")
    .option("--run", "make the review of the head now and wait for the agent's part")
    .option("--force", "with --run, run the agent again even when it already looked at this version")
    .option("--json", "print JSON, whatever the output format")
    .option("--provider <provider>", `model provider for the agent's look: ${PROVIDERS.join(", ")} (default: the config, then the first one with a credential)`)
    .action(async (layoutArg: string | undefined, opts: { run?: boolean; force?: boolean; json?: boolean; provider?: string }) => {
      if (opts.force && !opts.run) throw new UsageError("--force goes with --run");
      const provider: ProviderId | undefined = opts.provider === undefined ? undefined : parseProvider(opts.provider);
      const format: Format = opts.json ? "json" : ctx.format();
      await ctx.withApp(async (app) => {
        const ref = resolveLayoutArg(app, layoutArg);
        const engine = new ReviewEngine(app, { model: async () => deps.model ?? defaultAgentModel(app.dataDir, provider ? { provider } : {}) });
        if (opts.run) await engine.review(ref, "manual", { force: opts.force === true }).done;
        const view = engine.show(ref);
        const name = listLayouts(app).find((l) => l.id === view.layoutId)?.name ?? ref;
        print(ctx.io, format, { json: viewJson(view), table: reviewText(app, view, name), ids: view.review?.items.map((i) => i.id) ?? [] });
      });
    });

  review
    .command("dismiss")
    .description("hide a review finding on a config")
    .argument("<id>", "item ID to dismiss")
    .option("--layout <layout>", "config ID or name (optional when there is only one)")
    .action(async (itemId: string, opts: { layout?: string }) => {
      await ctx.withApp(async (app) => {
        const ref = resolveLayoutArg(app, opts.layout);
        const view = dismissReviewItem(app, ref, itemId);
        const name = listLayouts(app).find((l) => l.id === view.layoutId)?.name ?? ref;
        print(ctx.io, ctx.format(), {
          json: viewJson(view),
          ids: [itemId],
          table: `Dismissed review item ${itemId} on ${name}.`,
        });
      });
    });

  review
    .command("restore")
    .description("restore a hidden review finding on a config")
    .argument("<id>", "item ID to restore")
    .option("--layout <layout>", "config ID or name (optional when there is only one)")
    .action(async (itemId: string, opts: { layout?: string }) => {
      await ctx.withApp(async (app) => {
        const ref = resolveLayoutArg(app, opts.layout);
        const view = restoreReviewItem(app, ref, itemId);
        const name = listLayouts(app).find((l) => l.id === view.layoutId)?.name ?? ref;
        print(ctx.io, ctx.format(), {
          json: viewJson(view),
          ids: [itemId],
          table: `Restored review item ${itemId} on ${name}.`,
        });
      });
    });
}
