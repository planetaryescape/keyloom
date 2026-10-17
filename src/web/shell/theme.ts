import { useCallback, useState, useSyncExternalStore } from "react";
import { readStored, writeStored } from "./storage.ts";

export type ThemeChoice = "light" | "dark" | "auto";

const KEY = "keyloom.theme";
const CHOICES: readonly ThemeChoice[] = ["light", "dark", "auto"];

export function readTheme(): ThemeChoice {
  const stored = readStored(KEY);
  return CHOICES.find((choice) => choice === stored) ?? "auto";
}

// "auto" removes the attribute so tokens.css falls back to the operating system's preference.
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
    writeStored(KEY, next);
  }, []);
  return [choice, set];
}

/** The room the page is drawn in now: the chosen theme, or the operating system's when it is "auto". */
export function useRoom(): "light" | "dark" {
  const dark = useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia("(prefers-color-scheme: dark)");
      list.addEventListener("change", notify);
      // The theme switch writes the attribute on <html>; nothing else announces it.
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => {
        list.removeEventListener("change", notify);
        observer.disconnect();
      };
    },
    () => {
      const chosen = document.documentElement.getAttribute("data-theme");
      return chosen === "dark" || (chosen !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    },
    () => false,
  );
  return dark ? "dark" : "light";
}
