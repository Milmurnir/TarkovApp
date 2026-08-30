import type { Task, WikiQuest } from '../lib/types';

interface Props {
  wiki: WikiQuest | null;
  task: Task | null;
}

/**
 * Pre-raid prep only: what you must carry in or buy first.
 *
 * Keys come from tarkov.dev's `requiredKeys` when the API is reachable, since
 * that is exact, and fall back to the keys named on the wiki page otherwise.
 */
export default function RequirementsPanel({ wiki, task }: Props) {
  if (!wiki) return null;

  const apiKeys = (task?.objectives ?? [])
    .flatMap((o) => (o.requiredKeys ?? []).flat())
    .map((k) => k.name);

  const keys = Array.from(new Set(apiKeys.length > 0 ? apiKeys : wiki.keys));
  const keySource = apiKeys.length > 0 ? 'tarkov.dev' : 'wiki';

  const apiItems = (task?.objectives ?? [])
    .filter((o) => o.type === 'giveItem' || o.type === 'plantItem')
    .map((o) => ({ name: o.description, foundInRaid: Boolean(o.foundInRaid) }));

  const allItems = apiItems.length > 0 ? apiItems : wiki.itemsToBring;
  // Found-in-raid items aren't things to buy or pack — they only turn up mid-quest.
  const items = allItems.filter((item) => !item.foundInRaid);
  const foundInRaid = allItems.filter((item) => item.foundInRaid);

  const nothingToPrepare = keys.length === 0 && allItems.length === 0 && wiki.previous.length === 0;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{wiki.title}</h2>
        <a href={wiki.wikiUrl} target="_blank" rel="noreferrer">wiki ↗</a>
      </div>

      <dl className="facts">
        {wiki.trader && (<><dt>Trader</dt><dd>{wiki.trader}</dd></>)}
        {task?.minPlayerLevel ? (<><dt>Min level</dt><dd>{task.minPlayerLevel}</dd></>) : null}
      </dl>

      {keys.length > 0 && (
        <section className="section">
          <h3>Keys to bring</h3>
          <ul>{keys.map((key) => <li key={key}>{key}</li>)}</ul>
          {keySource === 'wiki' && (
            <p className="muted small">Read off the wiki page.</p>
          )}
        </section>
      )}

      {items.length > 0 && (
        <section className="section">
          <h3>Items to buy or bring</h3>
          <ul>{items.map((item) => <li key={item.name}>{item.name}</li>)}</ul>
        </section>
      )}

      {foundInRaid.length > 0 && (
        <section className="section">
          <h3>Found in raid</h3>
          <ul>{foundInRaid.map((item) => <li key={item.name}>{item.name}</li>)}</ul>
        </section>
      )}

      {wiki.previous.length > 0 && (
        <section className="section">
          <h3>Finish first</h3>
          <ul>{wiki.previous.map((quest) => <li key={quest}>{quest}</li>)}</ul>
        </section>
      )}

      {nothingToPrepare && (
        <p className="muted small">Nothing to prepare beforehand: no keys, no items to bring in.</p>
      )}
    </div>
  );
}
