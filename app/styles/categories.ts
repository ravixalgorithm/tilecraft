import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { shiftHsl } from '../lib/color';

export const CATEGORIES = [
  { id: 'water', label: 'Water' },
  { id: 'land', label: 'Land' },
  { id: 'parks', label: 'Parks & green' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'roads_highway', label: 'Highways' },
  { id: 'roads_major', label: 'Major roads' },
  { id: 'roads_minor', label: 'Minor roads' },
  { id: 'labels_place', label: 'Place labels' },
  { id: 'labels_road', label: 'Road labels' },
  { id: 'labels_water', label: 'Water labels' },
  { id: 'pois', label: 'Points of interest' },
  { id: 'boundaries', label: 'Boundaries' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export type GlobalAdjust = {
  hue: number; // -180..180
  saturation: number; // -100..100
  lightness: number; // -100..100
};

export type Overrides = {
  colors: Partial<Record<CategoryId, string>>;
  hidden: Partial<Record<CategoryId, boolean>>;
  opacity: Partial<Record<CategoryId, number>>; // 0..1
  global: GlobalAdjust;
  density: number; // 0..1; multiplier on opacity of secondary labels/pois
  buildings3d: boolean;
  /** How many zoom levels to push road visibility down. 0 = stock; 3 = aggressive (more roads at low zoom, useful in regions where OSM minor roads only appear at z14+). */
  roadDetail: number;
};

export const DEFAULT_GLOBAL: GlobalAdjust = { hue: 0, saturation: 0, lightness: 0 };

export function emptyOverrides(): Overrides {
  return {
    colors: {},
    hidden: {},
    opacity: {},
    global: { ...DEFAULT_GLOBAL },
    density: 1,
    buildings3d: false,
    roadDetail: 0,
  };
}

function lc(s: string | undefined | null): string {
  return (s ?? '').toLowerCase();
}

function srcLayer(layer: LayerSpecification): string {
  return lc('source-layer' in layer ? (layer['source-layer'] as string | undefined) : '');
}

export function classifyLayer(layer: LayerSpecification): CategoryId | null {
  const id = lc(layer.id);
  const sl = srcLayer(layer);

  // Label / POI layers
  if (layer.type === 'symbol') {
    if (id.includes('poi')) return 'pois';
    if (id.includes('watername') || id.includes('water-name') || id.includes('waterway-name')) return 'labels_water';
    if (id.includes('road') || id.includes('highway') || id.includes('motorway') || id.includes('shield')) return 'labels_road';
    if (id.includes('admin') || id.includes('boundary') || id.includes('country') || id.includes('place') || id.includes('state') || id.includes('region')) return 'labels_place';
    return 'labels_place';
  }

  // Geometric layers
  if (id.includes('water') || sl === 'water') return 'water';
  if (id.includes('waterway')) return 'water';

  if (
    id.includes('park') ||
    id.includes('grass') ||
    id.includes('wood') ||
    id.includes('forest') ||
    id.includes('cemetery') ||
    id.includes('nature')
  ) {
    return 'parks';
  }

  if (id.includes('building') || sl === 'building' || sl === 'buildings') return 'buildings';

  // Roads — check most specific first
  if (id.includes('motorway')) return 'roads_highway';
  if (
    id.includes('trunk') ||
    id.includes('primary') ||
    id.includes('secondary') ||
    id.includes('tertiary')
  ) {
    return 'roads_major';
  }
  if (
    id.includes('road') ||
    id.includes('street') ||
    id.includes('path') ||
    id.includes('service') ||
    id.includes('track') ||
    id.includes('link') ||
    id.includes('aeroway') ||
    id.includes('bridge') ||
    id.includes('tunnel') ||
    sl === 'transportation' ||
    sl === 'road' ||
    sl === 'roads'
  ) {
    return 'roads_minor';
  }

  if (
    id.includes('admin') ||
    id.includes('boundary') ||
    id.includes('border') ||
    sl === 'admin' ||
    sl === 'boundaries'
  ) {
    return 'boundaries';
  }

  if (
    id === 'background' ||
    id.includes('earth') ||
    id.includes('land') ||
    sl === 'landcover' ||
    sl === 'landuse'
  ) {
    return 'land';
  }

  return null;
}

function paintColorKey(type: LayerSpecification['type']): string | null {
  switch (type) {
    case 'fill': return 'fill-color';
    case 'line': return 'line-color';
    case 'background': return 'background-color';
    case 'fill-extrusion': return 'fill-extrusion-color';
    case 'symbol': return 'text-color';
    case 'circle': return 'circle-color';
    default: return null;
  }
}

function paintOpacityKey(type: LayerSpecification['type']): string | null {
  switch (type) {
    case 'fill': return 'fill-opacity';
    case 'line': return 'line-opacity';
    case 'background': return 'background-opacity';
    case 'fill-extrusion': return 'fill-extrusion-opacity';
    case 'symbol': return 'text-opacity';
    case 'circle': return 'circle-opacity';
    default: return null;
  }
}

export type OriginalColors = Map<string, string>; // key = `${layerId}:${paintKey}`
export type OriginalMinZooms = Map<string, number>; // key = layerId

export function snapshotOriginalColors(map: MapLibreMap): OriginalColors {
  const out: OriginalColors = new Map();
  const style = map.getStyle();
  if (!style?.layers) return out;
  for (const layer of style.layers) {
    const key = paintColorKey(layer.type);
    if (!key) continue;
    try {
      const v = map.getPaintProperty(layer.id, key);
      if (typeof v === 'string') {
        out.set(`${layer.id}:${key}`, v);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

export function snapshotOriginalMinZooms(map: MapLibreMap): OriginalMinZooms {
  const out: OriginalMinZooms = new Map();
  const style = map.getStyle();
  if (!style?.layers) return out;
  for (const layer of style.layers) {
    const mz = (layer as { minzoom?: number }).minzoom;
    if (typeof mz === 'number') out.set(layer.id, mz);
  }
  return out;
}

function shouldApplyDensity(cat: CategoryId): boolean {
  return cat === 'labels_road' || cat === 'labels_water' || cat === 'pois';
}

function isRoadCategory(cat: CategoryId): boolean {
  return cat === 'roads_highway' || cat === 'roads_major' || cat === 'roads_minor';
}

export function applyOverrides(
  map: MapLibreMap,
  overrides: Overrides,
  originalColors: OriginalColors,
  originalMinZooms?: OriginalMinZooms,
) {
  const style = map.getStyle();
  if (!style?.layers) return;
  const { hue, saturation, lightness } = overrides.global;
  const hasGlobalShift = hue !== 0 || saturation !== 0 || lightness !== 0;
  const detail = Math.max(0, Math.min(4, overrides.roadDetail ?? 0));

  for (const layer of style.layers) {
    const cat = classifyLayer(layer);
    if (!cat) continue;

    const colorKey = paintColorKey(layer.type);
    const opacityKey = paintOpacityKey(layer.type);

    // Visibility
    const hidden = overrides.hidden[cat] ?? false;
    try {
      map.setLayoutProperty(layer.id, 'visibility', hidden ? 'none' : 'visible');
    } catch {
      // ignore
    }
    if (hidden) continue;

    // Road-detail: push minzoom down so minor roads appear earlier
    if (isRoadCategory(cat) && originalMinZooms) {
      const originalMz = originalMinZooms.get(layer.id);
      if (typeof originalMz === 'number') {
        const newMz = Math.max(0, originalMz - detail);
        try {
          map.setLayerZoomRange(layer.id, newMz, 24);
        } catch {
          // ignore
        }
      }
    }

    // Color (override OR original, optionally HSL-shifted)
    if (colorKey) {
      const override = overrides.colors[cat];
      const base = override ?? originalColors.get(`${layer.id}:${colorKey}`);
      if (base) {
        const shifted = hasGlobalShift ? shiftHsl(base, hue, saturation, lightness) : base;
        try {
          map.setPaintProperty(layer.id, colorKey, shifted);
        } catch {
          // ignore
        }
      }
    }

    // Opacity (per-category × density for secondary labels)
    if (opacityKey) {
      let opacity = overrides.opacity[cat] ?? 1;
      if (shouldApplyDensity(cat)) opacity *= overrides.density;
      try {
        map.setPaintProperty(layer.id, opacityKey, opacity);
      } catch {
        // ignore
      }
    }
  }
}
