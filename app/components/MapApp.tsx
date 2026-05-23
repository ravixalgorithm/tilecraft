'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas, {
  type MapApi,
  type MarkerSpec,
  type MarkerIcon,
  type GeoJsonOverlay,
  type DrawMode,
} from './MapCanvas';
import PresetGalleryModal from './PresetGalleryModal';
import { importSnazzymapsJson, type ImportResult } from '../lib/snazzymaps';
import {
  listSavedStyles,
  saveStyle as saveStyleLS,
  deleteSavedStyle,
  renameSavedStyle,
  type SavedStyle,
} from '../lib/saved-styles';
import {
  PRESETS,
  type Preset,
  findPreset,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
} from '../styles/presets';
import {
  CATEGORIES,
  type CategoryId,
  type Overrides,
  type GlobalAdjust,
  emptyOverrides,
  DEFAULT_GLOBAL,
} from '../styles/categories';

type Tab = 'presets' | 'layers' | 'markers' | 'data' | 'view' | 'export';

type AppState = {
  presetId: string;
  overrides: Overrides;
  pitch: number;
  bearing: number;
  terrain3d: boolean;
  terrainExaggeration: number;
  markers: MarkerSpec[];
  lng: number;
  lat: number;
  zoom: number;
  query: string;
};

const DEFAULT_MARKER_COLOR = '#ef4444';
const SEARCH_MARKER_ID = '__search';

const SAMPLE_GEOJSON = JSON.stringify(
  {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Central Park' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-73.9819, 40.7681],
              [-73.9498, 40.7969],
              [-73.9580, 40.8005],
              [-73.9901, 40.7717],
              [-73.9819, 40.7681],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'Sample route' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-73.9857, 40.7484],
            [-73.9760, 40.7570],
            [-73.9665, 40.7660],
            [-73.9533, 40.7794],
          ],
        },
      },
    ],
  },
  null,
  2,
);

function encodeMarker(m: MarkerSpec): string {
  // lng,lat,color,label[,iconType,iconValue]
  const label = encodeURIComponent(m.label ?? '');
  const base = `${m.lng.toFixed(5)},${m.lat.toFixed(5)},${m.color},${label}`;
  if (!m.icon || m.icon.type === 'pin') return base;
  if (m.icon.type === 'emoji') return `${base},e,${encodeURIComponent(m.icon.value)}`;
  return `${base},i,${encodeURIComponent(m.icon.url)}`;
}
function decodeMarker(s: string, idx: number): MarkerSpec | null {
  const parts = s.split(',');
  if (parts.length < 3) return null;
  const lng = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  const color = parts[2];
  const labelEnc = parts[3] ?? '';
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  let icon: MarkerIcon | undefined;
  const iconType = parts[4];
  const iconValueEnc = parts.slice(5).join(',');
  if (iconType === 'e' && iconValueEnc) {
    icon = { type: 'emoji', value: decodeURIComponent(iconValueEnc) };
  } else if (iconType === 'i' && iconValueEnc) {
    icon = { type: 'image', url: decodeURIComponent(iconValueEnc) };
  }
  return {
    id: `m${idx}-${Math.random().toString(36).slice(2, 8)}`,
    lng, lat, color,
    label: labelEnc ? decodeURIComponent(labelEnc) : undefined,
    icon,
  };
}

const CAT_KEY: Record<CategoryId, string> = {
  water: 'w',
  land: 'l',
  parks: 'p',
  buildings: 'b',
  roads_highway: 'rh',
  roads_major: 'rj',
  roads_minor: 'rn',
  labels_place: 'tp',
  labels_road: 'tr',
  labels_water: 'tw',
  pois: 'i',
  boundaries: 'd',
};

function cloneOverrides(o: Overrides): Overrides {
  return {
    colors: { ...o.colors },
    hidden: { ...o.hidden },
    opacity: { ...o.opacity },
    global: { ...o.global },
    density: o.density,
    buildings3d: o.buildings3d,
    roadDetail: o.roadDetail,
  };
}

function readInitialState(): AppState {
  const base = PRESETS[0];
  const fallback: AppState = {
    presetId: base.id,
    overrides: cloneOverrides(base.overrides),
    pitch: 0,
    bearing: 0,
    terrain3d: false,
    terrainExaggeration: 1.4,
    markers: [],
    lng: DEFAULT_CENTER[0],
    lat: DEFAULT_CENTER[1],
    zoom: DEFAULT_ZOOM,
    query: '',
  };
  if (typeof window === 'undefined') return fallback;
  const p = new URLSearchParams(window.location.search);
  const preset = findPreset(p.get('preset') ?? '');
  const overrides = cloneOverrides(preset.overrides);

  for (const cat of CATEGORIES) {
    const c = p.get(CAT_KEY[cat.id]);
    if (c && /^#[0-9a-fA-F]{6}$/.test(c)) overrides.colors[cat.id] = c;
    const h = p.get(CAT_KEY[cat.id] + 'H');
    if (h === '1') overrides.hidden[cat.id] = true;
    else if (h === '0') overrides.hidden[cat.id] = false;
    const o = p.get(CAT_KEY[cat.id] + 'O');
    if (o !== null) {
      const v = Number(o);
      if (Number.isFinite(v)) overrides.opacity[cat.id] = Math.max(0, Math.min(1, v));
    }
  }
  const gH = Number(p.get('gH') ?? overrides.global.hue);
  const gS = Number(p.get('gS') ?? overrides.global.saturation);
  const gL = Number(p.get('gL') ?? overrides.global.lightness);
  overrides.global = {
    hue: Number.isFinite(gH) ? gH : 0,
    saturation: Number.isFinite(gS) ? gS : 0,
    lightness: Number.isFinite(gL) ? gL : 0,
  };
  const dens = Number(p.get('dn') ?? overrides.density);
  overrides.density = Number.isFinite(dens) ? Math.max(0, Math.min(1, dens)) : 1;
  overrides.buildings3d = p.get('b3') === '1';
  const rd = Number(p.get('rd') ?? overrides.roadDetail);
  overrides.roadDetail = Number.isFinite(rd) ? Math.max(0, Math.min(4, rd)) : 0;

  const lng = Number(p.get('lng') ?? DEFAULT_CENTER[0]);
  const lat = Number(p.get('lat') ?? DEFAULT_CENTER[1]);
  const zoom = Number(p.get('z') ?? DEFAULT_ZOOM);
  const pitch = Number(p.get('pt') ?? 0);
  const bearing = Number(p.get('br') ?? 0);

  const tex = Number(p.get('te') ?? 1.4);
  const markers: MarkerSpec[] = [];
  p.getAll('m').forEach((s, i) => {
    const m = decodeMarker(s, i);
    if (m) markers.push(m);
  });
  return {
    presetId: preset.id,
    overrides,
    pitch: Number.isFinite(pitch) ? pitch : 0,
    bearing: Number.isFinite(bearing) ? bearing : 0,
    terrain3d: p.get('t3') === '1',
    terrainExaggeration: Number.isFinite(tex) ? Math.max(0.2, Math.min(4, tex)) : 1.4,
    markers,
    lng: Number.isFinite(lng) ? lng : DEFAULT_CENTER[0],
    lat: Number.isFinite(lat) ? lat : DEFAULT_CENTER[1],
    zoom: Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM,
    query: p.get('q') ?? '',
  };
}

function encodeState(s: AppState): string {
  const p = new URLSearchParams();
  p.set('preset', s.presetId);
  for (const cat of CATEGORIES) {
    const c = s.overrides.colors[cat.id];
    if (c) p.set(CAT_KEY[cat.id], c);
    const h = s.overrides.hidden[cat.id];
    if (h !== undefined) p.set(CAT_KEY[cat.id] + 'H', h ? '1' : '0');
    const o = s.overrides.opacity[cat.id];
    if (o !== undefined) p.set(CAT_KEY[cat.id] + 'O', o.toFixed(2));
  }
  if (s.overrides.global.hue !== 0) p.set('gH', String(s.overrides.global.hue));
  if (s.overrides.global.saturation !== 0) p.set('gS', String(s.overrides.global.saturation));
  if (s.overrides.global.lightness !== 0) p.set('gL', String(s.overrides.global.lightness));
  if (s.overrides.density !== 1) p.set('dn', s.overrides.density.toFixed(2));
  if (s.overrides.buildings3d) p.set('b3', '1');
  if ((s.overrides.roadDetail ?? 0) > 0) p.set('rd', String(s.overrides.roadDetail));
  if (s.terrain3d) p.set('t3', '1');
  if (s.terrainExaggeration !== 1.4) p.set('te', s.terrainExaggeration.toFixed(1));
  for (const mk of s.markers) p.append('m', encodeMarker(mk));
  p.set('lng', s.lng.toFixed(5));
  p.set('lat', s.lat.toFixed(5));
  p.set('z', s.zoom.toFixed(2));
  if (s.pitch !== 0) p.set('pt', s.pitch.toFixed(1));
  if (s.bearing !== 0) p.set('br', s.bearing.toFixed(1));
  if (s.query) p.set('q', s.query);
  return p.toString();
}

type GeocodeResult = { lat: number; lng: number; label: string; type?: string };

async function geocode(q: string, limit = 1, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=0&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; type?: string }>;
  return data.map((d) => ({
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
    label: d.display_name,
    type: d.type,
  }));
}

function download(filename: string, content: BlobPart, mime: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isEmbed(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('embed') === '1';
}

export default function MapApp() {
  const [state, setState] = useState<AppState>(readInitialState);
  const [tab, setTab] = useState<Tab>('layers');
  const [embed] = useState<boolean>(isEmbed);
  const [queryInput, setQueryInput] = useState(state.query);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(-1);
  const [copied, setCopied] = useState<string | null>(null);
  const [embedWidth, setEmbedWidth] = useState('100%');
  const [embedHeight, setEmbedHeight] = useState('500');
  const [placementMode, setPlacementMode] = useState(false);
  const [nextMarkerColor, setNextMarkerColor] = useState(DEFAULT_MARKER_COLOR);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [drawPoints, setDrawPoints] = useState<Array<[number, number]>>([]);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [savedStyles, setSavedStyles] = useState<SavedStyle[]>([]);

  // Hydrate saved styles after mount
  useEffect(() => {
    setSavedStyles(listSavedStyles());
  }, []);

  // Debounced address suggestions (Nominatim, 300 ms idle)
  useEffect(() => {
    const q = queryInput.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestIdx(-1);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const results = await geocode(q, 5, controller.signal);
        setSuggestions(results);
        setSuggestIdx(-1);
      } catch (e) {
        if ((e as { name?: string })?.name !== 'AbortError') {
          setSuggestions([]);
        }
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [queryInput]);

  function refreshSavedStyles() {
    setSavedStyles(listSavedStyles());
  }

  function handleSaveCurrent() {
    const name = window.prompt('Name this style:', current.name + ' edit');
    if (name === null) return;
    const preview = (() => {
      if (current.kind === 'raster') return undefined;
      const c = state.overrides.colors;
      return {
        land: c.land,
        water: c.water,
        roads: c.roads_major ?? c.roads_highway,
      };
    })();
    saveStyleLS(name || 'Untitled', encodeState(state), preview);
    refreshSavedStyles();
  }

  function applySavedStyle(s: SavedStyle) {
    const p = new URLSearchParams(s.query);
    // Build a URL with the saved params and navigate; the rest happens via readInitialState
    const next = `${window.location.pathname}?${p.toString()}`;
    window.location.href = next;
  }

  function onMapDrawClick(lng: number, lat: number) {
    setDrawPoints((pts) => [...pts, [lng, lat]]);
  }

  function startDraw(mode: DrawMode) {
    setDrawPoints([]);
    setDrawMode(mode);
    setPlacementMode(false);
  }

  function cancelDraw() {
    setDrawPoints([]);
    setDrawMode('none');
  }

  function finishDraw() {
    if (drawMode === 'none') return;
    const points = drawPoints;
    const minPoints = drawMode === 'polygon' ? 3 : 2;
    if (points.length < minPoints) {
      cancelDraw();
      return;
    }
    const feature: GeoJSON.Feature = drawMode === 'polygon'
      ? {
          type: 'Feature',
          properties: { drawn: true, kind: 'polygon' },
          geometry: { type: 'Polygon', coordinates: [[...points, points[0]]] },
        }
      : {
          type: 'Feature',
          properties: { drawn: true, kind: 'line' },
          geometry: { type: 'LineString', coordinates: points },
        };
    // Append into the GeoJSON text in the Data tab
    const existing = geojsonText.trim();
    let next: string;
    if (!existing) {
      next = JSON.stringify({ type: 'FeatureCollection', features: [feature] }, null, 2);
    } else {
      try {
        const parsed = JSON.parse(existing);
        if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
          parsed.features.push(feature);
          next = JSON.stringify(parsed, null, 2);
        } else if (parsed?.type === 'Feature') {
          next = JSON.stringify(
            { type: 'FeatureCollection', features: [parsed, feature] },
            null,
            2,
          );
        } else {
          next = JSON.stringify({ type: 'FeatureCollection', features: [feature] }, null, 2);
        }
      } catch {
        next = JSON.stringify({ type: 'FeatureCollection', features: [feature] }, null, 2);
      }
    }
    setGeojsonText(next);
    cancelDraw();
    setTab('data');
  }

  function runImport() {
    if (!importText.trim()) return;
    try {
      const parsed = JSON.parse(importText);
      const result = importSnazzymapsJson(parsed);
      setImportResult(result);
      // Merge into current overrides (don't clobber unrelated bits like buildings3d/density)
      setState((s) => ({
        ...s,
        overrides: {
          ...s.overrides,
          colors: { ...s.overrides.colors, ...result.overrides.colors },
          hidden: { ...s.overrides.hidden, ...result.overrides.hidden },
          opacity: { ...s.overrides.opacity },
          global: {
            ...s.overrides.global,
            saturation: result.overrides.global.saturation || s.overrides.global.saturation,
            lightness: result.overrides.global.lightness || s.overrides.global.lightness,
          },
        },
      }));
    } catch (e) {
      setImportResult({
        overrides: { colors: {}, hidden: {}, opacity: {}, global: { hue: 0, saturation: 0, lightness: 0 }, density: 1, buildings3d: false, roadDetail: 0 },
        appliedRules: 0,
        skippedRules: 0,
        notes: [e instanceof Error ? e.message : 'Invalid JSON'],
      });
    }
  }
  const [geojsonText, setGeojsonText] = useState('');
  const [geojsonErr, setGeojsonErr] = useState<string | null>(null);
  const [geojsonColor, setGeojsonColor] = useState('#3b82f6');
  const [geojsonOpacity, setGeojsonOpacity] = useState(0.9);
  const [geojsonStroke, setGeojsonStroke] = useState(2);
  const mapRef = useRef<MapApi>(null);

  // Hydrate GeoJSON state from localStorage (not URL — GeoJSON is too large)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('tilecraft.geojson');
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        text: string; color: string; opacity: number; stroke: number;
      };
      if (typeof saved.text === 'string') setGeojsonText(saved.text);
      if (typeof saved.color === 'string') setGeojsonColor(saved.color);
      if (typeof saved.opacity === 'number') setGeojsonOpacity(saved.opacity);
      if (typeof saved.stroke === 'number') setGeojsonStroke(saved.stroke);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'tilecraft.geojson',
        JSON.stringify({ text: geojsonText, color: geojsonColor, opacity: geojsonOpacity, stroke: geojsonStroke }),
      );
    } catch { /* */ }
  }, [geojsonText, geojsonColor, geojsonOpacity, geojsonStroke]);

  const geojsonOverlay: GeoJsonOverlay | null = useMemo(() => {
    const t = geojsonText.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t) as GeoJSON.GeoJSON;
      return {
        geojson: parsed,
        color: geojsonColor,
        opacity: geojsonOpacity,
        strokeWidth: geojsonStroke,
      };
    } catch {
      return null;
    }
  }, [geojsonText, geojsonColor, geojsonOpacity, geojsonStroke]);

  useEffect(() => {
    const t = geojsonText.trim();
    if (!t) {
      setGeojsonErr(null);
      return;
    }
    try {
      JSON.parse(t);
      setGeojsonErr(null);
    } catch (e) {
      setGeojsonErr(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, [geojsonText]);

  function newId(): string {
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  function addMarkerAt(lng: number, lat: number) {
    const marker: MarkerSpec = { id: newId(), lng, lat, color: nextMarkerColor };
    setState((s) => ({ ...s, markers: [...s.markers, marker] }));
    setPlacementMode(false);
  }
  function updateMarker(id: string, patch: Partial<MarkerSpec>) {
    setState((s) => ({
      ...s,
      markers: s.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }
  function removeMarker(id: string) {
    setState((s) => ({ ...s, markers: s.markers.filter((m) => m.id !== id) }));
  }
  function clearMarkers() {
    setState((s) => ({ ...s, markers: [] }));
  }

  const current = useMemo(() => findPreset(state.presetId), [state.presetId]);

  useEffect(() => {
    const qs = encodeState(state);
    window.history.replaceState(null, '', `${window.location.pathname}?${qs}`);
  }, [state]);

  useEffect(() => {
    if (current.kind === 'raster' && tab === 'layers') setTab('presets');
  }, [current.kind, tab]);

  function update<K extends keyof AppState>(key: K, value: AppState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }
  function patchOverrides(patch: Partial<Overrides>) {
    setState((s) => ({
      ...s,
      overrides: {
        ...s.overrides,
        ...patch,
        global: { ...s.overrides.global, ...(patch.global ?? {}) },
      },
    }));
  }
  function selectPreset(id: string) {
    const preset = findPreset(id);
    setState((s) => ({ ...s, presetId: id, overrides: cloneOverrides(preset.overrides) }));
  }
  function setCategoryColor(cat: CategoryId, color: string) {
    setState((s) => ({
      ...s,
      overrides: { ...s.overrides, colors: { ...s.overrides.colors, [cat]: color } },
    }));
  }
  function clearCategoryColor(cat: CategoryId) {
    setState((s) => {
      const next = { ...s.overrides.colors };
      delete next[cat];
      return { ...s, overrides: { ...s.overrides, colors: next } };
    });
  }
  function setCategoryOpacity(cat: CategoryId, value: number) {
    setState((s) => ({
      ...s,
      overrides: { ...s.overrides, opacity: { ...s.overrides.opacity, [cat]: value } },
    }));
  }
  function toggleHide(cat: CategoryId) {
    setState((s) => ({
      ...s,
      overrides: {
        ...s.overrides,
        hidden: { ...s.overrides.hidden, [cat]: !s.overrides.hidden[cat] },
      },
    }));
  }
  function resetToPreset() {
    setState((s) => ({ ...s, overrides: cloneOverrides(findPreset(s.presetId).overrides) }));
  }
  function resetAll() {
    setState((s) => ({ ...s, overrides: emptyOverrides() }));
  }

  function pickSuggestion(hit: GeocodeResult) {
    const newZoom = Math.max(state.zoom, 13);
    mapRef.current?.flyTo(hit.lng, hit.lat, newZoom);
    const primaryLabel = hit.label.split(',')[0]?.trim() || hit.label;
    const searchMarker: MarkerSpec = {
      id: SEARCH_MARKER_ID,
      lng: hit.lng,
      lat: hit.lat,
      color: '#3b82f6',
      label: primaryLabel,
    };
    setState((s) => ({
      ...s,
      lng: hit.lng,
      lat: hit.lat,
      zoom: newZoom,
      query: hit.label,
      // Replace any previous search-result marker (keep user-placed ones)
      markers: [...s.markers.filter((m) => m.id !== SEARCH_MARKER_ID), searchMarker],
    }));
    setQueryInput(hit.label);
    setSuggestOpen(false);
    setSuggestions([]);
    setSearchErr(null);
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    // If we already have suggestions, take the highlighted one (or first)
    if (suggestions.length > 0) {
      pickSuggestion(suggestions[Math.max(0, suggestIdx)]);
      return;
    }
    const q = queryInput.trim();
    if (!q) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const results = await geocode(q, 1);
      const hit = results[0];
      if (!hit) {
        setSearchErr('No result');
        return;
      }
      pickSuggestion(hit);
    } catch {
      setSearchErr('Search failed');
    } finally {
      setSearching(false);
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestIdx((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
    }
  }

  async function flash(label: string) {
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  }

  async function onCopyUrl() {
    const url = `${window.location.origin}${window.location.pathname}?${encodeState(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      flash('url');
    } catch {
      window.prompt('Copy this URL', url);
    }
  }
  async function onCopyStyleJson() {
    const json = mapRef.current?.getStyleJson();
    if (!json) return;
    const text = JSON.stringify(json, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      flash('json');
    } catch {
      // ignore
    }
  }
  async function onDownloadStyleJson() {
    const json = mapRef.current?.getStyleJson();
    if (!json) return;
    download(`tilecraft-${state.presetId}.json`, JSON.stringify(json, null, 2), 'application/json');
  }
  async function onDownloadPng() {
    const blob = await mapRef.current?.exportPng();
    if (!blob) return;
    download(`tilecraft-${state.presetId}.png`, blob, 'image/png');
  }

  function embedUrl(): string {
    const qs = encodeState(state);
    const sep = qs ? '&' : '';
    return `${window.location.origin}${window.location.pathname}?${qs}${sep}embed=1`;
  }
  function webflowSnippet(): string {
    const w = embedWidth || '100%';
    const h = /^\d+$/.test(embedHeight) ? `${embedHeight}px` : embedHeight;
    return `<iframe
  src="${embedUrl()}"
  style="width:${w};height:${h};border:0;border-radius:8px;"
  loading="lazy"
  allowfullscreen
></iframe>`;
  }
  function framerSnippet(): string {
    return `// Tilecraft — paste as a new Code Component in Framer
import { addPropertyControls, ControlType } from "framer"

export default function TilecraftMap({ src, radius }) {
    return (
        <iframe
            src={src}
            style={{
                width: "100%",
                height: "100%",
                border: 0,
                borderRadius: radius,
            }}
            loading="lazy"
            allowFullScreen
        />
    )
}

TilecraftMap.defaultProps = { width: 600, height: 400 }

addPropertyControls(TilecraftMap, {
    src: {
        type: ControlType.String,
        title: "Map URL",
        defaultValue:
            "${embedUrl()}",
    },
    radius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 8,
        min: 0,
        max: 64,
        step: 1,
    },
})`;
  }
  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(label);
    } catch {
      window.prompt('Copy', text);
    }
  }

  const g: GlobalAdjust = state.overrides.global;
  const isLocal = typeof window !== 'undefined' && /^(localhost|127\.|0\.0\.0\.0)/.test(window.location.hostname);

  if (embed) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <MapCanvas
          ref={mapRef}
          styleKey={current.id}
          style={current.style}
          overrides={state.overrides}
          pitch={state.pitch}
          bearing={state.bearing}
          terrain3d={state.terrain3d}
          terrainExaggeration={state.terrainExaggeration}
          markers={state.markers}
          placementMode={false}
          geojsonOverlay={geojsonOverlay}
          drawMode="none"
          drawPoints={[]}
          initialCenter={[state.lng, state.lat]}
          initialZoom={state.zoom}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapCanvas
        ref={mapRef}
        styleKey={current.id}
        style={current.style}
        overrides={state.overrides}
        pitch={state.pitch}
        bearing={state.bearing}
        terrain3d={state.terrain3d}
        terrainExaggeration={state.terrainExaggeration}
        markers={state.markers}
        placementMode={placementMode}
        onPlace={addMarkerAt}
        onMarkerMove={(id, lng, lat) => updateMarker(id, { lng, lat })}
        geojsonOverlay={geojsonOverlay}
        drawMode={drawMode}
        drawPoints={drawPoints}
        onDrawPoint={onMapDrawClick}
        initialCenter={[state.lng, state.lat]}
        initialZoom={state.zoom}
      />

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          bottom: 16,
          zIndex: 10,
          width: 340,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255,255,255,0.97)',
          borderRadius: 14,
          boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
          border: '1px solid rgba(0,0,0,0.06)',
          font: '14px var(--font-sans, system-ui), sans-serif',
          color: '#18181b',
          backdropFilter: 'blur(6px)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #f4f4f5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <TilecraftLogo />
            <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Tilecraft</h1>
              <span style={{ fontSize: 9, fontWeight: 600, color: '#a1a1aa', letterSpacing: '0.14em' }}>BETA</span>
            </div>
            <button
              type="button"
              onClick={handleSaveCurrent}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                border: '1px solid #e4e4e7',
                background: '#fff',
                color: '#3f3f46',
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              }}
              title="Save the current state as a named style"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                border: '1px solid #e4e4e7',
                background: '#fff',
                color: '#3f3f46',
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="Open the style gallery"
            >
              <span style={{ fontSize: 13 }}>▤</span> Browse
            </button>
          </div>
          <form onSubmit={onSearch} style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: 10,
                top: 16,
                color: '#a1a1aa',
                fontSize: 13,
                pointerEvents: 'none',
              }}
            >
              ⌕
            </span>
            <input
              type="text"
              value={queryInput}
              onChange={(e) => { setQueryInput(e.target.value); setSuggestOpen(true); }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search an address…"
              style={{ ...inputStyle, paddingLeft: 30, paddingRight: 56, width: '100%' }}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={searching}
              style={{
                position: 'absolute',
                right: 4,
                top: '50%',
                transform: 'translateY(-50%)',
                padding: '5px 10px',
                borderRadius: 6,
                border: 'none',
                background: '#18181b',
                color: '#fff',
                font: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {searching ? '…' : 'Go'}
            </button>

            {suggestOpen && suggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  zIndex: 20,
                  background: '#fff',
                  border: '1px solid #e4e4e7',
                  borderRadius: 10,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.16)',
                  overflow: 'hidden',
                  maxHeight: 320,
                  overflowY: 'auto',
                }}
              >
                {suggestions.map((s, i) => {
                  const parts = s.label.split(', ');
                  const primary = parts[0];
                  const secondary = parts.slice(1).join(', ');
                  return (
                    <button
                      key={`${s.lng},${s.lat},${i}`}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                      onMouseEnter={() => setSuggestIdx(i)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        background: i === suggestIdx ? '#f4f4f5' : '#fff',
                        border: 'none',
                        borderBottom: i < suggestions.length - 1 ? '1px solid #f4f4f5' : 'none',
                        padding: '9px 12px',
                        font: 'inherit',
                        cursor: 'pointer',
                        color: '#18181b',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ color: '#a1a1aa', fontSize: 11, flexShrink: 0 }}>⌖</span>
                        <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {primary}
                        </span>
                        {s.type && (
                          <span style={{ fontSize: 10, color: '#a1a1aa', textTransform: 'capitalize', flexShrink: 0 }}>
                            · {s.type}
                          </span>
                        )}
                      </div>
                      {secondary && (
                        <div style={{ fontSize: 11, color: '#71717a', marginLeft: 17, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {secondary}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </form>
          {searchErr && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{searchErr}</div>}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f4f4f5' }}>
          {(['presets', 'layers', 'markers', 'data', 'view', 'export'] as Tab[]).map((t) => {
            const disabled = t === 'layers' && current.kind === 'raster';
            return (
              <button
                key={t}
                type="button"
                onClick={() => !disabled && setTab(t)}
                disabled={disabled}
                style={{
                  flex: 1,
                  padding: '9px 8px',
                  border: 'none',
                  background: 'transparent',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                  textTransform: 'capitalize',
                  color: disabled ? '#d4d4d8' : tab === t ? '#18181b' : '#a1a1aa',
                  fontWeight: tab === t ? 600 : 400,
                  borderBottom: tab === t && !disabled ? '2px solid #18181b' : '2px solid transparent',
                }}
                title={disabled ? 'Per-layer overrides only apply to vector basemaps' : undefined}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {tab === 'presets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <button
                type="button"
                onClick={() => setGalleryOpen(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #18181b',
                  background: '#18181b',
                  color: '#fff',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <span>Browse all {PRESETS.length} styles</span>
                <span style={{ opacity: 0.7 }}>→</span>
              </button>
              {(['styled', 'imagery'] as const).map((section) => (
                <div key={section}>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: '#71717a',
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    {section === 'styled' ? 'Styled vector' : 'Imagery & terrain'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                    {PRESETS.filter((p) => p.section === section).map((p) => {
                      const active = p.id === state.presetId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectPreset(p.id)}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: active ? '2px solid #18181b' : '1px solid #e4e4e7',
                            background: active ? '#18181b' : '#fff',
                            color: active ? '#fff' : '#3f3f46',
                            font: 'inherit',
                            fontSize: 13,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <PresetSwatch preset={p} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'layers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Section
                title="Global tint"
                right={
                  <button type="button" onClick={() => patchOverrides({ global: { ...DEFAULT_GLOBAL } })} style={mutedBtn}>
                    Reset
                  </button>
                }
              >
                <Slider label="Hue" value={g.hue} min={-180} max={180} step={1} unit="°"
                  onChange={(v) => patchOverrides({ global: { ...g, hue: v } })} />
                <Slider label="Saturation" value={g.saturation} min={-100} max={100} step={1} unit=""
                  onChange={(v) => patchOverrides({ global: { ...g, saturation: v } })} />
                <Slider label="Lightness" value={g.lightness} min={-100} max={100} step={1} unit=""
                  onChange={(v) => patchOverrides({ global: { ...g, lightness: v } })} />
              </Section>

              <Section
                title="Layers"
                right={
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" onClick={resetToPreset} style={mutedBtn}>Preset</button>
                    <button type="button" onClick={resetAll} style={mutedBtn}>Clear</button>
                  </div>
                }
              >
                {CATEGORIES.map((cat) => (
                  <CategoryRow
                    key={cat.id}
                    label={cat.label}
                    color={state.overrides.colors[cat.id]}
                    opacity={state.overrides.opacity[cat.id] ?? 1}
                    hidden={state.overrides.hidden[cat.id] ?? false}
                    onColor={(c) => setCategoryColor(cat.id, c)}
                    onClearColor={() => clearCategoryColor(cat.id)}
                    onOpacity={(v) => setCategoryOpacity(cat.id, v)}
                    onToggleHide={() => toggleHide(cat.id)}
                  />
                ))}
              </Section>
            </div>
          )}

          {tab === 'markers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setPlacementMode((v) => !v)}
                  style={{
                    ...primaryBtn,
                    background: placementMode ? '#dc2626' : '#18181b',
                    flex: 1,
                  }}
                >
                  {placementMode ? 'Click map to place… (cancel)' : '+ Add marker'}
                </button>
                <label
                  style={{
                    position: 'relative',
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: '1px solid #e4e4e7',
                    background: nextMarkerColor,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title="Color for next marker"
                >
                  <input
                    type="color"
                    value={nextMarkerColor}
                    onChange={(e) => setNextMarkerColor(e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                  />
                </label>
              </div>

              {placementMode && (
                <div style={{ fontSize: 12, color: '#52525b', lineHeight: 1.45 }}>
                  Click anywhere on the map to drop a pin. Markers are draggable after placement.
                </div>
              )}

              {state.markers.length === 0 ? (
                <div
                  style={{
                    padding: '14px 12px',
                    borderRadius: 8,
                    background: '#fafafa',
                    border: '1px dashed #d4d4d8',
                    color: '#71717a',
                    fontSize: 13,
                    textAlign: 'center',
                  }}
                >
                  No markers yet. Hit <b>+ Add marker</b> above.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {state.markers.map((m, i) => (
                    <MarkerRow
                      key={m.id}
                      marker={m}
                      index={i + 1}
                      onLabel={(label) => updateMarker(m.id, { label })}
                      onColor={(color) => updateMarker(m.id, { color })}
                      onIcon={(icon) => updateMarker(m.id, { icon })}
                      onRemove={() => removeMarker(m.id)}
                      onCenter={() => mapRef.current?.flyTo(m.lng, m.lat)}
                    />
                  ))}
                  <button type="button" onClick={clearMarkers} style={mutedBtn}>
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'data' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Section title="Draw on the map">
                {drawMode === 'none' ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => startDraw('polygon')} style={{ ...primaryBtn, flex: 1 }}>
                      Polygon
                    </button>
                    <button type="button" onClick={() => startDraw('line')} style={{ ...primaryBtn, flex: 1 }}>
                      Line
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{
                      fontSize: 12, color: '#52525b',
                      background: '#f0f9ff', border: '1px solid #bae6fd',
                      padding: '8px 10px', borderRadius: 6, lineHeight: 1.45,
                    }}>
                      Drawing <b>{drawMode}</b> — click on the map to add vertices.
                      {drawMode === 'polygon' && ' Need at least 3.'}
                      {' '}({drawPoints.length} placed)
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={finishDraw}
                        disabled={drawPoints.length < (drawMode === 'polygon' ? 3 : 2)}
                        style={{
                          ...primaryBtn,
                          flex: 1,
                          opacity: drawPoints.length < (drawMode === 'polygon' ? 3 : 2) ? 0.5 : 1,
                        }}
                      >
                        Finish ({drawPoints.length})
                      </button>
                      <button type="button" onClick={cancelDraw} style={mutedBtn}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Section>

              <Section
                title="GeoJSON overlay"
                right={
                  geojsonText ? (
                    <button type="button" onClick={() => setGeojsonText('')} style={mutedBtn}>
                      Clear
                    </button>
                  ) : null
                }
              >
                <textarea
                  value={geojsonText}
                  onChange={(e) => setGeojsonText(e.target.value)}
                  placeholder='Paste a GeoJSON FeatureCollection (or any GeoJSON object). Polygons, lines, and points all render.'
                  rows={8}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    font: '11px ui-monospace, Menlo, monospace',
                    color: '#18181b',
                    background: '#fff',
                    border: `1px solid ${geojsonErr ? '#fca5a5' : '#e4e4e7'}`,
                    borderRadius: 6,
                    padding: 8,
                    outline: 'none',
                    lineHeight: 1.5,
                    minHeight: 120,
                  }}
                />
                {geojsonErr && (
                  <div style={{ fontSize: 11, color: '#dc2626' }}>{geojsonErr}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label
                    style={{
                      position: 'relative',
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border: '1px solid #e4e4e7',
                      background: geojsonColor,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <input
                      type="color"
                      value={geojsonColor}
                      onChange={(e) => setGeojsonColor(e.target.value)}
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                    />
                  </label>
                  <div style={{ flex: 1, fontSize: 12, color: '#52525b' }}>Color</div>
                </div>
                <Slider label="Opacity" value={geojsonOpacity} min={0} max={1} step={0.05} unit=""
                  onChange={setGeojsonOpacity} />
                <Slider label="Stroke width" value={geojsonStroke} min={0} max={10} step={0.5} unit="px"
                  onChange={setGeojsonStroke} />
                <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.45 }}>
                  Stored locally — not in the share URL (GeoJSON can be huge). Markers + preset state still travel via URL.
                </div>
                {!geojsonText && (
                  <button
                    type="button"
                    onClick={() => setGeojsonText(SAMPLE_GEOJSON)}
                    style={mutedBtn}
                  >
                    Load sample
                  </button>
                )}
              </Section>
            </div>
          )}

          {tab === 'view' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Section title="Camera">
                <Slider
                  label="Pitch"
                  value={state.pitch}
                  min={0}
                  max={state.terrain3d ? 85 : 60}
                  step={1}
                  unit="°"
                  onChange={(v) => update('pitch', v)}
                />
                <Slider label="Bearing" value={state.bearing} min={-180} max={180} step={1} unit="°"
                  onChange={(v) => update('bearing', v)} />
              </Section>
              <Section title="Density">
                <Slider label="Labels & POIs" value={state.overrides.density} min={0} max={1} step={0.05} unit=""
                  onChange={(v) => patchOverrides({ density: v })} />
                <Slider label="Road detail" value={state.overrides.roadDetail ?? 0} min={0} max={4} step={1} unit=""
                  onChange={(v) => patchOverrides({ roadDetail: v })} />
                <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.4 }}>
                  Pulls minor roads down to lower zooms — useful when minor roads are missing
                  at city zoom (common in sparse OSM regions, e.g. parts of India).
                </div>
              </Section>
              <Section title="3D">
                <ToggleRow
                  label="3D terrain"
                  hint="Real elevation from AWS terrarium DEM — works on any preset (needs pitch)"
                  on={state.terrain3d}
                  onChange={(v) => {
                    if (v && state.pitch < 30) {
                      setState((s) => ({ ...s, terrain3d: true, pitch: 60 }));
                    } else {
                      update('terrain3d', v);
                    }
                  }}
                />
                {state.terrain3d && (
                  <Slider
                    label="Exaggeration"
                    value={state.terrainExaggeration}
                    min={0.5}
                    max={3}
                    step={0.1}
                    unit="×"
                    onChange={(v) => update('terrainExaggeration', v)}
                  />
                )}
                <ToggleRow
                  label="3D buildings"
                  hint={current.kind === 'raster' ? 'Vector basemap required' : 'Extruded buildings, visible at zoom 14+'}
                  on={state.overrides.buildings3d}
                  onChange={(v) => patchOverrides({ buildings3d: v })}
                />
              </Section>
            </div>
          )}

          {tab === 'export' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Section title="Import from Snazzymaps">
                <div style={{ fontSize: 12, color: '#52525b', lineHeight: 1.45 }}>
                  Paste your legacy Google Maps / Snazzymaps style array — we'll transpile colors and visibility into Tilecraft layers.
                </div>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='[{"featureType":"water","stylers":[{"color":"#3b3b3b"}]}, …]'
                  rows={6}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    font: '11px ui-monospace, Menlo, monospace',
                    color: '#18181b',
                    background: '#fff',
                    border: '1px solid #e4e4e7',
                    borderRadius: 6,
                    padding: 8,
                    outline: 'none',
                    minHeight: 100,
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={runImport} style={{ ...primaryBtn, flex: 1 }} disabled={!importText.trim()}>
                    Import & apply
                  </button>
                  <button type="button" onClick={() => { setImportText(''); setImportResult(null); }} style={mutedBtn}>
                    Clear
                  </button>
                </div>
                {importResult && (
                  <div style={{
                    fontSize: 12,
                    background: importResult.appliedRules > 0 ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${importResult.appliedRules > 0 ? '#bbf7d0' : '#fecaca'}`,
                    color: importResult.appliedRules > 0 ? '#166534' : '#991b1b',
                    padding: '8px 10px',
                    borderRadius: 6,
                    lineHeight: 1.5,
                  }}>
                    <div style={{ fontWeight: 600 }}>
                      Applied {importResult.appliedRules} rule{importResult.appliedRules === 1 ? '' : 's'}
                      {importResult.skippedRules > 0 && `, skipped ${importResult.skippedRules}`}
                    </div>
                    {importResult.notes.map((n, i) => (
                      <div key={i} style={{ marginTop: 2 }}>{n}</div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Share / files">
                <ExportBtn label="Copy share URL" onClick={onCopyUrl} done={copied === 'url'} />
                <ExportBtn label="Copy MapLibre style JSON" onClick={onCopyStyleJson} done={copied === 'json'} />
                <ExportBtn label="Download style.json" onClick={onDownloadStyleJson} />
                <ExportBtn label="Download PNG screenshot" onClick={onDownloadPng} />
              </Section>

              <Section title="Embed">
                <div style={{ display: 'flex', gap: 6 }}>
                  <SizeInput label="W" value={embedWidth} onChange={setEmbedWidth} />
                  <SizeInput label="H" value={embedHeight} onChange={setEmbedHeight} />
                </div>

                <SnippetBox
                  title="Webflow"
                  hint="Drop a 'Custom code embed' element on your page, paste this."
                  text={webflowSnippet()}
                  onCopy={() => copyText(webflowSnippet(), 'webflow')}
                  copied={copied === 'webflow'}
                />

                <SnippetBox
                  title="Framer"
                  hint="In Framer: Insert → Code Component → New, paste this code."
                  text={framerSnippet()}
                  onCopy={() => copyText(framerSnippet(), 'framer')}
                  copied={copied === 'framer'}
                />

                {isLocal && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#92400e',
                      background: '#fef3c7',
                      border: '1px solid #fde68a',
                      padding: '8px 10px',
                      borderRadius: 6,
                      lineHeight: 1.45,
                    }}
                  >
                    Heads up: embed URL points to <code>{typeof window !== 'undefined' ? window.location.origin : ''}</code>.
                    Deploy Tilecraft (e.g. Vercel) and the same snippet will work everywhere — no code change needed.
                  </div>
                )}
              </Section>
            </div>
          )}
        </div>
      </div>

      {/* Floating map controls (top-right) */}
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn?.()}
        onZoomOut={() => mapRef.current?.zoomOut?.()}
        onResetBearing={() => mapRef.current?.setBearing(0)}
      />

      <PresetGalleryModal
        open={galleryOpen}
        activeId={state.presetId}
        onSelect={selectPreset}
        onClose={() => setGalleryOpen(false)}
        savedStyles={savedStyles}
        onSelectSaved={(s) => { setGalleryOpen(false); applySavedStyle(s); }}
        onDeleteSaved={(id) => { deleteSavedStyle(id); refreshSavedStyles(); }}
      />
    </div>
  );
}

// ---------- Sub-components ----------

function TilecraftLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2" y="2" width="9" height="9" rx="2" fill="#18181b" />
      <rect x="13" y="2" width="9" height="9" rx="2" fill="#3b82f6" />
      <rect x="2" y="13" width="9" height="9" rx="2" fill="#22c55e" />
      <rect x="13" y="13" width="9" height="9" rx="2" fill="#f59e0b" />
    </svg>
  );
}

function MapControls({
  onZoomIn, onZoomOut, onResetBearing,
}: { onZoomIn: () => void; onZoomOut: () => void; onResetBearing: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <CtrlBtn label="Zoom in" onClick={onZoomIn}>+</CtrlBtn>
      <CtrlBtn label="Zoom out" onClick={onZoomOut}>−</CtrlBtn>
      <CtrlBtn label="Reset bearing" onClick={onResetBearing}>◎</CtrlBtn>
    </div>
  );
}

function CtrlBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      style={{
        width: 36, height: 36,
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(255,255,255,0.96)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        color: '#18181b',
        cursor: 'pointer',
        font: '17px var(--font-sans, system-ui), sans-serif',
        backdropFilter: 'blur(4px)',
      }}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#71717a',
            fontWeight: 600,
          }}
        >
          {title}
        </div>
        {right}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#52525b' }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#18181b' }}>
          {value.toFixed(step < 1 ? 2 : 0)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#18181b' }}
      />
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        background: on ? '#f4f4f5' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange(!on); }}
        role="switch"
        aria-checked={on}
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          border: 'none',
          background: on ? '#22c55e' : '#d4d4d8',
          padding: 0,
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
          boxShadow: on ? '0 0 0 0px rgba(34, 197, 94, 0.2)' : 'inset 0 1px 2px rgba(0,0,0,0.08)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: 2,
            display: 'block',
            width: 18,
            height: 18,
            background: '#fff',
            borderRadius: '50%',
            transform: on ? 'translateX(18px)' : 'translateX(0)',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 13, color: '#18181b', fontWeight: 500 }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: '#71717a', lineHeight: 1.4 }}>{hint}</span>}
      </div>
    </div>
  );
}

function EyeIcon({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {on ? (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      )}
    </svg>
  );
}

function CategoryRow({
  label,
  color,
  opacity,
  hidden,
  onColor,
  onClearColor,
  onOpacity,
  onToggleHide,
}: {
  label: string;
  color: string | undefined;
  opacity: number;
  hidden: boolean;
  onColor: (c: string) => void;
  onClearColor: () => void;
  onOpacity: (v: number) => void;
  onToggleHide: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        background: expanded ? '#fafafa' : 'transparent',
        opacity: hidden ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px' }}>
        <label
          style={{
            position: 'relative',
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid #e4e4e7',
            cursor: 'pointer',
            background: color ?? 'repeating-conic-gradient(#e4e4e7 0% 25%, #fff 0% 50%) 50% / 12px 12px',
            overflow: 'hidden',
            flexShrink: 0,
          }}
          title="Pick color"
        >
          <input
            type="color"
            value={color ?? '#3b82f6'}
            onChange={(e) => onColor(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </label>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            flex: 1,
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 13,
            color: '#18181b',
            padding: 0,
          }}
        >
          {label}
        </button>
        {color && (
          <button
            type="button"
            onClick={onClearColor}
            style={{ ...mutedBtn, padding: '4px 6px', display: 'inline-flex', alignItems: 'center' }}
            title="Reset color to preset default"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v6h6" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onToggleHide}
          style={{
            ...mutedBtn,
            padding: '4px 6px',
            color: hidden ? '#a1a1aa' : '#18181b',
            background: hidden ? '#fafafa' : '#fff',
            display: 'inline-flex',
            alignItems: 'center',
          }}
          title={hidden ? 'Show this layer' : 'Hide this layer'}
        >
          <EyeIcon on={!hidden} />
        </button>
      </div>
      {expanded && (
        <div style={{ padding: '4px 8px 8px 38px' }}>
          <Slider label="Opacity" value={opacity} min={0} max={1} step={0.05} unit="" onChange={onOpacity} />
        </div>
      )}
    </div>
  );
}

function SizeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
      <span style={{ fontSize: 11, color: '#71717a', width: 14, textAlign: 'center' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, padding: '6px 8px', fontSize: 13 }}
      />
    </label>
  );
}

function SnippetBox({
  title,
  hint,
  text,
  onCopy,
  copied,
}: {
  title: string;
  hint: string;
  text: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        border: '1px solid #e4e4e7',
        borderRadius: 8,
        padding: 8,
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b' }}>{title}</div>
        <button
          type="button"
          onClick={onCopy}
          style={{
            ...mutedBtn,
            background: copied ? '#16a34a' : '#fff',
            color: copied ? '#fff' : '#18181b',
            borderColor: copied ? '#16a34a' : '#e4e4e7',
          }}
        >
          {copied ? '✓ copied' : 'Copy'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 2 }}>{hint}</div>
      <textarea
        readOnly
        value={text}
        onFocus={(e) => e.target.select()}
        rows={6}
        style={{
          width: '100%',
          resize: 'vertical',
          font: '11px ui-monospace, Menlo, monospace',
          color: '#18181b',
          background: '#fff',
          border: '1px solid #e4e4e7',
          borderRadius: 6,
          padding: 8,
          outline: 'none',
          lineHeight: 1.5,
          minHeight: 80,
        }}
      />
    </div>
  );
}

function iconToText(icon: MarkerIcon | undefined): string {
  if (!icon || icon.type === 'pin') return '';
  if (icon.type === 'emoji') return icon.value;
  return icon.url;
}
function textToIcon(text: string): MarkerIcon | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t) || /^data:image\//i.test(t)) {
    return { type: 'image', url: t };
  }
  return { type: 'emoji', value: t };
}

function MarkerRow({
  marker,
  index,
  onLabel,
  onColor,
  onIcon,
  onRemove,
  onCenter,
}: {
  marker: MarkerSpec;
  index: number;
  onLabel: (s: string) => void;
  onColor: (s: string) => void;
  onIcon: (i: MarkerIcon | undefined) => void;
  onRemove: () => void;
  onCenter: () => void;
}) {
  const [iconText, setIconText] = useState(iconToText(marker.icon));
  useEffect(() => { setIconText(iconToText(marker.icon)); }, [marker.icon]);
  const usingPin = !marker.icon || marker.icon.type === 'pin';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        borderRadius: 8,
        border: '1px solid #e4e4e7',
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label
          style={{
            position: 'relative',
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid #d4d4d8',
            background: marker.color,
            cursor: 'pointer',
            flexShrink: 0,
            opacity: usingPin ? 1 : 0.45,
          }}
          title={usingPin ? 'Pin color' : 'Background color (image markers only)'}
        >
          <input
            type="color"
            value={marker.color}
            onChange={(e) => onColor(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </label>
        <input
          type="text"
          value={marker.label ?? ''}
          onChange={(e) => onLabel(e.target.value)}
          placeholder={`Marker ${index} label`}
          style={{ ...inputStyle, padding: '5px 8px', fontSize: 13 }}
        />
        <button type="button" onClick={onCenter} style={mutedBtn} title="Center on this marker">
          ⌖
        </button>
        <button type="button" onClick={onRemove} style={{ ...mutedBtn, color: '#dc2626' }} title="Remove">
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#71717a', width: 30, textAlign: 'right' }}>icon</span>
        <input
          type="text"
          value={iconText}
          onChange={(e) => {
            setIconText(e.target.value);
            onIcon(textToIcon(e.target.value));
          }}
          placeholder="🍕  or  https://…/pin.png   (blank = default pin)"
          style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
        />
      </div>
      <div style={{ fontSize: 11, color: '#a1a1aa', fontVariantNumeric: 'tabular-nums', paddingLeft: 36 }}>
        {marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}
      </div>
    </div>
  );
}

function ExportBtn({ label, onClick, done }: { label: string; onClick: () => void; done?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid #e4e4e7',
        background: done ? '#16a34a' : '#fff',
        color: done ? '#fff' : '#18181b',
        font: 'inherit',
        fontSize: 13,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {done ? '✓ Copied' : label}
    </button>
  );
}

const RASTER_SWATCH: Record<string, [string, string, string]> = {
  satellite:        ['#2c4a2b', '#1c3e5b', '#7ba87a'],
  hybrid:           ['#2c4a2b', '#1c3e5b', '#ffd24d'],
  topo:             ['#e8d9b0', '#a6cde0', '#8a7c5b'],
  'terrain-shaded': ['#bda47a', '#7d9aa7', '#5a4a30'],
  natgeo:           ['#d9c79b', '#b6d6dd', '#896f48'],
  'streets-arcgis': ['#f4ecda', '#c9d6e2', '#c2864b'],
};

function PresetSwatch({ preset }: { preset: Preset }) {
  let land: string, water: string, accent: string;
  if (preset.kind === 'raster') {
    const sw = RASTER_SWATCH[preset.id] ?? ['#666', '#888', '#bbb'];
    [land, water, accent] = sw;
  } else {
    const isDark = typeof preset.style === 'string' && preset.style.includes('dark-matter');
    land = preset.overrides.colors.land ?? (isDark ? '#1a1a1a' : '#fafafa');
    water = preset.overrides.colors.water ?? (isDark ? '#0e1626' : '#a6cde0');
    accent = preset.overrides.colors.roads_major
      ?? preset.overrides.colors.roads_highway
      ?? (isDark ? '#333' : '#fff');
  }
  return (
    <div
      style={{
        width: 28,
        height: 18,
        borderRadius: 4,
        background: `linear-gradient(135deg, ${land} 0%, ${land} 55%, ${water} 55%, ${water} 100%)`,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '60%',
          left: 0,
          right: 0,
          height: 2,
          background: accent,
          transform: 'rotate(-12deg)',
        }}
      />
    </div>
  );
}

// ---------- Shared styles ----------

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid #e4e4e7',
  background: '#fff',
  font: 'inherit',
  color: '#18181b',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: '#18181b',
  color: '#fff',
  font: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
};

const mutedBtn: React.CSSProperties = {
  padding: '3px 7px',
  borderRadius: 6,
  border: '1px solid #e4e4e7',
  background: '#fff',
  color: '#52525b',
  font: 'inherit',
  fontSize: 11,
  cursor: 'pointer',
};
