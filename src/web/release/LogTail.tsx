import { useEffect, useRef } from "react";

// A calm monospace window on the end of a log. It follows new lines, and takes a tab stop so a
// keyboard user can scroll back through it.
export function LogTail({ label, lines }: { label: string; lines: readonly string[] }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const element = box.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines.length]);
  return (
    <pre ref={box} className="log" tabIndex={0} aria-label={label}>
      {lines.length === 0 ? "Waiting for output" : lines.join("\n")}
    </pre>
  );
}
