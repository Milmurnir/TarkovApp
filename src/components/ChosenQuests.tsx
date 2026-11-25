import type { TaskStanding } from '../lib/progress';

/** The marks beside a picked quest; the hover text is the explanation. */
const STATUS_ICONS: Record<Exclude<TaskStanding, 'available'>, { icon: string; tone: string; hint: string }> = {
  completed: { icon: '✓', tone: 'done', hint: 'Done: already marked finished in your progress' },
  locked: { icon: '⊘', tone: 'warn', hint: 'Locked: a prerequisite quest is not finished yet' },
  'not-given': {
    icon: '✉',
    tone: 'quiet',
    hint: "Not given: unlocks through a trader conversation or story progress, and the game's logs show it has not been given to you yet",
  },
  'trader-locked': { icon: '₽', tone: 'warn', hint: 'Your trader settings rule this quest out' },
  'too-low-level': { icon: 'Lv', tone: 'warn', hint: "Level: yours (set under Your progress) is below this quest's requirement" },
};
const NO_COORDS_HINT = 'No coordinates: nothing published for this map, so it is not drawn';

interface Props {
  titles: string[];
  active: string | null;
  onFocus: (title: string) => void;
  onRemove: (title: string) => void;
  accentOf: (title: string) => string;
  standingOf: (title: string) => TaskStanding;
  /** Why a trader rules this quest out, for the ₽ mark's hover text. */
  traderReason: (title: string) => string | null;
  /** Quests with no published coordinates on this map. */
  unroutable: string[];
}

/** The quests picked for this run, each with its standing and a remove button. */
export default function ChosenQuests({
  titles, active, onFocus, onRemove, accentOf, standingOf, traderReason, unroutable,
}: Props) {
  if (titles.length === 0) return null;
  return (
    <ul className="chosen">
      {titles.map((title) => {
        // Adding something you have already done, or cannot start yet, is
        // worth saying rather than silently routing it. Icons rather than
        // words, so a long name keeps its row.
        const standing = standingOf(title);
        const status = standing === 'available' ? null : {
          ...STATUS_ICONS[standing],
          hint: (standing === 'trader-locked' && traderReason(title)) || STATUS_ICONS[standing].hint,
        };
        return (
          <li
            key={title}
            className={active === title ? 'active' : ''}
            style={{ borderLeft: `4px solid ${accentOf(title)}` }}
          >
            <button className="chosen-name" onClick={() => onFocus(title)}>{title}</button>
            {status && (
              <span role="img" className={`status-icon ${status.tone}`} title={status.hint} aria-label={status.hint}>
                {status.icon}
              </span>
            )}
            {unroutable.includes(title) && (
              <span role="img" className="status-icon quiet" title={NO_COORDS_HINT} aria-label={NO_COORDS_HINT}>⌖</span>
            )}
            <button
              className="chosen-remove"
              onClick={() => onRemove(title)}
              title={`Remove ${title}`}
              aria-label={`Remove ${title}`}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
