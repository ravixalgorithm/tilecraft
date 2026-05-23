'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import maplibregl, {
  type Map as MapLibreMap,
  type Marker as MapLibreMarker,
  type StyleSpecification,
} from 'maplibre-gl';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../styles/presets';
import {
  applyOverrides,
  snapshotOriginalColors,
  snapshotOriginalMinZooms,
  type OriginalColors,
  type OriginalMinZooms,
  type Overrides,
} from '../styles/categories';

const BUILDING_3D_LAYER_ID = '__tilecraft_3d_buildings';
const TERRAIN_SOURCE_ID = '__tilecraft_terrain';
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const OVERLAY_SOURCE_ID = '__tilecraft_overlay';
const OVERLAY_FILL_ID = '__tilecraft_overlay_fill';
const OVERLAY_LINE_ID = '__tilecraft_overlay_line';
const OVERLAY_CIRCLE_ID = '__tilecraft_overlay_circle';
const DRAW_SOURCE_ID = '__tilecraft_draw';
const DRAW_LINE_ID = '__tilecraft_draw_line';
const DRAW_FILL_ID = '__tilecraft_draw_fill';
const DRAW_VERTEX_ID = '__tilecraft_draw_vertex';

export type DrawMode = 'none' | 'polygon' | 'line';

export type MapApi = {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
  setPitch: (pitch: number) => void;
  setBearing: (bearing: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getStyleJson: () => StyleSpecification | null;
  exportPng: () => Promise<Blob | null>;
};

export type MarkerIcon =
  | { type: 'pin' }
  | { type: 'emoji'; value: string }
  | { type: 'image'; url: string };

export type MarkerSpec = {
  id: string;
  lng: number;
  lat: number;
  color: string;
  label?: string;
  icon?: MarkerIcon;
};

export type GeoJsonOverlay = {
  geojson: GeoJSON.GeoJSON;
  color: string;
  opacity: number;
  strokeWidth: number;
};

type Props = {
  /** Style key — must change when the underlying style identity changes; used to drive map rebuild. */
  styleKey: string;
  style: string | StyleSpecification;
  overrides: Overrides;
  pitch: number;
  bearing: number;
  terrain3d: boolean;
  terrainExaggeration: number;
  markers: MarkerSpec[];
  placementMode: boolean;
  onPlace?: (lng: number, lat: number) => void;
  onMarkerMove?: (id: string, lng: number, lat: number) => void;
  geojsonOverlay: GeoJsonOverlay | null;
  drawMode: DrawMode;
  drawPoints: Array<[number, number]>;
  onDrawPoint?: (lng: number, lat: number) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
};

function tryAdd3dBuildings(map: MapLibreMap) {
  if (map.getLayer(BUILDING_3D_LAYER_ID)) return;
  const style = map.getStyle();
  if (!style?.layers) return;
  const existing = style.layers.find((l) => {
    if (!('source-layer' in l)) return false;
    const sl = (l['source-layer'] as string | undefined)?.toLowerCase() ?? '';
    return sl === 'building' || sl === 'buildings';
  });
  if (!existing || !('source' in existing) || !('source-layer' in existing)) return;
  try {
    map.addLayer({
      id: BUILDING_3D_LAYER_ID,
      type: 'fill-extrusion',
      source: existing.source as string,
      'source-layer': existing['source-layer'] as string,
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#9ca3af',
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          14, 0,
          16, ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.6,
      },
    });
  } catch {
    // ignore
  }
}

function remove3dBuildings(map: MapLibreMap) {
  if (map.getLayer(BUILDING_3D_LAYER_ID)) {
    try { map.removeLayer(BUILDING_3D_LAYER_ID); } catch { /* */ }
  }
}

function enableTerrain(map: MapLibreMap, exaggeration: number) {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    try {
      map.addSource(TERRAIN_SOURCE_ID, {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 15,
        attribution: 'Elevation: AWS Open Data — terrarium',
      });
    } catch {
      // ignore
    }
  }
  try {
    map.setMaxPitch(85);
  } catch { /* */ }
  const apply = () => {
    try {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[terrain] setTerrain failed', e);
    }
  };
  const source = map.getSource(TERRAIN_SOURCE_ID) as unknown as { loaded?: () => boolean } | undefined;
  if (source?.loaded?.()) {
    apply();
  } else {
    let done = false;
    const handler = () => {
      if (done) return;
      const s = map.getSource(TERRAIN_SOURCE_ID) as unknown as { loaded?: () => boolean } | undefined;
      if (s?.loaded?.()) {
        done = true;
        map.off('sourcedata', handler);
        apply();
      }
    };
    map.on('sourcedata', handler);
    // Apply immediately too — MapLibre tolerates an unloaded DEM and updates when ready
    apply();
  }
}

function disableTerrain(map: MapLibreMap) {
  try { map.setTerrain(null); } catch { /* */ }
  try { map.setMaxPitch(60); } catch { /* */ }
  if (map.getSource(TERRAIN_SOURCE_ID)) {
    try { map.removeSource(TERRAIN_SOURCE_ID); } catch { /* */ }
  }
}

function removeOverlay(map: MapLibreMap) {
  for (const id of [OVERLAY_FILL_ID, OVERLAY_LINE_ID, OVERLAY_CIRCLE_ID]) {
    if (map.getLayer(id)) {
      try { map.removeLayer(id); } catch { /* */ }
    }
  }
  if (map.getSource(OVERLAY_SOURCE_ID)) {
    try { map.removeSource(OVERLAY_SOURCE_ID); } catch { /* */ }
  }
}

function buildDrawFeatureCollection(mode: DrawMode, points: Array<[number, number]>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (points.length >= 2) {
    if (mode === 'polygon') {
      // Show as a line connecting current vertices + a closing dashed line back to start
      const ring = [...points];
      features.push({
        type: 'Feature',
        properties: { kind: 'edge' },
        geometry: { type: 'LineString', coordinates: ring },
      });
      if (ring.length >= 3) {
        features.push({
          type: 'Feature',
          properties: { kind: 'close' },
          geometry: { type: 'LineString', coordinates: [ring[ring.length - 1], ring[0]] },
        });
        features.push({
          type: 'Feature',
          properties: { kind: 'fill' },
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        });
      }
    } else if (mode === 'line') {
      features.push({
        type: 'Feature',
        properties: { kind: 'edge' },
        geometry: { type: 'LineString', coordinates: points },
      });
    }
  }
  // Vertex points
  for (const p of points) {
    features.push({
      type: 'Feature',
      properties: { kind: 'vertex' },
      geometry: { type: 'Point', coordinates: p },
    });
  }
  return { type: 'FeatureCollection', features };
}

function removeDrawPreview(map: MapLibreMap) {
  for (const id of [DRAW_FILL_ID, DRAW_LINE_ID, DRAW_VERTEX_ID]) {
    if (map.getLayer(id)) {
      try { map.removeLayer(id); } catch { /* */ }
    }
  }
  if (map.getSource(DRAW_SOURCE_ID)) {
    try { map.removeSource(DRAW_SOURCE_ID); } catch { /* */ }
  }
}

function applyDrawPreview(map: MapLibreMap, mode: DrawMode, points: Array<[number, number]>) {
  if (mode === 'none' || points.length === 0) {
    removeDrawPreview(map);
    return;
  }
  const data = buildDrawFeatureCollection(mode, points);
  const existing = map.getSource(DRAW_SOURCE_ID) as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined;
  if (existing && typeof existing.setData === 'function') {
    existing.setData(data);
    return;
  }
  try {
    map.addSource(DRAW_SOURCE_ID, { type: 'geojson', data });
    map.addLayer({
      id: DRAW_FILL_ID,
      type: 'fill',
      source: DRAW_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'fill'],
      paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.18 },
    });
    map.addLayer({
      id: DRAW_LINE_ID,
      type: 'line',
      source: DRAW_SOURCE_ID,
      filter: ['in', ['get', 'kind'], ['literal', ['edge', 'close']]],
      paint: {
        'line-color': '#3b82f6',
        'line-width': 2.5,
        'line-dasharray': ['case', ['==', ['get', 'kind'], 'close'], ['literal', [2, 2]], ['literal', [1, 0]]],
      },
    });
    map.addLayer({
      id: DRAW_VERTEX_ID,
      type: 'circle',
      source: DRAW_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'vertex'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#fff',
        'circle-stroke-color': '#18181b',
        'circle-stroke-width': 2,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[draw] preview failed', e);
  }
}

function applyOverlay(map: MapLibreMap, overlay: GeoJsonOverlay | null) {
  removeOverlay(map);
  if (!overlay) return;
  try {
    map.addSource(OVERLAY_SOURCE_ID, { type: 'geojson', data: overlay.geojson });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[overlay] addSource failed', e);
    return;
  }
  const { color, opacity, strokeWidth } = overlay;
  try {
    map.addLayer({
      id: OVERLAY_FILL_ID,
      type: 'fill',
      source: OVERLAY_SOURCE_ID,
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: { 'fill-color': color, 'fill-opacity': opacity * 0.4, 'fill-outline-color': color },
    });
    map.addLayer({
      id: OVERLAY_LINE_ID,
      type: 'line',
      source: OVERLAY_SOURCE_ID,
      filter: ['any',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['geometry-type'], 'MultiLineString'],
        ['==', ['geometry-type'], 'Polygon'],
        ['==', ['geometry-type'], 'MultiPolygon'],
      ],
      paint: { 'line-color': color, 'line-opacity': opacity, 'line-width': strokeWidth },
    });
    map.addLayer({
      id: OVERLAY_CIRCLE_ID,
      type: 'circle',
      source: OVERLAY_SOURCE_ID,
      filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
      paint: {
        'circle-color': color,
        'circle-opacity': opacity,
        'circle-radius': Math.max(3, strokeWidth * 2),
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[overlay] addLayer failed', e);
  }
}

const MapCanvas = forwardRef<MapApi, Props>(function MapCanvas(
  {
    styleKey,
    style,
    overrides,
    pitch,
    bearing,
    terrain3d,
    terrainExaggeration,
    markers,
    placementMode,
    onPlace,
    onMarkerMove,
    geojsonOverlay,
    drawMode,
    drawPoints,
    onDrawPoint,
    initialCenter,
    initialZoom,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const originalColorsRef = useRef<OriginalColors>(new Map());
  const originalMinZoomsRef = useRef<OriginalMinZooms>(new Map());
  const overridesRef = useRef(overrides);
  const terrain3dRef = useRef(terrain3d);
  const terrainExRef = useRef(terrainExaggeration);
  const styleLoadedRef = useRef(false);
  const markersMapRef = useRef<Map<string, { mk: MapLibreMarker; signature: string }>>(new Map());
  const markersRef = useRef<MarkerSpec[]>(markers);
  const onPlaceRef = useRef(onPlace);
  const onMoveRef = useRef(onMarkerMove);
  const placementModeRef = useRef(placementMode);
  const overlayRef = useRef<GeoJsonOverlay | null>(geojsonOverlay);
  const drawModeRef = useRef<DrawMode>(drawMode);
  const onDrawPointRef = useRef(onDrawPoint);

  useEffect(() => { onPlaceRef.current = onPlace; }, [onPlace]);
  useEffect(() => { onMoveRef.current = onMarkerMove; }, [onMarkerMove]);
  useEffect(() => { placementModeRef.current = placementMode; }, [placementMode]);
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { overlayRef.current = geojsonOverlay; }, [geojsonOverlay]);
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { onDrawPointRef.current = onDrawPoint; }, [onDrawPoint]);

  const markerSignature = (m: MarkerSpec): string => {
    const i = m.icon;
    const iconSig = !i || i.type === 'pin'
      ? `p:${m.color}`
      : i.type === 'emoji'
        ? `e:${i.value}`
        : `i:${i.url}`;
    return iconSig;
  };

  const buildIconElement = (icon: MarkerIcon, color: string): HTMLDivElement | null => {
    if (icon.type === 'pin') return null;
    const el = document.createElement('div');
    el.style.cursor = 'pointer';
    el.style.transform = 'translateY(-50%)';
    if (icon.type === 'emoji') {
      el.textContent = icon.value;
      el.style.fontSize = '32px';
      el.style.lineHeight = '32px';
      el.style.textAlign = 'center';
      el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))';
    } else {
      el.style.width = '36px';
      el.style.height = '36px';
      el.style.borderRadius = '50%';
      el.style.background = `${color} center/cover no-repeat`;
      el.style.backgroundImage = `url("${icon.url.replace(/"/g, '\\"')}")`;
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
      el.style.border = '2px solid #fff';
    }
    return el;
  };

  const createMarker = (map: MapLibreMap, spec: MarkerSpec): MapLibreMarker => {
    const icon: MarkerIcon = spec.icon ?? { type: 'pin' };
    let mk: MapLibreMarker;
    if (icon.type === 'pin') {
      mk = new maplibregl.Marker({ color: spec.color, draggable: true });
    } else {
      const el = buildIconElement(icon, spec.color);
      mk = el
        ? new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
        : new maplibregl.Marker({ color: spec.color, draggable: true });
    }
    mk.setLngLat([spec.lng, spec.lat]).addTo(map);
    if (spec.label) {
      mk.setPopup(new maplibregl.Popup({ offset: 24 }).setText(spec.label));
    }
    mk.on('dragend', () => {
      const { lng, lat } = mk.getLngLat();
      onMoveRef.current?.(spec.id, lng, lat);
    });
    return mk;
  };

  const reconcileMarkers = (map: MapLibreMap) => {
    const current = markersMapRef.current;
    const list = markersRef.current;
    const incoming = new Set(list.map((m) => m.id));
    for (const [id, entry] of current) {
      if (!incoming.has(id)) {
        entry.mk.remove();
        current.delete(id);
      }
    }
    for (const spec of list) {
      const sig = markerSignature(spec);
      const existing = current.get(spec.id);
      if (existing) {
        if (existing.signature !== sig) {
          // Pin/icon/color changed — must rebuild
          existing.mk.remove();
          const mk = createMarker(map, spec);
          current.set(spec.id, { mk, signature: sig });
        } else {
          existing.mk.setLngLat([spec.lng, spec.lat]);
          if (spec.label) {
            existing.mk.setPopup(new maplibregl.Popup({ offset: 24 }).setText(spec.label));
          } else {
            existing.mk.setPopup(undefined);
          }
        }
      } else {
        const mk = createMarker(map, spec);
        current.set(spec.id, { mk, signature: sig });
      }
    }
  };
  const [err, setErr] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom) {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: [lng, lat], zoom: zoom ?? map.getZoom(), essential: true });
    },
    setPitch(p) { mapRef.current?.setPitch(p); },
    setBearing(b) { mapRef.current?.setBearing(b); },
    zoomIn() { mapRef.current?.zoomIn(); },
    zoomOut() { mapRef.current?.zoomOut(); },
    getStyleJson() {
      const map = mapRef.current;
      if (!map) return null;
      return map.getStyle() as StyleSpecification;
    },
    exportPng() {
      const map = mapRef.current;
      return new Promise<Blob | null>((resolve) => {
        if (!map) return resolve(null);
        map.once('idle', () => {
          const canvas = map.getCanvas();
          canvas.toBlob((b) => resolve(b), 'image/png');
        });
        map.triggerRepaint();
      });
    },
  }), []);

  // Build map when styleKey changes
  useEffect(() => {
    if (!containerRef.current) return;
    setErr(null);
    styleLoadedRef.current = false;

    let map: MapLibreMap | undefined;
    try {
      const ctr =
        initialCenter && Number.isFinite(initialCenter[0]) && Number.isFinite(initialCenter[1])
          ? initialCenter
          : DEFAULT_CENTER;
      const zm = Number.isFinite(initialZoom) ? (initialZoom as number) : DEFAULT_ZOOM;
      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: ctr,
        zoom: zm,
        pitch: Number.isFinite(pitch) ? pitch : 0,
        bearing: Number.isFinite(bearing) ? bearing : 0,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      map.on('load', () => {
        if (!mapRef.current) return;
        styleLoadedRef.current = true;
        originalColorsRef.current = snapshotOriginalColors(mapRef.current);
        originalMinZoomsRef.current = snapshotOriginalMinZooms(mapRef.current);
        if (overridesRef.current.buildings3d) tryAdd3dBuildings(mapRef.current);
        applyOverrides(mapRef.current, overridesRef.current, originalColorsRef.current, originalMinZoomsRef.current);
        if (terrain3dRef.current) enableTerrain(mapRef.current, terrainExRef.current);
        applyOverlay(mapRef.current, overlayRef.current);
        applyDrawPreview(mapRef.current, drawModeRef.current, drawPoints);
        reconcileMarkers(mapRef.current);
      });
      map.on('error', (e: { error?: Error }) => {
        const msg = e?.error?.message ?? String(e?.error ?? 'unknown');
        // eslint-disable-next-line no-console
        console.error('[map error]', e);
        setErr(msg);
      });

      map.on('click', (e) => {
        if (drawModeRef.current !== 'none' && onDrawPointRef.current) {
          onDrawPointRef.current(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        if (placementModeRef.current && onPlaceRef.current) {
          onPlaceRef.current(e.lngLat.lng, e.lngLat.lat);
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error('[init error]', e);
      setErr(msg);
    }

    return () => {
      mapRef.current = null;
      originalColorsRef.current = new Map();
      originalMinZoomsRef.current = new Map();
      styleLoadedRef.current = false;
      // map.remove() destroys all attached Markers — drop our refs so they're rebuilt on next load
      markersMapRef.current.clear();
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  // Re-apply overrides whenever they change
  useEffect(() => {
    overridesRef.current = overrides;
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (overrides.buildings3d) tryAdd3dBuildings(map);
    else remove3dBuildings(map);
    applyOverrides(map, overrides, originalColorsRef.current, originalMinZoomsRef.current);
  }, [overrides]);

  useEffect(() => {
    mapRef.current?.setPitch(pitch);
  }, [pitch]);
  useEffect(() => {
    mapRef.current?.setBearing(bearing);
  }, [bearing]);

  useEffect(() => {
    terrain3dRef.current = terrain3d;
    terrainExRef.current = terrainExaggeration;
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (terrain3d) enableTerrain(map, terrainExaggeration);
    else disableTerrain(map);
  }, [terrain3d, terrainExaggeration]);

  // Reconcile markers on prop change (only after style load)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    reconcileMarkers(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  // Apply GeoJSON overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    applyOverlay(map, geojsonOverlay);
  }, [geojsonOverlay]);

  // Apply draw preview
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    applyDrawPreview(map, drawMode, drawPoints);
  }, [drawMode, drawPoints]);

  // Cursor and double-click zoom toggle for placement mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = placementMode || drawMode !== 'none' ? 'crosshair' : '';
  }, [placementMode, drawMode]);

  // Tear down all markers on unmount
  useEffect(() => {
    const m = markersMapRef.current;
    return () => {
      for (const entry of m.values()) entry.mk.remove();
      m.clear();
    };
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {err && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 50,
            maxWidth: 420,
            background: '#dc2626',
            color: 'white',
            padding: '8px 12px',
            borderRadius: 6,
            font: '12px ui-monospace, Menlo, monospace',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Map error</div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{err}</div>
        </div>
      )}
    </>
  );
});

export default MapCanvas;
