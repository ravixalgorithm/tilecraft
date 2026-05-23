const KEY = 'tilecraft.saved-styles';

export type SavedStyle = {
  id: string;
  name: string;
  savedAt: number;
  /** URL search string (no leading ?) capturing the editor state — what we already encode for share URLs. */
  query: string;
  /** Captured at save time for the thumbnail preview. */
  preview?: { land?: string; water?: string; roads?: string };
};

function read(): SavedStyle[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s): s is SavedStyle =>
        s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.query === 'string',
    );
  } catch {
    return [];
  }
}

function write(list: SavedStyle[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // quota or disabled — ignore
  }
}

export function listSavedStyles(): SavedStyle[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

function freshId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function saveStyle(
  name: string,
  query: string,
  preview?: SavedStyle['preview'],
): SavedStyle {
  const list = read();
  const style: SavedStyle = { id: freshId(), name: name.trim() || 'Untitled', savedAt: Date.now(), query, preview };
  list.unshift(style);
  write(list);
  return style;
}

export function deleteSavedStyle(id: string): void {
  write(read().filter((s) => s.id !== id));
}

export function renameSavedStyle(id: string, name: string): void {
  write(read().map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)));
}
