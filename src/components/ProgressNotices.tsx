import type { useGameLogSync } from '../lib/useGameLogSync';

interface Props {
  /** Why progress is not reaching its save file, when it is not. */
  durableProblem: string | null;
  gameLogs: Pick<ReturnType<typeof useGameLogSync>, 'lastImport' | 'dismissImport' | 'wipePrompt' | 'resolveWipe'>;
  onShowLogDetails: () => void;
  /** The last automatic back-fill of prerequisites, while it can be undone. */
  backfill: { title: string; ids: string[] } | null;
  onUndoBackfill: () => void;
}

/** Changes made to your progress behind the scenes, each with a way to see or undo it. */
export default function ProgressNotices({
  durableProblem, gameLogs, onShowLogDetails, backfill, onUndoBackfill,
}: Props) {
  return (
    <>
      {durableProblem && (
        <p className="error small">
          Progress is not reaching its save file ({durableProblem}). It is still kept inside the
          app, but would not survive a reinstall — please report this.
        </p>
      )}

      {gameLogs.lastImport && (
        <p className="backfill-note small">
          Marked {gameLogs.lastImport.count} quest{gameLogs.lastImport.count === 1 ? '' : 's'} finished
          from the game's logs.{' '}
          <button className="muted-button" onClick={onShowLogDetails}>Details</button>
          {' · '}
          <button className="muted-button" onClick={gameLogs.dismissImport}>OK</button>
        </p>
      )}

      {gameLogs.wipePrompt && (
        <div className="catch-up">
          <p className="small">
            {gameLogs.wipePrompt.manual ? 'Counting quests from ' : 'The game logs show a wipe on '}
            <strong>{new Date(gameLogs.wipePrompt.at).toLocaleDateString()}</strong>.
            {' '}{gameLogs.wipePrompt.extra} quest{gameLogs.wipePrompt.extra === 1 ? ' is' : 's are'} marked
            finished here that the game has not seen you finish since.
          </p>
          <div className="catch-up-actions">
            <button className="primary" onClick={() => gameLogs.resolveWipe(true)}>Match the game</button>
            <button onClick={() => gameLogs.resolveWipe(false)}>Keep mine</button>
          </div>
        </div>
      )}

      {backfill && (
        <p className="backfill-note small">
          Marked the {backfill.ids.length} quest{backfill.ids.length === 1 ? '' : 's'} before{' '}
          {backfill.title} as finished.{' '}
          <button className="muted-button" onClick={onUndoBackfill}>Undo</button>
        </p>
      )}
    </>
  );
}
