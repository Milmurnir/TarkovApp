import { useState } from 'react';
import type { CoopRun } from '../lib/useCoopRun';

const STATUS_TEXT: Record<string, string> = {
  off: 'Not in a run',
  connecting: 'Connecting...',
  connected: 'Connected',
  reconnecting: 'Connection lost, retrying...',
  error: 'Problem',
};

/**
 * Starting or joining a shared run, and who is in it.
 *
 * A run is a code, not an account: one of you hosts, reads the code out, and
 * the other types it in. Anyone you have actually shared a run with is
 * remembered so the second time is one click.
 */
export default function CoopPanel({ run }: { run: CoopRun }) {
  const [entry, setEntry] = useState('');
  const [copied, setCopied] = useState(false);

  if (!run.configured) {
    return (
      <div className="panel">
        <h2>Co-op</h2>
        <p className="muted small">
          Running together needs a relay, and this build has none configured. See relay/README.md.
        </p>
      </div>
    );
  }

  async function copyCode() {
    if (!run.code) return;
    try {
      await navigator.clipboard.writeText(run.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the code is on screen to read anyway.
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Co-op</h2>
        <span className={`coop-status ${run.status}`}>{STATUS_TEXT[run.status] ?? run.status}</span>
      </div>

      <label className="coop-name">
        <span className="muted small">Your name</span>
        <input
          value={run.name}
          placeholder="What your friend should see"
          onChange={(event) => run.setName(event.target.value)}
        />
      </label>

      {run.code ? (
        <>
          <div className="coop-code">
            <span className="muted small">Run code</span>
            <strong>{run.code}</strong>
            <button onClick={copyCode}>{copied ? 'Copied' : 'Copy'}</button>
            <button onClick={run.leave}>Leave</button>
          </div>

          {run.statusDetail && <p className="error small">{run.statusDetail}</p>}

          <section className="section">
            <h3>In this run</h3>
            <ul className="coop-peers">
              <li>{run.name || 'You'} <span className="tag">you</span></li>
              {run.others.map((peer) => <li key={peer.id}>{peer.name || 'Unnamed player'}</li>)}
            </ul>
            {run.others.length === 0 && (
              <p className="muted small">
                Give your friend the code above. Everything you pick from here on shows up on
                their screen too.
              </p>
            )}
          </section>
        </>
      ) : (
        <>
          <p className="muted small">
            Share one run: the same map, quests, spawn and checklist on both screens.
          </p>

          <div className="coop-start">
            <button className="primary" onClick={() => run.host()}>Start a run</button>
            <span className="muted small">or</span>
            <input
              value={entry}
              placeholder="Run code"
              maxLength={8}
              onChange={(event) => setEntry(event.target.value.toUpperCase())}
              onKeyDown={(event) => { if (event.key === 'Enter') run.join(entry); }}
            />
            <button onClick={() => run.join(entry)} disabled={entry.trim().length < 4}>Join</button>
          </div>

          {run.statusDetail && <p className="error small">{run.statusDetail}</p>}

          {run.friends.length > 0 && (
            <section className="section">
              <h3>Friends</h3>
              <ul className="chosen">
                {run.friends.map((friend) => (
                  <li key={friend.id}>
                    <button className="chosen-name" onClick={() => run.join(friend.code)}>
                      {friend.name}
                      <span className="muted small"> · {friend.code}</span>
                    </button>
                    <button className="chosen-remove" onClick={() => run.forgetFriend(friend.id)} title="Forget">x</button>
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Rejoining uses the code you last shared. If they started a new run, ask for the new one.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
