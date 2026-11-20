import { useState, type ReactNode } from 'react';

interface Props {
  /** Shown in the always-visible header row. */
  title: string;
  /** Short status on the right of the header, e.g. "12 finished". */
  meta?: ReactNode;
  /** Remembers open/closed per fold on this machine. */
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

const PREFIX = 'tarkov-fold-v1:';

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

/**
 * A sidebar panel that can be folded away. The secondary panels (progress,
 * loot, co-op) are long, and with all of them open the controls you use
 * every raid -- map, spawn, quests -- were a scroll away from each other.
 *
 * The wrapped component still renders its own `.panel`; CSS flattens it into
 * this one and hides its duplicate heading.
 */
export default function Fold({ title, meta, storageKey, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try { localStorage.setItem(PREFIX + storageKey, next ? '1' : '0'); } catch { /* not remembered */ }
      return next;
    });
  }

  return (
    <div className={open ? 'panel fold open' : 'panel fold'}>
      <button className="fold-head" aria-expanded={open} onClick={toggle}>
        <span className="fold-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="fold-title">{title}</span>
        {meta !== undefined && <span className="muted small fold-meta">{meta}</span>}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}
