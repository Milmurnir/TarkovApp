import { useEffect, useState } from 'react';
import type { Settings } from '../lib/settings';
import { acceleratorFromEvent, formatAccelerator } from '../lib/hotkey';
import { priceCheckBridge, type HotkeyState } from '../lib/priceCheckBridge';
import type { GameLogSync } from '../lib/useGameLogSync';
import { clearGameDataCaches } from '../lib/cache';

/** "2026-08-01" for a date input, from ms since epoch, in local time. */
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Reading progress from the game's logs. Explains itself in the two cases where
 * it cannot run -- a plain browser, and a desktop shell from before this
 * existed, which only a new installer fixes.
 */
function GameLogsSection({ settings, onChange, gameLogs }: Props) {
  const [folderError, setFolderError] = useState<string | null>(null);

  if (!gameLogs.available) {
    return (
      <section className="section">
        <h3>Progress from the game</h3>
        <p className="muted small">
          The desktop app can read your finished quests from Tarkov's own log files. This needs the
          latest installer — the in-app update cannot add it.
        </p>
      </section>
    );
  }

  const { scan } = gameLogs;

  return (
    <section className="section">
      <h3>Progress from the game</h3>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.gameLogSync}
          onChange={(event) => onChange({ gameLogSync: event.target.checked })}
        />
        Read finished quests from Tarkov's log files
      </label>
      <p className="muted small">
        Only reads the text logs the game writes for itself — nothing touches the game while it
        runs. Quests you turn in are ticked off here within a few seconds.
      </p>

      {settings.gameLogSync && (
        <>
          {gameLogs.scanning && <p className="small muted">Reading logs...</p>}
          {!gameLogs.scanning && scan && !scan.ok && (
            <p className="small error">Could not find the game's Logs folder. Choose it below.</p>
          )}
          {!gameLogs.scanning && scan?.ok && (
            <dl className="facts">
              <dt>Folder</dt>
              <dd className="small" title={scan.dir ?? ''}>{scan.dir}</dd>
              <dt>Sessions</dt>
              <dd>
                {scan.sessions}
                {scan.firstSession ? ` since ${new Date(scan.firstSession).toLocaleDateString()}` : ''}
              </dd>
              <dt>Last wipe</dt>
              <dd>
                {gameLogs.detectedWipe
                  ? new Date(gameLogs.detectedWipe).toLocaleDateString()
                  : 'none in these logs'}
              </dd>
              <dt>Finished</dt>
              <dd>{gameLogs.finishedInLogs} quests this wipe</dd>
            </dl>
          )}

          <label className="level-row">
            <span className="muted small">Count quests since</span>
            <input
              type="date"
              value={settings.gameLogSince ?? ''}
              max={toDateInput(Date.now())}
              onChange={(event) => onChange({ gameLogSince: event.target.value || null })}
            />
            {settings.gameLogSince && (
              <button className="muted-button" onClick={() => onChange({ gameLogSince: null })}>Auto</button>
            )}
          </label>
          <p className="muted small">
            {settings.gameLogSince
              ? 'Using your date instead of the wipe found in the logs.'
              : 'Worked out from the logs. After a prestige, set it to that day to start over.'}
          </p>

          {gameLogs.wipePrompt && (
            <div className="catch-up">
              <p className="small">
                {gameLogs.wipePrompt.extra} quest{gameLogs.wipePrompt.extra === 1 ? ' is' : 's are'} marked
                finished here that the game has not seen you finish since{' '}
                {new Date(gameLogs.wipePrompt.at).toLocaleDateString()}.
              </p>
              <div className="catch-up-actions">
                <button className="primary" onClick={() => gameLogs.resolveWipe(true)}>Match the game</button>
                <button onClick={() => gameLogs.resolveWipe(false)}>Keep mine</button>
              </div>
            </div>
          )}

          <div className="share-actions">
            <button onClick={gameLogs.syncNow} disabled={gameLogs.scanning}>Sync now</button>
            <button
              onClick={async () => {
                setFolderError(null);
                const problem = await gameLogs.pickFolder();
                if (problem === 'not-logs') setFolderError('That folder has no Tarkov logs in it.');
              }}
            >
              Choose folder...
            </button>
          </div>
          {folderError && <p className="error small">{folderError}</p>}
        </>
      )}
    </section>
  );
}

/**
 * Quest lists, pages and map data refresh on their own every few days. This is
 * for right after a patch, when waiting is not an option.
 */
function GameDataSection() {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <section className="section">
      <h3>Game data</h3>
      <p className="muted small">
        Quests and wiki guides refresh every few days, map data daily. After a patch, refresh now
        to pick up new or changed quests. Your progress and current run are kept.
      </p>
      <button
        disabled={refreshing}
        onClick={() => {
          setRefreshing(true);
          clearGameDataCaches();
          window.location.reload();
        }}
      >
        {refreshing ? 'Refreshing...' : 'Refresh game data'}
      </button>
    </section>
  );
}

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  gameLogs: GameLogSync;
}

/** App preferences: game-log sync, map icon size, the price-check hotkey, and the rest as they show up. */
export default function SettingsPanel({ settings, onChange, gameLogs }: Props) {
  return (
    <div className="panel">
      <h2>Settings</h2>

      <GameLogsSection settings={settings} onChange={onChange} gameLogs={gameLogs} />

      <section className="section">
        <h3>Route icon size</h3>
        <label className="density-row">
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.1}
            value={settings.routeIconScale}
            onChange={(event) => onChange({ routeIconScale: Number(event.target.value) })}
          />
          <span className="small">{Math.round(settings.routeIconScale * 100)}%</span>
        </label>
        <p className="muted small">
          Sizes the spawn, objective, switch and extract markers on the map.
        </p>
      </section>

      <PriceCheckHotkeySection />

      <section className="section">
        <h3>Keyboard</h3>
        <p className="muted small">
          ← / → step through the route's stops while you are not typing in a field.
          In the quest search, ↑ / ↓ pick a match and Enter adds it.
        </p>
      </section>

      <GameDataSection />

      <section className="section">
        <h3>About</h3>
        <p className="muted small">
          Quests from the EFT wiki · objective coordinates from json.tarkov.dev · spawns from SPT.
        </p>
      </section>
    </div>
  );
}

/**
 * Only renders once the Electron bridge answers, which is also how it stays
 * invisible in a plain browser tab (`npm run dev` outside the app shell) --
 * there is no global hotkey to manage there at all.
 */
function PriceCheckHotkeySection() {
  const [hotkey, setHotkeyState] = useState<HotkeyState | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    priceCheckBridge()?.getHotkey().then(setHotkeyState);
  }, []);

  useEffect(() => {
    if (!recording) return;

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      if (event.key === 'Escape') { setRecording(false); return; }

      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return; // no modifier yet, or an unsupported key -- keep listening

      setRecording(false);
      priceCheckBridge()?.setHotkey(accelerator).then((result) => {
        setHotkeyState(result);
        setError(result.ok && result.accelerator === accelerator
          ? null
          : `Could not use ${formatAccelerator(accelerator)} -- another app may already have it.`
            + (result.ok ? ` Kept ${formatAccelerator(result.accelerator)}.` : ''));
      });
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  if (!hotkey) return null;

  return (
    <section className="section">
      <h3>Price-check hotkey</h3>
      <p className="small">
        {recording ? (
          'Press a key combo (Esc to cancel)...'
        ) : (
          <>Hold <strong>{formatAccelerator(hotkey.accelerator)}</strong> and tap the last key twice.</>
        )}
        {!hotkey.ok && !recording && (
          <span className="error small"> · not active — another app may be using this combo</span>
        )}
      </p>
      <p className="muted small">
        While the app runs, Windows hands every {formatAccelerator(hotkey.accelerator)} press to it, even a
        single one, so that combo stops working in the game and other apps. Pick one you never use.
      </p>
      <button onClick={() => { setError(null); setRecording(true); }} disabled={recording}>
        {recording ? 'Press keys...' : 'Change...'}
      </button>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
