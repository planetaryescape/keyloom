// Copy that names a place in the app ("in Settings", "ask the chat") makes it a link that goes there (R1-23). The place's owner is
// the Viewer, several components above the copy, so a link dispatches this event and the Viewer opens the place, as it does for the
// agent's view requests.
export type Place = "settings" | "chat";

const EVENT = "keyloom:open-place";

export function openPlace(place: Place): void {
  window.dispatchEvent(new CustomEvent<Place>(EVENT, { detail: place }));
}

/** Subscribes the Viewer; returns the unsubscribe. */
export function onOpenPlace(open: (place: Place) => void): () => void {
  const listener = (event: Event) => {
    const place = (event as CustomEvent<unknown>).detail;
    if (place === "settings" || place === "chat") open(place);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
