import { useCallback, useEffect, useState } from 'react';
import {
  loadDurableProgress, loadProgress, onDurableSave, persistDurable, saveProgress, type Progress,
} from './progress';

/**
 * Quest progress, written through on every change so a crash loses nothing,
 * plus whether those writes are actually reaching the durable file.
 */
export function useProgress() {
  const [progress, setProgress] = useState<Progress>(() => loadProgress());

  const updateProgress = useCallback((next: Progress) => {
    setProgress(saveProgress(next));
  }, []);

  /** Same as updateProgress, but from whatever progress is current when it applies. */
  const changeProgress = useCallback((change: (current: Progress) => Progress) => {
    setProgress((current) => saveProgress(change(current)));
  }, []);

  // A fresh install has an empty localStorage but the user-data file is still
  // there, which is what makes progress outlive replacing the app.
  useEffect(() => {
    loadDurableProgress(progress).then((restored) => {
      // Written straight back out, so localStorage matches from here on and a
      // restore leaves a trace rather than being invisible.
      if (restored) setProgress(saveProgress(restored));
      // Otherwise the file may be the one that is behind: bring it up to date
      // now rather than leaving it stale until the next change.
      else if (progress.updatedAt > 0) persistDurable(progress);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Set when progress stops reaching the durable file, so it is seen rather than swallowed. */
  const [durableProblem, setDurableProblem] = useState<string | null>(null);
  useEffect(() => onDurableSave((state) => setDurableProblem(state && !state.ok ? state.reason : null)), []);

  return { progress, updateProgress, changeProgress, durableProblem };
}
