import type { StyleSpecification } from 'maplibre-gl';
import { emptyOverrides, type Overrides } from './categories';

export type PresetKind = 'vector' | 'raster';

export type PresetTag = 'light' | 'dark' | 'mono' | 'colorful' | 'vintage' | 'minimal' | 'satellite' | 'terrain' | 'streets';

export type Preset = {
  id: string;
  name: string;
  description?: string;
  tags?: PresetTag[];
  /** 'vector' presets respect Layer overrides; 'raster' presets only respond to global tint / view / density. */
  kind: PresetKind;
  /** Source style — either a hosted URL or an inline StyleSpecification we build ourselves. */
  style: string | StyleSpecification;
  overrides: Overrides;
  /** Display section in the preset gallery. */
  section: 'styled' | 'imagery';
};

// ---------- Vector basemap URLs (Carto) ----------

const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const DARK_MATTER = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const VOYAGER = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// ---------- Raster style builders (Esri) ----------

const ESRI_ATTRIBUTION =
  'Tiles © <a href="https://www.esri.com">Esri</a> — Source: Esri, USGS, NOAA, OpenStreetMap contributors';

function rasterStyle(layers: Array<{ id: string; tiles: string; maxzoom?: number }>): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  const styleLayers: StyleSpecification['layers'] = [];
  for (const l of layers) {
    sources[l.id] = {
      type: 'raster',
      tiles: [l.tiles],
      tileSize: 256,
      attribution: ESRI_ATTRIBUTION,
      maxzoom: l.maxzoom ?? 19,
    };
    styleLayers.push({ id: `${l.id}-layer`, type: 'raster', source: l.id });
  }
  return { version: 8, sources, layers: styleLayers };
}

function satelliteStyle(): StyleSpecification {
  return rasterStyle([
    { id: 'imagery', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  ]);
}
function hybridStyle(): StyleSpecification {
  return rasterStyle([
    { id: 'imagery', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
    { id: 'reference', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}' },
  ]);
}
function topoStyle(): StyleSpecification {
  return rasterStyle([
    { id: 'topo', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}' },
  ]);
}
function terrainShadedStyle(): StyleSpecification {
  return rasterStyle([
    { id: 'imagery', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', maxzoom: 13 },
    { id: 'hillshade', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}' },
  ]);
}
function natGeoStyle(): StyleSpecification {
  return rasterStyle([
    { id: 'natgeo', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', maxzoom: 16 },
  ]);
}
function arcgisStreetsStyle(): StyleSpecification {
  return rasterStyle([
    { id: 'streets', tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}' },
  ]);
}

// ---------- Helpers ----------

function p(base: 'positron' | 'dark-matter' | 'voyager', overrides: Partial<Overrides>): Overrides {
  const empty = emptyOverrides();
  return { ...empty, ...overrides, global: { ...empty.global, ...overrides.global } };
}
const vectorBase = { positron: POSITRON, 'dark-matter': DARK_MATTER, voyager: VOYAGER };
function vec(
  id: string,
  name: string,
  base: keyof typeof vectorBase,
  overrides: Partial<Overrides> = {},
  meta: { tags?: PresetTag[]; description?: string } = {},
): Preset {
  return {
    id, name, kind: 'vector', section: 'styled',
    style: vectorBase[base],
    overrides: p(base, overrides),
    tags: meta.tags,
    description: meta.description,
  };
}
function ras(
  id: string,
  name: string,
  builder: () => StyleSpecification,
  meta: { tags?: PresetTag[]; description?: string } = {},
): Preset {
  return {
    id, name, kind: 'raster', section: 'imagery',
    style: builder(),
    overrides: emptyOverrides(),
    tags: meta.tags,
    description: meta.description,
  };
}

// ---------- Preset gallery ----------

export const PRESETS: Preset[] = [
  vec('positron', 'Positron', 'positron', {}, { tags: ['light', 'minimal'], description: 'Clean light basemap, perfect for marketing pages.' }),
  vec('dark-matter', 'Dark Matter', 'dark-matter', {}, { tags: ['dark', 'minimal'], description: 'Crisp dark mode, high contrast.' }),
  vec('voyager', 'Voyager', 'voyager', {}, { tags: ['light', 'streets'], description: 'Friendly defaults with subtle color.' }),

  vec('midnight', 'Midnight', 'dark-matter', {
    colors: { water: '#0c2a5e', land: '#0a0e1a', parks: '#0d2417', roads_highway: '#3b4a7c', roads_major: '#252e4d', roads_minor: '#1f2640', buildings: '#0d1326' },
  }, { tags: ['dark', 'colorful'], description: 'Deep blue night sky over hushed land.' }),

  vec('mono', 'Mono', 'positron', {
    colors: { water: '#d4d4d8', land: '#fafafa', parks: '#e4e4e7', roads_highway: '#71717a', roads_major: '#a1a1aa', roads_minor: '#d4d4d8', buildings: '#e4e4e7', labels_place: '#27272a' },
    hidden: { pois: true, boundaries: true },
  }, { tags: ['light', 'mono', 'minimal'], description: 'Strict grayscale — let your brand take the spotlight.' }),

  vec('paper', 'Paper', 'positron', {
    colors: { water: '#cfe3ec', land: '#f6f1e7', parks: '#dbe5c4', roads_highway: '#fff7e3', roads_major: '#ffffff', roads_minor: '#fbfaf4', buildings: '#e9e1cf' },
    hidden: { pois: true },
  }, { tags: ['light', 'vintage'], description: 'Warm paper tones, like a vintage atlas.' }),

  vec('blueprint', 'Blueprint', 'dark-matter', {
    colors: { water: '#0b3d91', land: '#062456', parks: '#0c4f8a', roads_highway: '#cfe6ff', roads_major: '#9ec9ef', roads_minor: '#5d8bb8', buildings: '#093668', labels_place: '#cfe6ff', boundaries: '#7ec8e3' },
    hidden: { pois: true },
  }, { tags: ['dark', 'colorful'], description: 'Architectural blueprint — white lines on cobalt.' }),

  vec('sand', 'Sand', 'positron', {
    colors: { water: '#7cb6c4', land: '#f4e5c2', parks: '#cdd99c', roads_highway: '#fff7e3', roads_major: '#ffffff', roads_minor: '#fff7e3', buildings: '#e8d29a' },
    hidden: { pois: true },
  }, { tags: ['light', 'vintage'], description: 'Desert palette — warm sand and turquoise water.' }),

  vec('forest', 'Forest', 'positron', {
    colors: { water: '#3f6f7a', land: '#eaf1dd', parks: '#7caa6a', roads_highway: '#ffffff', roads_major: '#f9f7ec', roads_minor: '#eef1e0', buildings: '#d6dcc8' },
    hidden: { pois: true, boundaries: true },
  }, { tags: ['light'], description: 'Soft greens and slate — outdoor brands.' }),

  vec('ink', 'Ink', 'dark-matter', {
    colors: { water: '#0a0a0a', land: '#1a1a1a', parks: '#1f1f1f', roads_highway: '#3d3d3d', roads_major: '#2d2d2d', roads_minor: '#222', buildings: '#0f0f0f', labels_place: '#9ca3af' },
    hidden: { pois: true, boundaries: true },
  }, { tags: ['dark', 'mono', 'minimal'], description: 'Pure ink — for very dark, very serious.' }),

  ras('satellite', 'Satellite', satelliteStyle, { tags: ['satellite'], description: 'Esri World Imagery — raw aerial.' }),
  ras('hybrid', 'Hybrid', hybridStyle, { tags: ['satellite'], description: 'Satellite with place-name labels overlaid.' }),
  ras('topo', 'Topographic', topoStyle, { tags: ['terrain', 'streets'], description: 'Topo lines + roads + relief shading.' }),
  ras('terrain-shaded', 'Terrain', terrainShadedStyle, { tags: ['terrain'], description: 'Subtle terrain base with crisp hillshade.' }),
  ras('natgeo', 'NatGeo', natGeoStyle, { tags: ['vintage', 'terrain'], description: 'National Geographic style — magazine-grade.' }),
  ras('streets-arcgis', 'Streets', arcgisStreetsStyle, { tags: ['streets', 'light'], description: 'Classic ArcGIS street basemap.' }),
];

export function findPreset(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export const DEFAULT_CENTER: [number, number] = [-73.9857, 40.7484];
export const DEFAULT_ZOOM = 12;
