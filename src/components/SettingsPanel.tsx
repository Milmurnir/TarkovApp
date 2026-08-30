import type { Settings } from '../lib/settings';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** App preferences. Currently just the map icon size; more belong here as they show up. */
export default function SettingsPanel({ settings, onChange }: Props) {
  return (
    <div className="panel">
      <h2>Settings</h2>

      <section className="section">
        <h3>Route icon size</h3>
        <label className="density-row">
          <input
            type="range"
            min={0.5}
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
    </div>
  );
}
