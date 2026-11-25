/**
 * The relay's merge rule, apart from the Durable Object so it can be tested.
 *
 * Last write wins, ties broken by peer id -- the same rule the app applies --
 * with one addition: a write stamped in the future is pulled back to the
 * relay's own clock. Without that, a player whose PC clock runs ten minutes
 * fast wins every conflict for ten minutes, including against changes the
 * other player makes long after theirs.
 *
 * The relay cannot fix a clock that runs slow (it has no way to tell a late
 * write from an old one being resent after a reconnect), so this only bounds
 * the damage in one direction.
 */

/** Allowed lead over the relay's clock: ordinary drift and network delay. */
export const MAX_CLOCK_LEAD_MS = 2000;

/**
 * Applies `incoming` to `fields` in place. Returns the fields that won, and
 * the subset of those whose time was pulled back -- the sender has to hear
 * about those, or it keeps its own future stamp and rejects every later
 * change to that field.
 */
export function mergeIncoming(fields, incoming, now, maxFields) {
  const accepted = {};
  const restamped = {};
  if (!incoming || typeof incoming !== 'object') return { accepted, restamped };

  const ceiling = now + MAX_CLOCK_LEAD_MS;

  for (const [path, field] of Object.entries(incoming)) {
    if (typeof path !== 'string' || path.length > 200) continue;
    if (!field || typeof field !== 'object' || typeof field.at !== 'number' || !Number.isFinite(field.at)) continue;
    if (!(path in fields) && Object.keys(fields).length >= maxFields) continue;

    const by = String(field.by ?? '');
    const at = field.at > ceiling ? now : field.at;

    const current = fields[path];
    const wins = !current || at > current.at || (at === current.at && by > String(current.by));
    if (!wins) continue;

    fields[path] = { value: field.value, at, by };
    accepted[path] = fields[path];
    if (at !== field.at) restamped[path] = fields[path];
  }
  return { accepted, restamped };
}
