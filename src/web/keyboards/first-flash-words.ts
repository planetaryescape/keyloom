// How the first flash of a keyboard just added goes, in words (D-336, R8-08). Pure.

/** "Press the QK_BOOT key…" → "press the QK_BOOT key…": only a first word in plain case starts lower, so "RST" or "QK_BOOT" stay as written. */
const lowerFirst = (text: string): string => (/^[A-Z][a-z]/.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);

/** True when the step has more than one sentence, such as caterina's "…750 ms). The bootloader only waits about 7 seconds…". */
const severalSentences = (text: string): boolean => /[.!?)]\s+[A-Z]/.test(text.replace(/[.!?]$/, ""));

/**
 * The line after "The first flash is by hand:". A one-sentence step is part of the line ("Build and flash, then press the QK_BOOT key
 * when it asks."). A longer one follows it as written, so its own sentences keep their capitals and stops.
 */
export function firstFlashLine(steps: readonly string[]): string {
  const halves = steps.length > 1 ? "on each half, " : "";
  const step = (steps[0] ?? "").replace(/^Plug in the (left|right) half and /i, "").trim();
  if (step === "") return `Build and flash, then ${halves}put the keyboard in its bootloader when it asks.`;
  if (severalSentences(step)) return `Build and flash, then ${halves}do this when it asks: ${step.charAt(0).toUpperCase()}${step.slice(1).replace(/([^.!?])$/, "$1.")}`;
  return `Build and flash, then ${halves}${lowerFirst(step.replace(/[.!?]$/, ""))} when it asks.`;
}
