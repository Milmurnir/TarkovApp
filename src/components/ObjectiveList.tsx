import { groupByMap, tagObjectives } from '../lib/objectiveMaps';

interface Props {
  objectives: string[];
  /** Every map name, so the ones named in an objective can be picked out. */
  mapNames: string[];
  /** The map currently being looked at, whose objectives sort to the top. */
  currentMap: string | null;
}

/**
 * A quest's objectives, split by the map each one happens on.
 *
 * The flat list hides the shape of a quest like Chumming: three separate
 * stashes on three maps plus a kill objective, which reads as one errand until
 * you notice the map names buried mid-sentence.
 */
export default function ObjectiveList({ objectives, mapNames, currentMap }: Props) {
  if (objectives.length === 0) return null;

  const groups = groupByMap(tagObjectives(objectives, mapNames), currentMap);
  const elsewhere = groups.filter((g) => !g.here && g.map).length;

  return (
    <div className="objective-maps">
      {groups.map((group) => (
        <section key={group.map ?? 'anywhere'} className={group.here ? 'obj-group here' : 'obj-group'}>
          <h4>
            {group.map ?? 'Any map'}
            {group.here && <span className="tag">this map</span>}
            <span className="muted small"> · {group.lines.length} objective{group.lines.length === 1 ? '' : 's'}</span>
          </h4>
          <ul>
            {group.lines.map((line, i) => <li key={i}>{line.text}</li>)}
          </ul>
        </section>
      ))}

      {elsewhere > 0 && (
        <p className="muted small">
          {elsewhere === 1
            ? 'One other map is needed to finish this quest.'
            : `${elsewhere} other maps are needed to finish this quest.`}
        </p>
      )}
    </div>
  );
}
