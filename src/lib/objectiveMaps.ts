/**
 * Which map each objective line belongs to.
 *
 * Read out of the wiki's own objective text rather than the API, because the
 * API's task data is incomplete for exactly the quests this matters for:
 * Chumming asks for four things across Interchange, Customs and Woods, and
 * json.tarkov.dev lists two of them. The wiki line already says "Stash 3 Golden
 * neck chains ... on Customs" — it just needs grouping so the trip you are on
 * is separable from the trips you are not.
 */

export interface ObjectiveLine {
  text: string;
  /** Wiki map names named in the line; empty when it names none. */
  maps: string[];
}

/**
 * Longest names first, so "Streets of Tarkov" is not matched as "Streets" and
 * "Ground Zero" is not missed inside a longer phrase.
 */
export function tagObjectives(objectives: string[], mapNames: string[]): ObjectiveLine[] {
  const ordered = [...mapNames].filter(Boolean).sort((a, b) => b.length - a.length);

  return objectives.map((raw) => {
    const text = raw.trim();
    const haystack = text.toLowerCase();
    const maps: string[] = [];

    for (const name of ordered) {
      const needle = name.toLowerCase();
      if (!haystack.includes(needle)) continue;
      // A shorter name inside one already matched is the same mention.
      if (maps.some((found) => found.toLowerCase().includes(needle))) continue;
      maps.push(name);
    }
    return { text, maps };
  });
}

/** Groups tagged lines by map, with the current map first and untagged last. */
export function groupByMap(
  lines: ObjectiveLine[],
  currentMap: string | null,
): { map: string | null; here: boolean; lines: ObjectiveLine[] }[] {
  const groups = new Map<string, ObjectiveLine[]>();
  const anywhere: ObjectiveLine[] = [];

  for (const line of lines) {
    if (line.maps.length === 0) {
      anywhere.push(line);
      continue;
    }
    // A line naming two maps belongs under both; you have to go to each.
    for (const map of line.maps) {
      const existing = groups.get(map);
      if (existing) existing.push(line);
      else groups.set(map, [line]);
    }
  }

  const result: { map: string | null; here: boolean; lines: ObjectiveLine[] }[] =
    Array.from(groups, ([map, mapLines]) => ({
      map,
      here: Boolean(currentMap) && map.toLowerCase() === currentMap!.toLowerCase(),
      lines: mapLines,
    }));

  result.sort((a, b) => {
    if (a.here !== b.here) return a.here ? -1 : 1;
    return (a.map ?? '').localeCompare(b.map ?? '');
  });

  if (anywhere.length > 0) result.push({ map: null, here: false, lines: anywhere });
  return result;
}
