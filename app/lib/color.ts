export type RGB = [number, number, number];
export type HSL = [number, number, number];

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  transparent: 'rgba(0,0,0,0)',
};

export function parseColor(input: string): RGB | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  const named = NAMED[s];
  if (named) return parseColor(named);

  const hex = s.match(/^#([\da-f]{3}|[\da-f]{6})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  const rgb = s.match(/^rgba?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
  if (rgb) {
    return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];
  }

  const hsl = s.match(/^hsla?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%?\s*,\s*(\d+(?:\.\d+)?)%/);
  if (hsl) {
    return hslToRgb(parseFloat(hsl[1]), parseFloat(hsl[2]), parseFloat(hsl[3]));
  }

  return null;
}

export function rgbToHex(rgb: RGB): string {
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const H = (((h % 360) + 360) % 360) / 360;
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  if (S === 0) return [L * 255, L * 255, L * 255];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  return [
    hue2rgb(p, q, H + 1 / 3) * 255,
    hue2rgb(p, q, H) * 255,
    hue2rgb(p, q, H - 1 / 3) * 255,
  ];
}

export function shiftHsl(input: string, dH: number, dS: number, dL: number): string {
  const rgb = parseColor(input);
  if (!rgb) return input;
  const [h, s, l] = rgbToHsl(rgb);
  return rgbToHex(hslToRgb(h + dH, s + dS, l + dL));
}
