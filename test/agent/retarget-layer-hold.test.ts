import { expect, test } from "bun:test";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { retargetLayerHoldTool } from "../../src/agent/tools/retarget-layer-hold.ts";
import { groundedWorld } from "../helpers/grounded-review.ts";

test("the layer-hold tool changes only the proven layer argument and discloses the preserved tap", async () => {
  const w = groundedWorld();
  try {
    const result = JSON.parse(await retargetLayerHoldTool(createAgentPorts(w.app, w.layoutId, null)).run({ at: { layerId: "base", position: 0 }, layerId: "tools" }));
    expect(result.ops[0].binding.source).toBe("&mode 1 0");
    expect(result.ops[0].binding.layerRefs).toEqual([{ start: 6, end: 7, layerId: "tools" }]);
    expect(result.preservedTap).toBe("indicator");
    expect(result.saved).toBe(false);
    expect(result.validation.ok).toBe(false); // Factory still needs a route; the tool must not silently authorize dropping its functions.
    expect(result.validation.errors.some((e: { code: string }) => e.code === "function_lost")).toBe(true);
  } finally { w.app.db.close(); }
});
