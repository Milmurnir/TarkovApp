import { useEffect, useState } from 'react';
import type { Settings } from '../lib/settings';
import { acceleratorFromEvent, formatAccelerator } from '../lib/hotkey';
import { priceCheckBridge, type HotkeyState } from '../lib/priceCheckBridge';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** App preferences. Currently the map icon size and the price-check hotkey; more belong here as they show up. */
export default function SettingsPanel({ settings, onChange }: Props) {
  return (
    <div className="panel">
      <h2>Settings</h2>

      <section className="section">
        <h3>Route icon size</h3>
        <label className="density-row">
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.1}
            value={settings.routeIconScale}
            onChange={(event) => onChange({ routeIconScale: Number(event.target.value) })}
          />
          <span className="small">{Math.round(settings.routeIconScale * 100)}%</span>
        </label>
        <p className="muted small">
          Sizes the spawn, objective, switch and extract markers on the map.
        </p>
      </section>

      <PriceCheckHotkeySection />
    </div>
  );
}

/**
 * Only renders once the Electron bridge answers, which is also how it stays
 * invisible in a plain browser tab (`npm run dev` outside the app shell) --
 * there is no global hotkey to manage there at all.
 */
function PriceCheckHotkeySection() {
  const [hotkey, setHotkeyState] = useState<HotkeyState | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    priceCheckBridge()?.getHotkey().then(setHotkeyState);
  }, []);

  useEffect(() => {
    if (!recording) return;

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      if (event.key === 'Escape') { setRecording(false); return; }

      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return; // no modifier yet, or an unsupported key -- keep listening

      setRecording(false);
      priceCheckBridge()?.setHotkey(accelerator).then((result) => {
        setHotkeyState(result);
        setError(result.ok && result.accelerator === accelerator
          ? null
          : `Could not use ${formatAccelerator(accelerator)} -- another app may already have it.`
            + (result.ok ? ` Kept ${formatAccelerator(result.accelerator)}.` : ''));
      });
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  if (!hotkey) return null;

  return (
    <section className="section">
      <h3>Price-check hotkey</h3>
      <p className="small">
        {recording ? (
          'Press a key combo (Esc to cancel)...'
        ) : (
          <>Hold <strong>{formatAccelerator(hotkey.accelerator)}</strong> and tap the last key twice.</>
        )}
        {!hotkey.ok && !recording && (
          <span className="error small"> · not active — another app may be using this combo</span>
        )}
      </p>
      <button onClick={() => { setError(null); setRecording(true); }} disabled={recording}>
        {recording ? 'Press keys...' : 'Change...'}
      </button>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
