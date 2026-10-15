import { useCallback, useState } from "react";
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
