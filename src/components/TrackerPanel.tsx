import { useState } from 'react';
import type { TrackerProgress } from '../lib/tracker';

interface Props {
  progress: TrackerProgress | null;
  token: string;
  loading: boolean;
  error: string | null;
  mapName: string;
  /** Quests on this map you could start right now, already filtered. */
  availableTitles: string[];
  hideFinished: boolean;
  onConnect: (token: string) => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onAddAvailable: () => void;
  onHideFinished: (hide: boolean) => void;
}

/**
 * Pulling your quest progress in from TarkovTracker.
 *
 * Worth being straight about what this is: your ticked-off list on
 * TarkovTracker, not your account in the game. There is no public API for the
 * latter, and anything claiming otherwise wants your BSG login.
 */
export default function TrackerPanel({
  progress, token, loading, error, mapName, availableTitles, hideFinished,
  onConnect, onDisconnect, onRefresh, onAddAvailable, onHideFinished,
}: Props) {
  const [entry, setEntry] = useState('');

  if (!progress) {
    return (
      <div className="panel">
        <h2>Your progress</h2>
        <p className="muted small">
          Import what you have ticked off on{' '}
          <a href="https://tarkovtracker.io" target="_blank" rel="noreferrer">TarkovTracker</a>{' '}
          to skip finished quests and add the ones you can actually start.
        </p>
        <p className="muted small">
          Settings → API tokens on TarkovTracker. The token stays on this machine and is only
          ever sent to tarkovtracker.io.
        </p>

        <div className="tracker-connect">
          <input
            type="password"
            value={entry}
            placeholder="API token"
            onChange={(event) => setEntry(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onConnect(entry); }}
          />
          <button className="primary" onClick={() => onConnect(entry)} disabled={loading || entry.trim().length === 0}>
            {loading ? 'Checking...' : 'Connect'}
          </button>
        </div>

        {error && <p className="error small">{error}</p>}
        {token && !error && <p className="muted small">Saved token could not be loaded.</p>}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Your progress</h2>
        <span className="muted small">
          {progress.displayName ?? 'Connected'}
          {progress.playerLevel !== null && ` · level ${progress.playerLevel}`}
        </span>
      </div>

      <p className="muted small">
        {progress.completed.size} quests finished
        {progress.failed.size > 0 && `, ${progress.failed.size} failed`}, as ticked off on
        TarkovTracker. It does not read the game itself.
      </p>

      <button
        className="primary tracker-add"
        onClick={onAddAvailable}
        disabled={availableTitles.length === 0}
      >
        {availableTitles.length === 0
          ? `Nothing available on ${mapName}`
          : `Add ${availableTitles.length} available quest${availableTitles.length === 1 ? '' : 's'}`}
      </button>
      <p className="muted small">
        Available means unfinished, prerequisites done and your level is high enough.
      </p>

      <label className="toggle">
        <input type="checkbox" checked={hideFinished} onChange={(event) => onHideFinished(event.target.checked)} />
        Hide finished quests from the search
      </label>

      {error && <p className="error small">{error}</p>}

      <div className="tracker-actions">
        <button onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        <button onClick={onDisconnect}>Disconnect</button>
      </div>
    </div>
  );
}
