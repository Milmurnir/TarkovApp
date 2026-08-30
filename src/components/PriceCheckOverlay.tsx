import { useEffect, useRef, useState } from 'react';
import {
  formatRUB, loadFleaItems, lowestPrice, onFleaItemsUpdated, searchFleaItems, type FleaItem,
} from '../lib/priceCheck';
import { priceCheckBridge } from '../lib/priceCheckBridge';

/**
 * The whole point of this window: hotkey down, type, read the price, hotkey
 * (or Esc) it away again. Every match already shows its own price inline, so
 * there is no second "selected item" screen to step through -- the list you
 * are typing into *is* the answer.
 */
export default function PriceCheckOverlay() {
  const [items, setItems] = useState<FleaItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function fetchItems() {
    loadFleaItems()
      .then((list) => { setItems(list); setLoadError(null); })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'Could not load item prices.'));
  }

  useEffect(() => { fetchItems(); }, []);

  // A price that moved while this list was already on screen should not wait
  // for the next lookup to show up -- flea offers turn over inside minutes.
  useEffect(() => onFleaItemsUpdated(setItems), []);

  // The window is reused rather than recreated on every hotkey press, so each
  // re-show has to explicitly clear the last query, grab focus again, and
  // re-check prices rather than trusting whatever was cached at launch.
  useEffect(() => {
    inputRef.current?.focus();
    return priceCheckBridge()?.onShow(() => {
      setQuery('');
      setHighlighted(0);
      inputRef.current?.focus();
      fetchItems();
    });
  }, []);

  const suggestions = items ? searchFleaItems(items, query) : [];

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      priceCheckBridge()?.hide();
      return;
    }
    if (suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    }
  }

  return (
    <div className="overlay" onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder="Search an item..."
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(0);
        }}
      />

      {!items && !loadError && <p className="muted small">Loading item prices...</p>}
      {loadError && <p className="error small">{loadError}</p>}

      {suggestions.length > 0 && (
        <ul className="suggestions overlay-suggestions">
          {suggestions.map((item, i) => {
            const lowest = lowestPrice(item);
            const slots = item.width * item.height;
            const details = lowest
              ? [
                  lowest.label,
                  item.avg24h !== null ? `24h avg ${formatRUB(item.avg24h)}` : null,
                  slots > 1 ? `${formatRUB(lowest.value / slots)} per slot` : null,
                ].filter(Boolean).join(' · ')
              : item.bestTraderRUB !== null
                ? `Not sellable on the Flea Market · up to ${formatRUB(item.bestTraderRUB)} to a trader`
                : 'Not sellable on the Flea Market';

            return (
              <li key={item.id} className={i === highlighted ? 'active' : undefined}>
                <button title={details} onMouseEnter={() => setHighlighted(i)}>
                  {item.icon && (
                    <img
                      src={item.icon}
                      alt=""
                      width={22}
                      height={22}
                      onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                    />
                  )}
                  <span className="suggestion-name">
                    {item.name}
                    {item.short !== item.name && <span className="muted small"> ({item.short})</span>}
                  </span>
                  <span className="suggestion-price">
                    {lowest ? formatRUB(lowest.value) : <span className="muted">no flea</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
