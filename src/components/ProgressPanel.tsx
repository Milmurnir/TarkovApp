import { useMemo, useState } from 'react';
import { missingPrerequisites, type Progress } from '../lib/progress';
import { searchQuests } from '../lib/wiki';

interface Props {
  progress: Progress;
  /** Every quest title, so catching up is not limited to this map. */
  questTitles: string[];
  /** Normalised quest name -> task id. */
  idByName: Record<string, string>;
  /** Task id -> the ids it requires. */
  requires: Record<string, string[]>;
  mapName: string;
  availableTitles: string[];
  hideFinished: boolean;
  onCatchUp: (ids: string[]) => void;
  /** Undo a single quest, for when a bulk guess got one wrong. */
  onUnmark: (id: string) => void;
  onAddAvailable: () => void;
  onHideFinished: (hide: boolean) => void;
  onSetLevel: (level: number | null) => void;
  onReset: () => void;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * What you have finished, tracked here rather than anywhere else.
 *
 * The part that makes this usable from a standing start is catching up: name
 * the last quest you actually did in a chain and everything behind it is marked
 * too. Ticking a few hundred boxes by hand is not a feature.
 */
export default function ProgressPanel({
  progress, questTitles, idByName, requires, mapName, availableTitles, hideFinished,
  onCatchUp, onUnmark, onAddAvailable, onHideFinished, onSetLevel, onReset,
}: Props) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const suggestions = useMemo(
    () => (query.trim().length > 1 ? searchQuests(questTitles, query).slice(0, 8) : []),
    [questTitles, query],
  );

  const pickedId = picked ? idByName[normalize(picked)] ?? null : null;
  const behind = useMemo(
    () => (pickedId ? missingPrerequisites(pickedId, requires, progress) : []),
    [pickedId, requires, progress],
  );
  const alreadyDone = pickedId ? progress.completed.has(pickedId) : false;

  function applyCatchUp(includeItself: boolean) {
    if (!pickedId) return;
    onCatchUp(includeItself ? [...behind, pickedId] : behind);
    setPicked(null);
    setQuery('');
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Your progress</h2>
        <span className="muted small">{progress.completed.size} finished</span>
      </div>

      <p className="muted small">
        Kept on this machine. No tool can read your Tarkov account — there is no public API for it.
      </p>

      <label className="level-row">
        <span className="muted small">Your level</span>
        <input
          type="number"
          min={1}
          max={79}
          value={progress.playerLevel ?? ''}
          placeholder="any"
          onChange={(event) => {
            const value = Number(event.target.value);
            onSetLevel(event.target.value === '' || Number.isNaN(value) ? null : value);
          }}
        />
      </label>

      <section className="section">
        <h3>Catch up</h3>
        <p className="muted small">
          Name a quest and everything before it in the chain is marked finished. Adding a quest to
          a run does this on its own.
        </p>
        <input
          value={query}
          placeholder="Search every quest..."
          onChange={(event) => { setQuery(event.target.value); setPicked(null); }}
        />

        {suggestions.length > 0 && !picked && (
          <ul className="suggestions">
            {suggestions.map((title) => (
              <li key={title}>
                <button onClick={() => { setPicked(title); setQuery(title); }}>{title}</button>
              </li>
            ))}
          </ul>
        )}

        {picked && (
          <div className="catch-up">
            {!pickedId ? (
              <p className="muted small">No task id for "{picked}", so it cannot be marked.</p>
            ) : (
              <>
                <p className="small">
                  {alreadyDone && <><strong>{picked}</strong> is marked finished. </>}
                  {behind.length > 0
                    ? <><strong>{behind.length}</strong> quest{behind.length === 1 ? '' : 's'} before it {behind.length === 1 ? 'is' : 'are'} not marked finished yet.</>
                    : <>Everything before it is already marked finished.</>}
                </p>
                <div className="catch-up-actions">
                  {/* The common case: you are partway through a chain, so what
                      came before is done and this one is not. */}
                  <button
                    className="primary"
                    onClick={() => applyCatchUp(false)}
                    disabled={behind.length === 0}
                  >
                    I am doing this now
                  </button>
                  <button onClick={() => applyCatchUp(true)} disabled={alreadyDone && behind.length === 0}>
                    I finished it too
                  </button>
                  {alreadyDone && (
                    <button
                      onClick={() => { onUnmark(pickedId); setPicked(null); setQuery(''); }}
                    >
                      Not finished after all
                    </button>
                  )}
                  <button onClick={() => { setPicked(null); setQuery(''); }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <button className="primary progress-add" onClick={onAddAvailable} disabled={availableTitles.length === 0}>
        {availableTitles.length === 0
          ? `Nothing available on ${mapName}`
          : `Add ${availableTitles.length} available quest${availableTitles.length === 1 ? '' : 's'}`}
      </button>
      <p className="muted small">
        Available means unfinished, prerequisites done{progress.playerLevel !== null && ' and your level is high enough'}.
      </p>

      <label className="toggle">
        <input type="checkbox" checked={hideFinished} onChange={(event) => onHideFinished(event.target.checked)} />
        Hide finished quests from the search
      </label>

      {progress.completed.size > 0 && (
        <div className="progress-reset">
          {confirmReset ? (
            <>
              <span className="small">Forget all {progress.completed.size}?</span>
              <button onClick={() => { onReset(); setConfirmReset(false); }}>Yes, reset</button>
              <button onClick={() => setConfirmReset(false)}>Keep</button>
            </>
          ) : (
            <button className="muted-button" onClick={() => setConfirmReset(true)}>Reset progress</button>
          )}
        </div>
      )}
    </div>
  );
}
