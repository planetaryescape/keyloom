// `keyloom doctor --download kanata|zapp` (D-030 parity with Get kanata and Get Zapp, D-560 and D-561): the same download the page runs,
// with its progress on the terminal.
import { type DownloadDeps, type DownloadOutcome, type KeptTool, downloadTool, toolInUse } from "../app/tool-download.ts";

/** Downloads only where the tool is missing: keyloom's copy is the last place it looks, so a second one would never run. */
export async function downloadToolWithProgress(
  tool: KeptTool, say: (line: string) => void, deps: DownloadDeps & { inUse?: (tool: KeptTool) => string | undefined } = {}, signal?: AbortSignal,
): Promise<DownloadOutcome | { ok: true; path: string; already: true }> {
  const { inUse = toolInUse, ...download } = deps;
  const found = inUse(tool);
  if (found !== undefined) {
    say(`keyloom: ${tool} is already at ${found}, so nothing was downloaded`);
    return { ok: true, path: found, already: true };
  }
  const outcome = await downloadTool(tool, say, download, signal);
  if (!outcome.ok) say(`keyloom: ${outcome.reason}`);
  return outcome;
}
