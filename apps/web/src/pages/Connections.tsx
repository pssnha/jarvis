import { useCallback, useEffect, useState } from 'react';
import { createToken, listTokens, revokeToken } from '../lib/api';
import type { AccessToken } from '../lib/types';

const ERRORS: Record<string, string> = {
  name_required: 'Name is required.',
  name_too_long: 'Name is too long.',
  not_found: 'Token not found.',
};

const MCP_URL = `${window.location.origin}/api/mcp`;

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
}

/** Personal access tokens for MCP clients (e.g. a Meta Muse custom connector). */
export function Connections() {
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => {
    const msg = String((e as Error).message ?? e);
    setError(ERRORS[msg] ?? msg);
  };

  const load = useCallback(() => {
    listTokens().then(setTokens).catch(onError);
  }, []);
  useEffect(load, [load]);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch (e) {
      onError(e);
    }
  }
  async function add() {
    if (!name.trim()) return;
    setError(null);
    try {
      const t = await createToken(name.trim());
      setCreated({ name: t.name, token: t.token });
      setName('');
      load();
    } catch (e) {
      onError(e);
    }
  }
  async function remove(t: AccessToken) {
    if (!confirm(`Revoke "${t.name}"?`)) return;
    try {
      await revokeToken(t.id);
      load();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div className="permissions">
      <div className="vac-toolbar">
        <h2>Connections</h2>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="perm-table conn-table">
        <div className="perm-head">
          <span>MCP Server URL</span>
          <span />
        </div>
        <div className="perm-row">
          <input readOnly value={MCP_URL} onFocus={(e) => e.target.select()} />
          <span className="perm-actions">
            <button className="btn-quiet" onClick={() => copy(MCP_URL)}>
              {copied === MCP_URL ? 'Copied' : 'Copy'}
            </button>
          </span>
        </div>
      </div>

      {created && (
        <div className="perm-table conn-table conn-new">
          <div className="perm-head">
            <span>New Token: {created.name}</span>
            <span />
          </div>
          <div className="perm-row">
            <input readOnly value={created.token} onFocus={(e) => e.target.select()} />
            <span className="perm-actions">
              <button className="btn-quiet" onClick={() => copy(created.token)}>
                {copied === created.token ? 'Copied' : 'Copy'}
              </button>
              <button className="btn-quiet" onClick={() => setCreated(null)}>
                Done
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="perm-table token-table">
        <div className="perm-head">
          <span>Token</span>
          <span>Created</span>
          <span>Last Used</span>
          <span />
        </div>
        {tokens.map((t) => (
          <div key={t.id} className="perm-row">
            <span className="perm-name">{t.name}</span>
            <span className="perm-cell">{fmt(t.createdAt)}</span>
            <span className="perm-cell">{fmt(t.lastUsedAt)}</span>
            <span className="perm-actions">
              <button className="btn-quiet" onClick={() => remove(t)}>
                Revoke
              </button>
            </span>
          </div>
        ))}
        <div className="perm-row add">
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <span />
          <span />
          <span className="perm-actions">
            <button className="btn-quiet" onClick={add}>
              Create
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
