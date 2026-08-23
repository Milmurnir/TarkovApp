"""Generate per-map data for the quest router.

Pulls from three public sources and writes one JSON per map into public/data/,
plus the map SVG into public/maps/:

  - the-hideout/tarkov-dev  src/data/maps.json  -> bounds, transform, rotation,
    SVG url, positioned street labels
  - assets.tarkov.dev                           -> the map SVG itself
  - sp-tarkov/server-csharp                     -> PMC spawn points (with
    coordinates) and the extract list

Projection
----------
tarkov.dev renders with Leaflet. Working their chain through for a game point
(x, z) with rotation r and transform [a, b, c, d]:

    lng, lat = x, z
    x' = lng*cos(r) - lat*sin(r)
    y' = lng*sin(r) + lat*cos(r)
    px = a*x' + b
    py = -c*y' + d          (Leaflet scaleY is transform[2] * -1)

The SVG is stretched across the pixel rect of the two `bounds` corners, so
normalising a point against that rect gives its position in the viewBox.

The two bounds numbers could be read as (x, z) or (z, x). Rather than assume,
both are tried and the one that actually contains the map's real spawn points
is kept -- and if neither does, the map is reported instead of silently written.
"""

import json
import math
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'public', 'data')
MAPS_DIR = os.path.join(ROOT, 'public', 'maps')

MAPS_JSON = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'
SPT_BASE = ('https://raw.githubusercontent.com/sp-tarkov/server-csharp/main/'
            'Libraries/SPTarkov.Server.Assets/SPT_Data/database/locations')

# tarkov.dev normalizedName -> (SPT folder, wiki location name)
MAP_SOURCES = {
    'streets-of-tarkov': ('tarkovstreets', 'Streets of Tarkov'),
    'customs':           ('bigmap',        'Customs'),
    'woods':             ('woods',         'Woods'),
    'factory':           ('factory4_day',  'Factory'),
    'interchange':       ('interchange',   'Interchange'),
    'shoreline':         ('shoreline',     'Shoreline'),
    'reserve':           ('rezervbase',    'Reserve'),
    'lighthouse':        ('lighthouse',    'Lighthouse'),
    'ground-zero':       ('sandbox',       'Ground Zero'),
    'the-lab':           ('laboratory',    'The Lab'),
}


def get(url, binary=False):
    request = urllib.request.Request(url, headers={'User-Agent': 'tarkov-quest-router/1.0'})
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
    return raw if binary else json.loads(raw.decode('utf-8'))


def project(x, z, transform, rotation):
    """Game coordinates -> Leaflet pixel space."""
    a, b, c, d = transform
    radians = math.radians(rotation or 0)
    cos_r, sin_r = math.cos(radians), math.sin(radians)
    px_raw = x * cos_r - z * sin_r
    py_raw = x * sin_r + z * cos_r
    return a * px_raw + b, -c * py_raw + d


def build_projection(bounds, transform, rotation, swap):
    """Pixel rect of the bounds corners, reading each pair as (x, z) or (z, x)."""
    corners = []
    for pair in bounds:
        x, z = (pair[1], pair[0]) if swap else (pair[0], pair[1])
        corners.append(project(x, z, transform, rotation))
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    return {'xMin': min(xs), 'xMax': max(xs), 'yMin': min(ys), 'yMax': max(ys)}


def fraction(x, z, rect, transform, rotation):
    px, py = project(x, z, transform, rotation)
    u = (px - rect['xMin']) / (rect['xMax'] - rect['xMin'])
    v = (py - rect['yMin']) / (rect['yMax'] - rect['yMin'])
    return u, v


def score(spawns, rect, transform, rotation):
    """Share of spawn points that land inside the map image."""
    if not spawns:
        return 0.0
    inside = 0
    for spawn in spawns:
        u, v = fraction(spawn['position']['x'], spawn['position']['z'], rect, transform, rotation)
        if -0.02 <= u <= 1.02 and -0.02 <= v <= 1.02:
            inside += 1
    return inside / len(spawns)


def viewbox_of(svg_text):
    match = re.search(r'viewBox="([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)"', svg_text)
    if match:
        return float(match.group(3)), float(match.group(4))
    w = re.search(r'\bwidth="([\d.]+)"', svg_text)
    h = re.search(r'\bheight="([\d.]+)"', svg_text)
    return (float(w.group(1)), float(h.group(1))) if w and h else (None, None)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(MAPS_DIR, exist_ok=True)

    all_maps = get(MAPS_JSON)
    index = []
    problems = []

    for normalized, (spt_folder, wiki_name) in MAP_SOURCES.items():
        entry = next((m for m in all_maps if m.get('normalizedName') == normalized), None)
        if not entry:
            problems.append(f'{normalized}: not in maps.json')
            continue

        variant = next((v for v in entry.get('maps', []) if v.get('svgPath')), None)
        if not variant:
            problems.append(f'{normalized}: no interactive SVG variant')
            continue

        transform = variant.get('transform') or [1, 0, 1, 0]
        rotation = variant.get('coordinateRotation') or 0
        bounds = variant.get('bounds')
        if not bounds:
            problems.append(f'{normalized}: no bounds')
            continue

        svg_text = get(variant['svgPath'], binary=True).decode('utf-8', 'replace')
        width, height = viewbox_of(svg_text)
        if not width or not height:
            problems.append(f'{normalized}: could not read SVG viewBox')
            continue
        with open(os.path.join(MAPS_DIR, f'{normalized}.svg'), 'w', encoding='utf-8') as handle:
            handle.write(svg_text)

        try:
            base = get(f'{SPT_BASE}/{spt_folder}/base.json')
        except Exception as error:
            problems.append(f'{normalized}: SPT base.json failed ({error})')
            continue

        # Sniper scavs: tarkov.dev derives these from marksman waves, matching
        # a wave's spawn points to the zone name on each spawn point. Only
        # Streets carries a 'sniper' category in the API, so deriving it here
        # covers every map.
        marksman_zones = set()
        for wave in base.get('waves', []) or []:
            if wave.get('WildSpawnType') != 'marksman':
                continue
            for zone in (wave.get('SpawnPoints') or '').split(','):
                if zone.strip():
                    marksman_zones.add(zone.strip())

        sniper_spawns = [{
            'zoneName': s.get('BotZoneName') or None,
            'position': {k: s['Position'][k] for k in ('x', 'y', 'z')},
        } for s in base.get('SpawnPointParams', [])
            if s.get('Position') and s.get('BotZoneName') in marksman_zones]

        pmc = [s for s in base.get('SpawnPointParams', [])
               if 'Player' in (s.get('Categories') or [])
               and any(side in ('Pmc', 'All') for side in (s.get('Sides') or []))
               and s.get('Position')]
        spawns = [{
            'id': s['Id'],
            'zoneName': s.get('BotZoneName') or None,
            'infiltration': s.get('Infiltration') or None,
            'position': {k: s['Position'][k] for k in ('x', 'y', 'z')},
        } for s in pmc]

        # Pick the bounds reading that actually contains the spawns.
        candidates = []
        for swap in (False, True):
            rect = build_projection(bounds, transform, rotation, swap)
            if rect['xMax'] == rect['xMin'] or rect['yMax'] == rect['yMin']:
                continue
            candidates.append((score(spawns, rect, transform, rotation), swap, rect))
        candidates.sort(key=lambda c: -c[0])

        if not candidates or candidates[0][0] < 0.9:
            best = candidates[0][0] if candidates else 0
            problems.append(f'{normalized}: projection unverified, only {best:.0%} of spawns inside')
            continue

        accuracy, swap, rect = candidates[0]

        try:
            raw_extracts = get(f'{SPT_BASE}/{spt_folder}/allExtracts.json')
        except Exception:
            raw_extracts = base.get('exits', [])
        extracts = [{
            'name': e.get('Name'),
            'entryPoints': [p.strip() for p in (e.get('EntryPoints') or '').split(',') if p.strip()],
            'side': e.get('Side'),
            'requirement': e.get('PassageRequirement'),
            'requirementTip': e.get('RequirementTip') or None,
            'exfiltrationTime': e.get('ExfiltrationTime'),
            'chance': e.get('Chance'),
        } for e in raw_extracts]

        labels = [{'text': l['text'], 'x': l['position'][0], 'z': l['position'][1]}
                  for l in (variant.get('labels') or [])]

        payload = {
            'normalizedName': normalized,
            'wikiName': wiki_name,
            'displayName': entry.get('normalizedName'),
            'svg': f'/maps/{normalized}.svg',
            'viewBox': {'width': width, 'height': height},
            'projection': {
                'transform': transform,
                'rotation': rotation,
                'rect': rect,
                'swapBounds': swap,
            },
            'spawnAccuracy': round(accuracy, 4),
            'spawns': spawns,
            'sniperSpawns': sniper_spawns,
            'extracts': extracts,
            'labels': labels,
        }
        with open(os.path.join(DATA_DIR, f'{normalized}.json'), 'w', encoding='utf-8') as handle:
            json.dump(payload, handle)

        index.append({
            'normalizedName': normalized,
            'wikiName': wiki_name,
            'spawns': len(spawns),
            'snipers': len(sniper_spawns),
            'extracts': len(extracts),
            'labels': len(labels),
            'spawnAccuracy': round(accuracy, 4),
        })
        print(f'{normalized:20s} spawns={len(spawns):4d} snipers={len(sniper_spawns):3d} '
              f'extracts={len(extracts):3d} labels={len(labels):3d} inside={accuracy:.1%}')

    with open(os.path.join(DATA_DIR, 'maps-index.json'), 'w', encoding='utf-8') as handle:
        json.dump(index, handle, indent=1)

    print(f'\nwrote {len(index)} maps')
    for problem in problems:
        print('PROBLEM:', problem)


if __name__ == '__main__':
    main()
