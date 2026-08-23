export interface Vec3 { x: number; y: number; z: number }

export interface MapSpawn {
  zoneName: string | null;
  position: Vec3;
  sides: string[] | null;
  categories: string[] | null;
}

export interface MapSwitch {
  id: string;
  name: string | null;
  switchType: string | null;
  position: Vec3 | null;
}

export interface MapExtract {
  id: string;
  name: string | null;
  /** Untranslated name, which matches the SPT extract list for joining. */
  rawName?: string | null;
  faction: string | null;
  position: Vec3 | null;
  /** Switches that must be flipped before this extract opens. */
  switches: MapSwitch[] | null;
}

export interface MapTransit {
  id: string;
  description: string | null;
  conditions: string | null;
  map: { normalizedName: string; name: string } | null;
  position: Vec3 | null;
}

export interface TaskZone {
  id: string;
  map: { normalizedName: string } | null;
  position: Vec3 | null;
}

export interface TaskObjective {
  id: string | null;
  type: string;
  description: string;
  optional: boolean;
  maps: { normalizedName: string; name: string }[];
  /** Only present on Basic/Item/Mark/QuestItem/Shoot/UseItem objective types. */
  zones?: TaskZone[] | null;
  /** Keys needed to reach this objective, grouped as alternatives. */
  requiredKeys?: { name: string; shortName: string | null }[][] | null;
  /** Item objectives only. */
  count?: number | null;
  foundInRaid?: boolean | null;
  /** Extract objectives: the specific exit the quest demands. */
  exitName?: string | null;
  /** Quest-item objectives carry their own coordinates. */
  possibleLocations?: { map: { normalizedName: string } | null; positions: Vec3[] }[] | null;
}

export interface Task {
  id: string | null;
  name: string;
  normalizedName: string;
  trader: { name: string } | null;
  map: { normalizedName: string; name: string } | null;
  minPlayerLevel: number | null;
  kappaRequired: boolean | null;
  wikiLink: string | null;
  experience: number | null;
  /** Quests that must be finished first, by tarkov.dev task id. */
  taskRequirements: { task: { id: string | null; name: string | null } | null; status: string[] }[];
  traderRequirements: { trader: { name: string } | null; value: number | null; requirementType: string | null }[];
  objectives: TaskObjective[];
}

/** Parsed straight from the fandom wiki page — the authoritative requirement text. */
export interface WikiQuest {
  title: string;
  trader: string | null;
  locations: string[];
  kappaRequired: string | null;
  previous: string[];
  leadsTo: string[];
  requirements: string[];
  objectives: string[];
  rewards: string[];
  /** Keys and keycards named on the quest page. */
  keys: string[];
  /** Items you need to bring into the raid or hand over afterwards. */
  itemsToBring: { name: string; foundInRaid: boolean }[];
  wikiUrl: string;
}

export interface RouteStop {
  order: number;
  label: string;
  description: string;
  position: Vec3;
  kind: 'spawn' | 'objective' | 'extract' | 'switch';
  legDistance: number;
  cumulativeDistance: number;
  optional: boolean;
  /** Keys needed for this specific stop, when known. */
  keys?: string[];
  /** Which quest this stop belongs to, when routing several at once. */
  questName?: string;
}

export interface Route {
  stops: RouteStop[];
  totalDistance: number;
  unmappedObjectives: TaskObjective[];
}
