import { useEffect, useState } from 'react';
import { fetchQuestGuide, type QuestGuide as Guide } from '../lib/questGuide';

interface Props {
  title: string | null;
  wikiUrl?: string;
  accent?: string;
}

/**
 * The wiki's Guide section for the selected quest: quest items table, the
 * walkthrough text and the screenshots, rendered as the wiki lays them out.
 */
export default function QuestGuide({ title, wikiUrl, accent }: Props) {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!title) {
      setGuide(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setGuide(null);

    fetchQuestGuide(title)
      .then((result) => {
        if (cancelled) return;
        setGuide(result);
        if (!result) setError('This quest has no guide section on the wiki.');
      })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Switching quests quickly must not let an older fetch overwrite the newer.
    return () => { cancelled = true; };
  }, [title]);

  if (!title) return null;

  return (
    <div className="panel" style={accent ? { borderTopColor: accent, borderTopWidth: 3 } : undefined}>
      <div className="panel-head">
        <h2>{title} — guide</h2>
        {wikiUrl && <a href={wikiUrl} target="_blank" rel="noreferrer">open on wiki ↗</a>}
      </div>

      {loading && <p className="muted small">Loading guide from the wiki...</p>}
      {error && !loading && <p className="muted small">{error}</p>}

      {guide && (
        <>
          {guide.images > 0 && (
            <p className="muted small">{guide.images} image{guide.images === 1 ? '' : 's'} from the wiki.</p>
          )}
          <div className="wiki-guide" dangerouslySetInnerHTML={{ __html: guide.html }} />
        </>
      )}
    </div>
  );
}
