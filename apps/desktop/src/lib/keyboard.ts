// Global keyboard shortcut helper.
// React per-component listeners would have to all coordinate; instead we
// expose a single function that hooks the window once at App-mount and
// dispatches by chord. Chords use lowercase letters with modifiers
// prefixed: 'meta+n', 'meta+,', 'meta+.', 'meta+\\'.

type Handler = (e: KeyboardEvent) => void;

const handlers = new Map<string, Handler>();

function eventChord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push('meta');
  if (e.ctrlKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    const chord = eventChord(e);
    const h = handlers.get(chord);
    if (h) {
      // Don't preempt the target — composer textarea handles its own keys.
      // We only fire global shortcuts when the event target isn't a focused
      // input that wants the key. ⌘+letter is rarely consumed by inputs
      // (browsers route them out), so a simple metaKey gate is enough.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        h(e);
      }
    }
  });
}

/** Register a keyboard shortcut. Returns an unbind function. */
export function registerShortcut(chord: string, handler: Handler): () => void {
  install();
  handlers.set(chord, handler);
  return () => {
    if (handlers.get(chord) === handler) handlers.delete(chord);
  };
}
