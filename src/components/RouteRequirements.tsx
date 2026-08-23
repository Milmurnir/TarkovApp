import type { WikiQuest } from '../lib/types';

interface Props {
  quests: WikiQuest[];
  activeTitle: string | null;
  onSelect: (title: string) => void;
  /** Same colour the quest's dots use on the map. */
  colorOf: (title: string) => string;
}

interface Entry {
  label: string;
  quests: string[];
  foundInRaid?: boolean;
}

/** Merge one field across every selected quest, tracking who needs each thing. */
function merge(quests: WikiQuest[], pick: (q: WikiQuest) => { label: string; foundInRaid?: boolean }[]): Entry[] {
  const merged = new Map<string, Entry>();
  for (const quest of quests) {
    for (const { label, foundInRaid } of pick(quest)) {
      const existing = merged.get(label);
      if (existing) {
        if (!existing.quests.includes(quest.title)) existing.quests.push(quest.title);
        existing.foundInRaid = existing.foundInRaid || foundInRaid;
      } else {
        merged.set(label, { label, quests: [quest.title], foundInRaid });
      }
    }
  }
  return Array.from(merged.values());
}

/**
 * Everything the whole run needs, combined across every selected quest, so the
 * pre-raid checklist is one list rather than one per quest.
 */
export default function RouteRequirements({ quests, activeTitle, onSelect, colorOf }: Props) {
  if (quests.length === 0) return null;

  const keys = merge(quests, (q) => q.keys.map((label) => ({ label })));
  const items = merge(quests, (q) => q.itemsToBring.map((i) => ({ label: i.name, foundInRaid: i.foundInRaid })));

  const selectedTitles = new Set(quests.map((q) => q.title));
  const prerequisites = merge(quests, (q) => q.previous.map((label) => ({ label })))
    // A prerequisite you have already added to the run is not outstanding.
    .filter((entry) => !selectedTitles.has(entry.label));

  const nothing = keys.length === 0 && items.length === 0 && prerequisites.length === 0;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Run requirements</h2>
        <span className="muted small">
          {quests.length === 1 ? '1 quest' : `${quests.length} quests`}
        </span>
      </div>

      {nothing ? (
        <p className="muted small">Nothing to prepare: no keys, items or outstanding prerequisites.</p>
      ) : (
        <div className="req-grid">
          <Column title="Keys to bring" entries={keys} quests={quests} onSelect={onSelect} colorOf={colorOf} empty="No keys needed." />
          <Column title="Items to buy or bring" entries={items} quests={quests} onSelect={onSelect} colorOf={colorOf} empty="Nothing to bring in." />
          <Column title="Finish first" entries={prerequisites} quests={quests} onSelect={onSelect} colorOf={colorOf} empty="No outstanding prerequisites." />
        </div>
      )}

      <section className="section">
        <h3>Objectives by quest</h3>
        {quests.map((quest) => (
          <div
            key={quest.title}
            className={`quest-block ${activeTitle === quest.title ? 'active' : ''}`}
            style={{ borderLeftColor: colorOf(quest.title) }}
          >
            <button className="quest-block-title" onClick={() => onSelect(quest.title)}>
              {quest.title}
              {quest.trader && <span className="muted small"> · {quest.trader}</span>}
            </button>
            <ul>
              {quest.objectives.map((objective, i) => <li key={i}>{objective.trim()}</li>)}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function Column({ title, entries, quests, onSelect, empty, colorOf }: {
  title: string;
  entries: Entry[];
  quests: WikiQuest[];
  onSelect: (title: string) => void;
  empty: string;
  colorOf: (title: string) => string;
}) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.label}>
              {entry.label}
              {entry.foundInRaid && <span className="tag">found in raid</span>}
              {/* Only worth naming the quest when several are in the run. */}
              {quests.length > 1 && (
                <span className="req-for">
                  {entry.quests.map((title) => (
                    <button
                      key={title}
                      className="req-quest"
                      style={{ borderColor: colorOf(title) }}
                      onClick={() => onSelect(title)}
                    >
                      {title}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
