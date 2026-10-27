/*
  Look (colours + fonts of the app around the documents) and accent colour, chosen in Settings.
  A look is a set of CSS tokens in styles.css ([data-look]); an accent is five shades set here.
  Every accent is checked (WCAG contrast) to work in every look:
    accent  – fills with white text on top: ≥ 4.6:1, and still visible as a fill on Midnight's dark columns (≥ 3:1)
    text    – accent used as text on white and on its own soft tint: ≥ 4.6:1
    light   – accent used as text or icons on dark surfaces: ≥ 4.8:1
    soft    – tinted backgrounds (chips, selected cards)
    hover   – pressed/hovered fills
  The choice is a per-device preference, so it lives in localStorage and is applied before React renders.
*/
export type LookId = 'graphite' | 'slate' | 'midnight';
export type AccentId = keyof typeof ACCENTS;

export const LOOKS: Record<LookId, { name: string; note: string; font: string; side: string; bg: string; paper: string }> = {
  graphite: { name: 'Graphite', note: 'Neutral greys, Inter. Calm and familiar.', font: 'Inter', side: '#eceef1', bg: '#f4f5f7', paper: '#ffffff' },
  slate: { name: 'Slate', note: 'Cool slate, IBM Plex. Precise and technical.', font: 'IBM Plex Sans', side: '#e9edf1', bg: '#f2f4f6', paper: '#fbfcfd' },
  midnight: { name: 'Midnight', note: 'Dark side columns, bright workspace, Geist.', font: 'Geist Sans', side: '#14161b', bg: '#f6f6f8', paper: '#ffffff' },
};

export const ACCENTS = {
  cobalt:   { name: 'Cobalt',   accent: '#2f5bea', text: '#2f5bea', hover: '#2950ce', soft: '#e6ebfc', light: '#6686f0' },
  violet:   { name: 'Violet',   accent: '#634be1', text: '#634be1', hover: '#5742c6', soft: '#ece9fb', light: '#8c7ae9' },
  teal:     { name: 'Teal',     accent: '#0f7f84', text: '#0e7478', hover: '#0d7074', soft: '#e2f0f0', light: '#3d989c' },
  green:    { name: 'Green',    accent: '#1c8048', text: '#1a7844', hover: '#19713f', soft: '#e4f0e9', light: '#4d9b70' },
  rose:     { name: 'Rose',     accent: '#cf2f61', text: '#bd2b59', hover: '#b62955', soft: '#f9e6ec', light: '#db6187' },
  orange:   { name: 'Orange',   accent: '#c4520c', text: '#ae490b', hover: '#ac480b', soft: '#f8eae2', light: '#cf733b' },
  graphite: { name: 'Graphite', accent: '#5d6573', text: '#5d6573', hover: '#525965', soft: '#ecedee', light: '#848a94' },
};

export interface Appearance { look: LookId; accent: AccentId }
export const DEFAULT_APPEARANCE: Appearance = { look: 'graphite', accent: 'green' };
const KEY = 'easy-apply.appearance';

export function loadAppearance(): Appearance {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Appearance>;
    return { look: a.look && a.look in LOOKS ? a.look : DEFAULT_APPEARANCE.look, accent: a.accent && a.accent in ACCENTS ? a.accent : DEFAULT_APPEARANCE.accent };
  } catch { return DEFAULT_APPEARANCE; }
}

export function applyAppearance(a: Appearance, save = false) {
  const root = document.documentElement;
  const c = ACCENTS[a.accent];
  root.dataset.look = a.look;
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--accent-text', c.text);
  root.style.setProperty('--accent-hover', c.hover);
  root.style.setProperty('--accent-soft', c.soft);
  root.style.setProperty('--accent-light', c.light);
  // the window frame of the installed app follows the title bar
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', LOOKS[a.look].side);
  if (save) try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode: applies for this visit only */ }
}
