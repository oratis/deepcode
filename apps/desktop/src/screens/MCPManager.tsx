// MCP server manager screen — list / connect / test MCP servers.
// Spec: docs/VISUAL_DESIGN.html screen #7
// Milestone: M6-rest

import { useEffect, useState } from 'react';

interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'disabled';
  toolCount?: number;
  error?: string;
}

export function MCPManagerScreen(): JSX.Element {
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);

  useEffect(() => {
    // Real impl: window.deepcode.mcp.list() — wired in M6-rest IPC PR.
    setServers([]);
  }, []);

  if (servers === null) {
    return <div className="p-8 text-muted">Loading MCP servers…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border p-3">
        <h2 className="font-semibold">MCP Servers</h2>
        <p className="mt-1 text-xs text-muted">
          Connected via settings.json &gt; <code>mcpServers</code>.{' '}
          {servers.length === 0
            ? 'None configured.'
            : `${servers.filter((s) => s.status === 'connected').length} of ${servers.length} connected.`}
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        {servers.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <p>No MCP servers configured.</p>
            <pre className="mx-auto mt-4 max-w-xl rounded bg-bg-elevated p-3 text-left text-xs">
              {`{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}`}
            </pre>
            <p className="mt-3 text-xs">
              Add the snippet above to your settings.json then relaunch.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {servers.map((s) => (
              <li key={s.name} className="rounded border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span
                    className={
                      s.status === 'connected'
                        ? 'text-accent'
                        : s.status === 'failed'
                          ? 'text-error'
                          : 'text-muted'
                    }
                  >
                    {s.status}
                    {s.toolCount !== undefined && s.status === 'connected'
                      ? ` · ${s.toolCount} tools`
                      : ''}
                  </span>
                </div>
                {s.error && (
                  <div className="mt-1 text-xs text-error">{s.error}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
