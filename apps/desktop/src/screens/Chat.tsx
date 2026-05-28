// Legacy ChatScreen — kept for type-export symmetry only. The new shell
// renders ReplScreen directly. The xterm terminal side-pane lives here
// for now but isn't reachable from the active navigation; it'll move
// into the "+ menu" panel work in the next phase.

export function ChatScreen(): JSX.Element {
  return (
    <div
      style={{
        padding: 32,
        color: 'var(--text-2)',
        fontSize: 13,
      }}
    >
      <h2 style={{ color: 'var(--text-0)', margin: '0 0 12px' }}>Chat</h2>
      <p>
        The chat surface has moved into the main REPL. Click the ◐ icon in
        the right rail to go there.
      </p>
    </div>
  );
}
