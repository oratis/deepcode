// MCP server manager — design-aligned per spec screen #15.
// List / show status of MCP servers wired in settings.json#mcpServers.

import { useEffect, useState } from 'react';
import { Badge, type BadgeKind } from '../components/Badge.js';
import { Card, Screen, SectionTitle } from '../components/Screen.js';

interface McpServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'disabled';
  toolCount?: number;
  error?: string;
}

const STATUS_BADGE: Record<McpServerStatus['status'], { kind: BadgeKind; label: string }> = {
  connected: { kind: 'ok', label: '● connected' },
  failed: { kind: 'err', label: '✕ failed' },
  disabled: { kind: 'warn', label: '○ configured' },
};

const EXAMPLE_JSON = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}`;

export function MCPManagerScreen(): JSX.Element {
  const [servers, setServers] = useState<McpServerStatus[] | null>(null);

  useEffect(() => {
    if (window.deepcode?.mcp?.list) {
      void window.deepcode.mcp
        .list()
        .then((rows) => setServers(rows as McpServerStatus[]))
        .catch(() => setServers([]));
    } else {
      setServers([]);
    }
  }, []);

  if (servers === null) {
    return (
      <Screen title="MCP servers">
        <div style={{ padding: 20, color: 'var(--text-2)' }}>Loading…</div>
      </Screen>
    );
  }

  return (
    <Screen
      title="MCP servers"
      subtitle={
        servers.length === 0 ? 'none configured' : `${servers.length} configured in settings.json`
      }
    >
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Card title={`Configured (${servers.length})`} flush padding={0}>
          {servers.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-3)',
                fontSize: 13,
              }}
            >
              No MCP servers configured.
              <div style={{ marginTop: 10, fontSize: 11 }}>
                Add the snippet below to <code>~/.deepcode/settings.json</code> and relaunch
                DeepCode.
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {servers.map((s, i) => {
                const badge = STATUS_BADGE[s.status];
                return (
                  <li
                    key={s.name}
                    style={{
                      padding: '14px 16px',
                      borderBottom:
                        i === servers.length - 1 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          color: 'var(--text-0)',
                          fontSize: 13,
                        }}
                      >
                        {s.name}
                      </span>
                      <Badge kind={badge.kind}>{badge.label}</Badge>
                      {s.toolCount !== undefined && s.status === 'connected' && (
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--text-2)',
                            marginLeft: 'auto',
                          }}
                        >
                          {s.toolCount} tools
                        </span>
                      )}
                    </div>
                    {s.error && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: 'var(--error)',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        {s.error}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Example settings snippet">
          <pre
            style={{
              background: 'var(--bg-0)',
              color: 'var(--text-1)',
              border: '1px solid var(--line-soft)',
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11.5,
              fontFamily: 'JetBrains Mono, monospace',
              margin: 0,
              overflowX: 'auto',
            }}
          >
            {EXAMPLE_JSON}
          </pre>
        </Card>

        <SectionTitle>About MCP</SectionTitle>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Model Context Protocol servers expose tools, resources, and prompts that DeepCode can
          route into via JSON-RPC. Failures show their stderr inline — most issues are a missing
          binary on $PATH or an arg typo.
        </div>
      </div>
    </Screen>
  );
}
