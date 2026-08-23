/**
 * Stable per-quest colour, hashed from the quest name.
 *
 * The same quest always gets the same colour, in the map dots, the quest chips
 * and the requirements list, so a dot can be traced back to its quest at a
 * glance. Saturation and lightness are fixed so every colour stays legible on
 * the dark map and behind black marker text.
 */
export function questHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0; // keep it a 32-bit int
  }
  return Math.abs(hash) % 360;
}

/** Marker fill: bright enough to read black text on. */
export function questColor(name: string): string {
  return `hsl(${questHue(name)}, 75%, 62%)`;
}

/** Dimmer variant for borders and chips. */
export function questAccent(name: string): string {
  return `hsl(${questHue(name)}, 60%, 45%)`;
}
