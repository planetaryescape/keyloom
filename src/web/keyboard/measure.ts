// Text widths measured with the font the browser actually has, so a choice that depends on a few pixels is made on real widths
// rather than an estimate. Null where there is no canvas (server rendering, tests); callers fall back to fit.ts's estimate.
let context: CanvasRenderingContext2D | null | undefined;

export function measureText(text: string, font: string): number | null {
  if (context === undefined) context = typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") ?? null);
  if (context === null) return null;
  context.font = font;
  return context.measureText(text).width;
}
