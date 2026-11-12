// The line beside a config dialog's action while it waits for something to be filled in (R6-24): the action is off, and this says why.

/** Rename waits for a name, and for one that isn't the config's name now. */
export function renameWaits(name: string, current: string): string | null {
  const typed = name.trim();
  if (typed === "") return "Type a name to rename it.";
  if (typed === current) return "Type the new name to rename it.";
  return null;
}

/** New config waits for a name, and for a version when it starts from one. Starting from a file asks for neither here. */
export function newConfigWaits(start: "copy" | "version" | "blank" | "file", name: string, version: string): string | null {
  if (start === "file") return null;
  if (name.trim() === "") return "Type a name for the new config.";
  if (start === "version" && version === "") return "Pick the version to start from.";
  return null;
}
