export type Sidebar = "chat" | "repeat" | "combos" | "history" | "library" | "settings" | "lab" | "proposals" | "review";

/** Closing a displaced panel must not close the one that replaced it. */
export function sidebarAfterUpdate(current: Sidebar | null, target: Sidebar, open: boolean): Sidebar | null {
  return open ? target : current === target ? null : current;
}
