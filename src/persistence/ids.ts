import { monotonicFactory } from "ulid";

export type IdPrefix = "lay" | "rev" | "cs" | "conv" | "msg" | "dec" | "bld" | "fl" | "pg" | "syn" | "typ" | "ver" | "rvw" | "run";

// Monotonic, so two IDs made in the same millisecond still sort in creation order.
const ulid = monotonicFactory();

/** `lay_01J...`: a type prefix makes a pasted ID self-describing (02). */
export const newId = (prefix: IdPrefix): string => `${prefix}_${ulid()}`;
