/**
 * BRAND: the one place to change name, logo, colors and product copy.
 *
 * To rebrand: edit this file. Nothing else in the app hard-codes
 * the name or a color: CSS reads the tokens below as custom properties and the
 * 3D scene reads `brand.scene`.
 */
export const brand = {
  name: 'PromptGrass',
  tagline: 'Read your ground.',
  pitch: 'Push two probes into the soil. In minutes, see your plot alive, and know what to plant, when, and whether it needs water.',

  /** Inline SVG path for the mark (24x24 viewBox). A drop that is also a seed. */
  logoPath:
    'M12 2.5c3.4 4.2 6 7.300 6 10.700a6 6 0 1 1-12 0c0-3.400 2.600-6.500 6-10.700zm0 6.200c-1.500 2.100-2.500 3.600-2.500 5a2.500 2.500 0 0 0 2.500 2.500',

  /** UI tokens -> CSS custom properties (see applyBrand). */
  colors: {
    bg: '#080c0a',
    bgGlow: '#15251b',
    panel: 'rgba(13, 19, 15, 0.72)',
    panelSolid: '#0f1612',
    transcript: '#14171b',
    line: 'rgba(255, 255, 255, 0.09)',
    text: '#eef3ea',
    textDim: 'rgba(238, 243, 234, 0.62)',
    textFaint: 'rgba(238, 243, 234, 0.52)',
    accent: '#b6f36a', // growth
    accentInk: '#10200a',
    water: '#5cc8ff',
    warm: '#ffb454',
    cool: '#7fb4ff',
    agent: '#a596ff', // the AI's color: anything violet on screen is the agent
    danger: '#ff7161',
  },

  fonts: {
    display: "'Fraunces Variable', 'Iowan Old Style', Georgia, serif",
    ui: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace",
  },

  /** Colors used inside the 3D scene (linear-ish sRGB hex). */
  scene: {
    probeBoard: '#151918',
    probeInk: '#eeeade',
    probeSteel: '#c4d2d8',
    probeCable: '#171b1a',
    probeRed: '#b94638',
    probeYellow: '#d1ab48',
    soilUnknown: '#655e50',
    soilDry: '#8d7d68',
    soilWet: '#2b2117',
    soilSub: '#6b5138',
    soilDeep: '#3a2a1e',
    sproutAlive: '#9be05a',
    sproutDead: '#7a6a48',
    water: '#3aa8ff',
    warm: '#ff9a3c',
    cool: '#4f8dff',
    agent: '#a596ff',
    blueprint: '#0d2a26',
    blueprintLine: '#5fffd0',
  },
} as const;

export function applyBrand(): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(brand.colors)) {
    root.style.setProperty(`--${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`, v);
  }
  root.style.setProperty('--font-display', brand.fonts.display);
  root.style.setProperty('--font-ui', brand.fonts.ui);
  root.style.setProperty('--font-mono', brand.fonts.mono);
  document.title = `${brand.name} · ${brand.tagline}`;
}
