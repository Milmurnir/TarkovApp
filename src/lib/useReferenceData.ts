import { useEffect, useState } from 'react';
import { loadContainerNames } from './loot';
import { loadContainerLoot, type ContainerLoot } from './containerLoot';
import { loadFleaItems } from './priceCheck';

/** A JSON file shipped in public/data, or an empty object when it is missing. */
function useDataFile(path: string): Record<string, string> {
  const [data, setData] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch(path)
      .then((response) => (response.ok ? response.json() : {}))
      .then(setData)
      .catch(() => setData({}));
  }, [path]);
  return data;
}

/** Names and lookup tables that do not change with the map or the run. */
export function useReferenceData() {
  const [containerNames, setContainerNames] = useState<Record<string, string>>({});
  const [containerLoot, setContainerLoot] = useState<ContainerLoot>(
    { ids: [], names: [], containers: {}, chances: {} },
  );
  const shortNames = useDataFile('/data/item-shortnames.json');
  const itemNames = useDataFile('/data/loot-items.json');

  useEffect(() => { loadContainerNames().then(setContainerNames); }, []);
  useEffect(() => { loadContainerLoot().then(setContainerLoot); }, []);

  // Warms the price-check overlay's item cache so the first hotkey press mid-raid
  // is not the moment it starts an 18 MB fetch. Silent on failure: the overlay
  // retries this itself and reports the error there, where it is actually seen.
  useEffect(() => {
    loadFleaItems().catch(() => {});
  }, []);

  return { containerNames, containerLoot, shortNames, itemNames };
}
