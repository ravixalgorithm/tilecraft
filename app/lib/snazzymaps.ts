import type { CategoryId, Overrides } from '../styles/categories';
import { emptyOverrides } from '../styles/categories';

/**
 * Google Maps JSON Styling Spec (used by Snazzymaps).
 * Each entry: a featureType + elementType + an ordered list of stylers.
 * Spec ref: https://developers.google.com/maps/documentation/javascript/style-reference (now deprecated 2025-03-18).
 */
type Styler =
  | { color?: string }
  | { visibility?: 'on' | 'off' | 'simplified' }
  | { hue?: string }
  | { lightness?: number }
  | { saturation?: number }
  | { gamma?: number }
  | { weight?: number }
  | { invert_lightness?: boolean };

export type SnazzyRule = {
  featureType?: string;
  elementType?: string;
  stylers?: Styler[];
};

const FEATURE_TO_CAT: Record<string, CategoryId> = {
  // Water
  'water': 'water',

  // Landscape (land + parks)
  'landscape': 'land',
  'landscape.natural': 'land',
  'landscape.natural.terrain': 'land',
  'landscape.natural.landcover': 'parks',
  'landscape.man_made': 'buildings',

  // POI / parks (POI park is green, treat as parks)
  'poi': 'pois',
  'poi.attraction': 'pois',
  'poi.business': 'pois',
  'poi.government': 'pois',
  'poi.medical': 'pois',
  'poi.park': 'parks',
  'poi.place_of_worship': 'pois',
  'poi.school': 'pois',
  'poi.sports_complex': 'pois',

  // Roads
  'road': 'roads_minor',
  'road.local': 'roads_minor',
  'road.arterial': 'roads_major',
  'road.highway': 'roads_highway',
  'road.highway.controlled_access': 'roads_highway',

  // Transit (approx → minor road)
  'transit': 'roads_minor',
  'transit.line': 'roads_minor',
  'transit.station': 'pois',
  'transit.station.airport': 'pois',
  'transit.station.bus': 'pois',
  'transit.station.rail': 'pois',

  // Administrative — geometry → boundaries; labels handled per-elementType below
  'administrative': 'boundaries',
  'administrative.country': 'boundaries',
  'administrative.province': 'boundaries',
  'administrative.locality': 'boundaries',
  'administrative.neighborhood': 'boundaries',
  'administrative.land_parcel': 'boundaries',
};

function adminLabelCategory(featureType: string): CategoryId {
  // All administrative subtypes have labels rendered as place labels
  if (featureType.startsWith('administrative')) return 'labels_place';
  return 'labels_place';
}

/** Map a snazzymaps (featureType, elementType) pair to our category(ies). */
function resolveCategories(featureType: string, elementType: string): CategoryId[] {
  const isLabels = elementType.startsWith('labels');
  const isGeom = elementType === '' || elementType === 'all' || elementType.startsWith('geometry');

  // labels.* on a feature => one of our labels_* categories
  if (isLabels) {
    if (featureType.startsWith('road') || featureType === 'transit.line') return ['labels_road'];
    if (featureType === 'water') return ['labels_water'];
    if (featureType.startsWith('poi')) return ['pois'];
    if (featureType.startsWith('administrative')) return [adminLabelCategory(featureType)];
    if (featureType === 'landscape' || featureType.startsWith('landscape')) return ['labels_place'];
    return ['labels_place'];
  }

  // geometry / unspecified => map by featureType
  if (isGeom || elementType === 'all') {
    const direct = FEATURE_TO_CAT[featureType];
    if (direct) return [direct];
  }

  return [];
}

function pickColor(stylers: Styler[]): string | undefined {
  // Snazzy applies stylers in order — last color wins.
  let color: string | undefined;
  for (const s of stylers) {
    if ('color' in s && s.color && /^#[0-9a-fA-F]{6}$/.test(s.color)) color = s.color;
  }
  return color;
}

function pickVisibility(stylers: Styler[]): 'on' | 'off' | 'simplified' | undefined {
  let v: 'on' | 'off' | 'simplified' | undefined;
  for (const s of stylers) {
    if ('visibility' in s && s.visibility) v = s.visibility;
  }
  return v;
}

function pickNumber(stylers: Styler[], key: 'lightness' | 'saturation' | 'gamma'): number | undefined {
  let v: number | undefined;
  for (const s of stylers) {
    const u = s as Record<string, unknown>;
    if (typeof u[key] === 'number') v = u[key] as number;
  }
  return v;
}

export type ImportResult = {
  overrides: Overrides;
  appliedRules: number;
  skippedRules: number;
  notes: string[];
};

/** Transpile a Snazzymaps / Google Maps JSON style array into our Overrides. */
export function importSnazzymapsJson(input: unknown): ImportResult {
  const notes: string[] = [];
  let applied = 0;
  let skipped = 0;
  const overrides = emptyOverrides();

  if (!Array.isArray(input)) {
    return { overrides, appliedRules: 0, skippedRules: 0, notes: ['Input is not a JSON array — paste the snazzymaps style array.'] };
  }

  // Track first-set "all" lightness/saturation for global HSL
  let globalL: number | undefined;
  let globalS: number | undefined;

  for (const raw of input as SnazzyRule[]) {
    const rule = raw ?? {};
    const featureType = (rule.featureType ?? 'all').trim();
    const elementType = (rule.elementType ?? 'all').trim();
    const stylers = rule.stylers ?? [];

    if (!stylers.length) { skipped++; continue; }

    // Special-case "all" — apply lightness/saturation to global HSL
    if (featureType === 'all') {
      const l = pickNumber(stylers, 'lightness');
      const s = pickNumber(stylers, 'saturation');
      if (typeof l === 'number') globalL = l;
      if (typeof s === 'number') globalS = s;
      const v = pickVisibility(stylers);
      if (v === 'off') {
        notes.push('Rule "featureType:all visibility:off" ignored (would blank the entire map).');
      }
      applied++;
      continue;
    }

    const targets = resolveCategories(featureType, elementType);
    if (targets.length === 0) {
      skipped++;
      continue;
    }

    const color = pickColor(stylers);
    const visibility = pickVisibility(stylers);

    for (const t of targets) {
      if (color) overrides.colors[t] = color;
      if (visibility === 'off') overrides.hidden[t] = true;
      else if (visibility === 'on' || visibility === 'simplified') overrides.hidden[t] = false;
    }
    applied++;
  }

  if (typeof globalL === 'number') overrides.global.lightness = Math.max(-100, Math.min(100, globalL));
  if (typeof globalS === 'number') overrides.global.saturation = Math.max(-100, Math.min(100, globalS));

  if (applied === 0) notes.push('No rules matched — JSON shape looks unusual.');
  return { overrides, appliedRules: applied, skippedRules: skipped, notes };
}
