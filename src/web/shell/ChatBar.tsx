import { MessageSquare } from "lucide-react";

interface Props {
  open: boolean;
  onToggle: () => void;
}

// The one-line way into the chat (18): the chat itself opens in the side panel.
export function ChatBar({ open, onToggle }: Props) {
  return (
    <button type="button" className="chat-bar" aria-expanded={open} aria-controls="side-chat" onClick={onToggle}>
      <MessageSquare size={16} aria-hidden="true" />
      <span className="chat-bar-text">{open ? "Close the chat" : "Ask keyloom about your layout"}</span>
      <kbd>⌘K</kbd>
    </button>
  );
}
