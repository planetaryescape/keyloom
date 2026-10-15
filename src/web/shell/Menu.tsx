import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface MenuProps {
  /** The button's visible content. */
  trigger: ReactNode;
  label: string;
  /** Called with a function that closes the menu, so an item can close it after acting. */
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  triggerClassName?: string;
}

// A button that opens a list of items (the ARIA menu button pattern): arrow keys move between
// items, Escape and an outside click close it, and focus goes back to the button. A native
// <select> can't group, style or hold a status line, which the layout and Build menus need.
export function Menu({ trigger, label, children, align = "start", triggerClassName = "button" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    // Opening puts focus on the chosen item, or the first.
    const items = root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    (root.current?.querySelector<HTMLElement>('[role^="menuitem"][aria-checked="true"]') ?? items?.[0])?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close(true);
      return;
    }
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === "ArrowDown" ? items[(at + 1) % items.length]
      : event.key === "ArrowUp" ? items[(at - 1 + items.length) % items.length]
      : event.key === "Home" ? items[0]
      : event.key === "End" ? items.at(-1)
      : undefined;
    if (target === undefined) return;
    event.preventDefault();
    target.focus();
  }

  return (
    <div className="menu" ref={root} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open ? (
        <div id={id} className="menu-list" role="menu" aria-label={label} data-align={align}>
          {children(() => close(true))}
        </div>
      ) : null}
    </div>
  );
}
