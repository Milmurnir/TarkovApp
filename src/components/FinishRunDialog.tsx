import { useMemo, useState } from 'react';
import { missingPrerequisites, type Progress } from '../lib/progress';

interface Props {
  /** Quests in the run, with the id a write needs; null when unknown. */
  entries: { title: string; taskId: string | null }[];
  progress: Progress;
  /** Task id -> the ids it requires, for walking a chain backwards. */
  requires: Record<string, string[]>;
  /** In a shared run the quest list is not cleared; it is not yours alone. */
  shared: boolean;
  onSubmit: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Closing out a run: which of these did you actually finish?
 *
 * Nothing is ticked by default. The app cannot see the game, so anything it
 * assumed here would be a guess written into your account.
 */
export default function FinishRunDialog({
  entries, progress, requires, shared, onSubmit, onClose,
}: Props) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [backfill, setBackfill] = useState<Record<string, boolean>>({});

  /** Prerequisites still outstanding for each quest, computed once. */
  const missingByTitle = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.taskId) continue;
      map.set(entry.title, missingPrerequisites(entry.taskId, requires, progress));
    }
    return map;
  }, [entries, requires, progress]);

  const ticked = entries.filter((entry) => done[entry.title] && entry.taskId);
  const extra = ticked.reduce(
    (total, entry) => total + (backfill[entry.title] ? (missingByTitle.get(entry.title)?.length ?? 0) : 0),
    0,
  );

  function submit() {
    const ids = new Set<string>();
    for (const entry of ticked) {
      ids.add(entry.taskId as string);
      if (backfill[entry.title]) {
        for (const id of missingByTitle.get(entry.title) ?? []) ids.add(id);
      }
    }
    onSubmit([...ids]);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(event) => event.stopPropagation()}>
        <h2>Finish this run</h2>

        <p className="small muted">
          Tick what you finished. Nothing is assumed — the app cannot see the game, only you know how
          the raid went.
          {shared && ' Only your own record changes, and the run stays up while your friend is in it.'}
        </p>

        <ul className="finish-list">
          {entries.map((entry) => {
            const missing = missingByTitle.get(entry.title) ?? [];
            const known = Boolean(entry.taskId);
            return (
              <li key={entry.title}>
                <label className="finish-row">
                  <input
                    type="checkbox"
                    disabled={!known}
                    checked={Boolean(done[entry.title])}
                    onChange={(event) =>
                      setDone((current) => ({ ...current, [entry.title]: event.target.checked }))}
                  />
                  <span>{entry.title}</span>
                  {!known && <span className="tag">unknown quest, cannot track</span>}
                </label>

                {/* Counting a late quest as done while its chain is not is a
                    state the game cannot produce, so offer to fix it here. */}
                {done[entry.title] && missing.length > 0 && (
                  <label className="finish-backfill">
                    <input
                      type="checkbox"
                      checked={Boolean(backfill[entry.title])}
                      onChange={(event) =>
                        setBackfill((current) => ({ ...current, [entry.title]: event.target.checked }))}
                    />
                    <span className="muted small">
                      also mark the {missing.length} earlier quest{missing.length === 1 ? '' : 's'} it
                      needed as finished
                    </span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>

        {ticked.length > 0 && (
          <p className="small">
            Marking <strong>{ticked.length + extra}</strong> quest{ticked.length + extra === 1 ? '' : 's'} as
            finished{extra > 0 && ` (${ticked.length} ticked, ${extra} earlier in their chains)`}.
          </p>
        )}

        <div className="modal-actions">
          <button className="primary" disabled={ticked.length === 0} onClick={submit}>
            Mark finished
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
