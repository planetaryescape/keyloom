import { z } from "zod";
import type { AgentPorts, TypingFindings } from "../ports.ts";
import { defineTool } from "./define.ts";

const ms = (n: number) => `${Math.round(n)} ms`;

export function typingFindingsText(f: TypingFindings): string {
  if (f.sessions === 0) return "BK has not recorded any typing on this layout. The typing lab (`keyloom lab start`) records his keyboard while he types a prompted passage, and then tells him what goes wrong with his timings.";
  const latest = f.latest;
  if (!latest) return `${f.sessions} typing session${f.sessions === 1 ? "" : "s"} recorded on this layout, none analysed yet. BK runs \`keyloom lab analyse <session>\` to see what they show.`;
  const c = latest.counts;
  return [
    `Latest analysed typing session (${f.analysed} of ${f.sessions} analysed): ${latest.presses} key presses over ${Math.round(latest.seconds)} s.`,
    `Counts: ${c.misfireHold} holds where a tap was meant, ${c.misfireTap} taps where a hold was meant, ${c.typo} typos, ${c.missed} missed keys, ${c.double} doubled keys.`,
    ...(latest.findings.length === 0 ? ["Findings: nothing stood out."] : ["Findings:", ...latest.findings.slice(0, 6).map((x) => `- ${x.sentence}`)]),
    ...(latest.fingers.length === 0 ? [] : ["Per finger (keys, errors, median time between keys):", ...latest.fingers.map((x) => `- ${x.finger.replaceAll("-", " ")}: ${x.keys}, ${x.errors}, ${ms(x.medianMsBetweenKeys)}`)]),
    ...(latest.suggestions.length === 0
      ? ["No setting change was proven to help on this recording."]
      : [
          "Changes tried on his own recording (counts are misfires on the keys the change touches):",
          ...latest.suggestions.flatMap((s) => [
            `- ${s.title}: ${s.before} before, ${s.after} after (${s.removed} gone, ${s.introduced} new)${s.changeSetId ? `. Already proposed as ${s.changeSetId}.` : ". Could not be stored as a proposal."}`,
            ...s.examples.map((e) => `    e.g. ${e.keys.join(" then ")}: ${e.kind === "misfire-hold" ? "a hold fired" : "a tap fired"}, key down ${ms(e.heldMs)}${e.overlapMs > 0 ? `, ${ms(e.overlapMs)} of it after the next key went down` : ""}`),
          ]),
        ]),
    ...latest.notes.map((n) => `Note: ${n}`),
  ].join("\n");
}

export const getTypingFindingsTool = (ports: AgentPorts) =>
  defineTool({
    name: "get_typing_findings",
    description:
      "What BK's recorded typing sessions on this layout show about his timings: holds that fired when he meant a tap (or the reverse), typos, missed and doubled keys, which finger is slow or makes the errors, and the setting changes already tried on his own recording with before and after counts. Aggregated and anonymised: you get counts, plain-word findings and key names, never what he typed. Call it when he says home row mods misfire, keys feel slow, or asks what to tune; use its evidence in what you say and propose. Read-only.",
    inputSchema: z.object({}),
    run: () => typingFindingsText(ports.typingFindings()),
  });
