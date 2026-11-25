interface Props {
  query: string;
  /** Typing resets the highlighted row, so the parent sets both. */
  onQuery: (query: string) => void;
  highlight: number;
  onHighlight: (index: number | ((current: number) => number)) => void;
  suggestions: string[];
  /** The same search across other maps, when this one finds nothing. */
  elsewhere: { title: string; map: string | null }[];
  onPick: (title: string) => void;
  onPickElsewhere: (match: { title: string; map: string | null }) => void;
  /** The current map's wiki name, for the placeholder and the "no match" line. */
  mapLabel: string;
  /** How many quests the list covers; zero while it is still loading. */
  questCount: number;
  indexProgress: { done: number; total: number } | null;
}

/** The quest search box, its suggestions, and the first-launch indexing bar. */
export default function QuestSearch({
  query, onQuery, highlight, onHighlight, suggestions, elsewhere, onPick, onPickElsewhere,
  mapLabel, questCount, indexProgress,
}: Props) {
  return (
    <>
      <input
        value={query}
        placeholder={
          indexProgress
            ? `Indexing quests ${indexProgress.done}/${indexProgress.total}...`
            : questCount
              ? `Add a ${mapLabel} quest...`
              : 'Loading quest list...'
        }
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && suggestions.length > 0) {
            e.preventDefault();
            onHighlight((h) => Math.min(suggestions.length - 1, h + 1));
          } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
            e.preventDefault();
            onHighlight((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter' && query.trim() && suggestions.length > 0) {
            e.preventDefault();
            onPick(suggestions[Math.min(highlight, suggestions.length - 1)]);
          } else if (e.key === 'Escape') {
            onQuery('');
          }
        }}
        autoFocus
      />
      {indexProgress && (
        <div className="index-progress">
          <div className="update-bar">
            <span style={{ width: `${indexProgress.total ? (100 * indexProgress.done) / indexProgress.total : 0}%` }} />
          </div>
          <p className="muted small">
            Reading {indexProgress.total} quests from the wiki to sort them by map
            ({indexProgress.done}/{indexProgress.total}). Only the first launch takes this long;
            until it finishes, search covers every map.
          </p>
        </div>
      )}
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((title, i) => (
            <li key={title} className={i === highlight ? 'active' : undefined}>
              <button onClick={() => onPick(title)} onMouseEnter={() => onHighlight(i)}>{title}</button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length > 1 && suggestions.length === 0 && questCount > 0 && (
        <div className="muted small">
          No {mapLabel} quest matches "{query.trim()}".
          {elsewhere.length > 0 && (
            <>
              {' '}On other maps:
              <ul className="suggestions">
                {elsewhere.map((match) => (
                  <li key={match.title}>
                    <button onClick={() => onPickElsewhere(match)}>
                      {match.title}
                      {match.map && <span className="muted small"> · switch to {match.map}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
