import { useState } from 'react';

interface Props {
  /** Quests just added whose objectives are genuinely tied to more than one map. */
  entries: { title: string; maps: string[] }[];
  mapDisplayName: (normalizedName: string) => string;
  /** Called once with every title the player chose to include. */
  onSubmit: (confirmedTitles: string[]) => void;
}

/**
 * "This quest also needs {map}" -- batched rather than one modal per quest,
 * since adding several available quests at once would otherwise stack or
 * race a confirm dialog per pick.
 */
export default function MultiMapPrompt({ entries, mapDisplayName, onSubmit }: Props) {
  const [included, setIncluded] = useState<Record<string, boolean>>({});

  function submit() {
    onSubmit(entries.filter((entry) => included[entry.title]).map((entry) => entry.title));
  }

  return (
    <div className="modal-backdrop" onClick={() => onSubmit([])}>
      <div className="modal wide" onClick={(event) => event.stopPropagation()}>
        <h2>Multi-map quest{entries.length === 1 ? '' : 's'}</h2>

        <p className="small muted">
          These need a transit to another map partway through. Include the extra map(s) in this
          run if that is what you are doing now.
        </p>

        <ul className="finish-list">
          {entries.map((entry) => (
            <li key={entry.title}>
              <label className="finish-row">
                <input
                  type="checkbox"
                  checked={Boolean(included[entry.title])}
                  onChange={(event) =>
                    setIncluded((current) => ({ ...current, [entry.title]: event.target.checked }))}
                />
                <span>
                  <strong>{entry.title}</strong>
                  <span className="muted small"> — also needs {entry.maps.map(mapDisplayName).join(', ')}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button className="primary" onClick={submit}>Add selected legs</button>
          <button onClick={() => onSubmit([])}>Not this run</button>
        </div>
      </div>
    </div>
  );
}
