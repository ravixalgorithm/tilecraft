'use client';

import { useEffect, useMemo, useState } from 'react';
import { PRESETS, type Preset, type PresetTag } from '../styles/presets';
import { type SavedStyle } from '../lib/saved-styles';

const ALL_TAGS: PresetTag[] = ['light', 'dark', 'mono', 'colorful', 'vintage', 'minimal', 'satellite', 'terrain', 'streets'];

type Props = {
  open: boolean;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  savedStyles?: SavedStyle[];
  onSelectSaved?: (s: SavedStyle) => void;
  onDeleteSaved?: (id: string) => void;
};

export default function PresetGalleryModal({
  open, activeId, onSelect, onClose,
  savedStyles = [], onSelectSaved, onDeleteSaved,
}: Props) {
  const [tag, setTag] = useState<PresetTag | 'all'>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PRESETS.filter((p) => {
      if (tag !== 'all' && !(p.tags ?? []).includes(tag)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q) ||
        (p.tags ?? []).some((t) => t.includes(q))
      );
    });
  }, [tag, query]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 15, 17, 0.6)',
        backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32,
        font: '14px var(--font-sans, system-ui), sans-serif',
        animation: 'tc-fade 180ms ease-out',
      }}
    >
      <style>{`@keyframes tc-fade { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          width: 'min(1100px, 100%)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
          color: '#18181b',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f4f4f5', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
              Style gallery
            </h2>
            <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
              {PRESETS.length} styles · hover a card to preview · click to apply
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search styles…"
              style={{
                width: 220,
                padding: '8px 12px 8px 32px',
                borderRadius: 8,
                border: '1px solid #e4e4e7',
                font: 'inherit',
                fontSize: 13,
                outline: 'none',
                color: '#18181b',
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#a1a1aa', fontSize: 14 }}>
              ⌕
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32, height: 32, padding: 0, borderRadius: 8,
              border: '1px solid #e4e4e7', background: '#fff',
              cursor: 'pointer', color: '#71717a', font: 'inherit', fontSize: 18,
            }}
          >
            ×
          </button>
        </div>

        {/* Tag bar */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid #f4f4f5', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <TagChip active={tag === 'all'} onClick={() => setTag('all')}>All</TagChip>
          {ALL_TAGS.map((t) => (
            <TagChip key={t} active={tag === t} onClick={() => setTag(t)}>
              {t}
            </TagChip>
          ))}
        </div>

        {/* Saved styles section */}
        {savedStyles.length > 0 && tag === 'all' && !query && (
          <div style={{ padding: '14px 22px 0', background: '#fafafa' }}>
            <div
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#71717a',
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              My saved styles
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 14,
              marginBottom: 6,
            }}>
              {savedStyles.map((s) => (
                <SavedStyleCard
                  key={s.id}
                  saved={s}
                  onClick={() => onSelectSaved?.(s)}
                  onDelete={() => onDeleteSaved?.(s.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Grid */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
            background: '#fafafa',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: '#71717a' }}>
              No styles match those filters.
            </div>
          ) : (
            filtered.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                active={p.id === activeId}
                onClick={() => {
                  onSelect(p.id);
                  onClose();
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TagChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 11px',
        borderRadius: 999,
        border: '1px solid ' + (active ? '#18181b' : '#e4e4e7'),
        background: active ? '#18181b' : '#fff',
        color: active ? '#fff' : '#52525b',
        font: 'inherit',
        fontSize: 12,
        textTransform: 'capitalize',
        cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s, border 0.12s',
      }}
    >
      {children}
    </button>
  );
}

function PresetCard({ preset, active, onClick }: { preset: Preset; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: 0,
        background: '#fff',
        border: active ? '2px solid #18181b' : '1px solid #e4e4e7',
        borderRadius: 12,
        cursor: 'pointer',
        font: 'inherit',
        color: '#18181b',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.15s, box-shadow 0.15s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 10px 20px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
      }}
    >
      <BigSwatch preset={preset} />
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{preset.name}</span>
          {active && (
            <span
              style={{
                fontSize: 10,
                background: '#18181b',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}
            >
              ACTIVE
            </span>
          )}
        </div>
        {preset.description && (
          <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.45 }}>{preset.description}</div>
        )}
        {(preset.tags?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {preset.tags?.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 10,
                  color: '#52525b',
                  background: '#f4f4f5',
                  padding: '2px 6px',
                  borderRadius: 999,
                  textTransform: 'capitalize',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function SavedStyleCard({
  saved, onClick, onDelete,
}: { saved: SavedStyle; onClick: () => void; onDelete: () => void }) {
  const c = saved.preview ?? {};
  const land = c.land ?? '#fafafa';
  const water = c.water ?? '#a6cde0';
  const roads = c.roads ?? '#fff';
  const ageMs = Date.now() - saved.savedAt;
  const ageDays = Math.floor(ageMs / 86400000);
  const age = ageDays === 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays}d ago`;
  return (
    <div
      style={{
        position: 'relative',
        background: '#fff',
        border: '1px solid #e4e4e7',
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          textAlign: 'left',
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          font: 'inherit',
          color: '#18181b',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          position: 'relative',
          height: 120,
          background: `linear-gradient(135deg, ${land} 0%, ${land} 55%, ${water} 55%, ${water} 100%)`,
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '60%',
            height: 2.5, background: roads, transform: 'rotate(-12deg)', opacity: 0.9,
          }} />
        </div>
        <div style={{ padding: '10px 12px' }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2, paddingRight: 22 }}>
            {saved.name}
          </div>
          <div style={{ fontSize: 11, color: '#a1a1aa' }}>Saved {age}</div>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`Delete saved style "${saved.name}"?`)) onDelete();
        }}
        title="Delete"
        style={{
          position: 'absolute',
          top: 8, right: 8,
          width: 24, height: 24,
          borderRadius: 6,
          border: 'none',
          background: 'rgba(255,255,255,0.92)',
          color: '#71717a',
          cursor: 'pointer',
          font: '14px var(--font-sans, system-ui), sans-serif',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        ×
      </button>
    </div>
  );
}

const RASTER_SWATCH_BG: Record<string, string> = {
  satellite:        'linear-gradient(135deg, #2d4a2b 0%, #3a5e3c 30%, #1f3a4c 60%, #1c2e3e 100%)',
  hybrid:           'linear-gradient(135deg, #2d4a2b 0%, #3a5e3c 30%, #1f3a4c 60%, #d4af37 100%)',
  topo:             'linear-gradient(135deg, #d6c89e 0%, #b89d6e 40%, #8aa0a8 100%)',
  'terrain-shaded': 'linear-gradient(135deg, #b89568 0%, #7f8e94 50%, #4a5359 100%)',
  natgeo:           'linear-gradient(135deg, #d9c79b 0%, #b6d6dd 40%, #896f48 100%)',
  'streets-arcgis': 'linear-gradient(135deg, #f4ecda 0%, #c9d6e2 60%, #c2864b 100%)',
};

function BigSwatch({ preset }: { preset: Preset }) {
  let bg: string;
  let accents: string[] = [];
  if (preset.kind === 'raster') {
    bg = RASTER_SWATCH_BG[preset.id] ?? 'linear-gradient(135deg, #777 0%, #aaa 100%)';
  } else {
    const isDark = typeof preset.style === 'string' && preset.style.includes('dark-matter');
    const land = preset.overrides.colors.land ?? (isDark ? '#1a1a1a' : '#fafafa');
    const water = preset.overrides.colors.water ?? (isDark ? '#0e1626' : '#a6cde0');
    const park = preset.overrides.colors.parks ?? (isDark ? '#0d2417' : '#dbe5c4');
    bg = `linear-gradient(135deg, ${land} 0%, ${land} 38%, ${park} 38%, ${park} 50%, ${water} 50%, ${water} 100%)`;
    const highway = preset.overrides.colors.roads_highway;
    const major = preset.overrides.colors.roads_major;
    if (highway) accents.push(highway);
    if (major && major !== highway) accents.push(major);
  }
  return (
    <div
      style={{
        position: 'relative',
        height: 120,
        background: bg,
        overflow: 'hidden',
      }}
    >
      {/* Diagonal road lines */}
      {accents[0] && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '55%',
          height: 3, background: accents[0],
          transform: 'rotate(-14deg) translateY(-50%)',
          opacity: 0.9,
        }} />
      )}
      {accents[1] && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '70%',
          height: 2, background: accents[1],
          transform: 'rotate(-14deg) translateY(-50%)',
          opacity: 0.7,
        }} />
      )}
      {/* Subtle grid texture */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        pointerEvents: 'none',
      }} />
    </div>
  );
}
