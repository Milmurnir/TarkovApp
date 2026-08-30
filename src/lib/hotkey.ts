/** Turns a keyboard event into the accelerator string Electron's globalShortcut expects. */

/** Physical-key code -> the name Electron's accelerator syntax expects. */
function acceleratorKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return null;
}

/**
 * Reads a combo out of a keydown event, or null while it is not yet one worth
 * accepting -- no modifier held yet, or a key (Tab, Escape, a bare letter)
 * that is not meant to be captured on its own.
 */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const key = acceleratorKey(event.code);
  if (!key) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  // A bare letter would fire on every keystroke everywhere else in the app;
  // the hotkey needs at least one modifier to be worth binding globally.
  if (modifiers.length === 0) return null;

  return [...modifiers, key].join('+');
}

/** "Control+G" -> "Ctrl+G", the form shown in Settings and the tray menu. */
export function formatAccelerator(accelerator: string): string {
  return accelerator.replace(/\bControl\b/g, 'Ctrl').replace(/\bSuper\b/g, 'Win');
}
