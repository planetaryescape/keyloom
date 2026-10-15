import { useSyncExternalStore } from "react";

/** Follows a CSS media query, so layout rules that live in JavaScript (which half of the board shows) use the same breakpoints as the stylesheet. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** At or under the width where the side panel becomes a bottom sheet (18#phones). */
export const NARROW = "(max-width: 900px)";
/** At or under the width where a split board shows one half at a time. */
export const PHONE = "(max-width: 600px)";
