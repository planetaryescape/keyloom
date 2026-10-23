// Whether a layout already holds a key that drives the firmware's lights (RGB underglow or the RGB matrix's controls). Such a key is
// the evidence that a board's firmware has lighting controls, since no board data records them. A key's own steps count, and so does
// a layer hold's tap. Pure.
import { keptDefinitions } from "./kept-behaviours.ts";
import { readNative } from "./native-read.ts";
import type { Layout } from "./schema.ts";

export function holdsLightingControl(doc: Layout): boolean {
  const kept = keptDefinitions(doc.passthrough);
  const natives = [...doc.layers.flatMap((l) => l.bindings), ...doc.combos.map((c) => c.output)];
  return natives.some((b) => {
    if (b.kind !== "native") return false;
    const reading = readNative(b, kept);
    const steps = reading.kind === "steps" ? reading.steps : reading.kind === "holdLayer" ? reading.tapSteps : [];
    return steps.some((step) => step.kind === "lighting");
  });
}
