// What a person is asked to type. Plain text steps, and "hold" steps for the mod-tap keys, because a hold that comes out as a tap is
// a misfire no amount of plain typing can reveal.
export type PassageStep =
  | { kind: "text"; text: string }
  /** Hold the key that types `key` (a mod-tap key) and press the key that types `then`, then let go of both. */
  | { kind: "hold"; key: string; then: string };

export type Passage = {
  id: string;
  title: string;
  /** What the passage is for, in a sentence. */
  why: string;
  steps: PassageStep[];
};
