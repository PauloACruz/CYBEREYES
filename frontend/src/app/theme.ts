import {
  createTheme,
  defaultVariantColorsResolver,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core';

// Tema CYBEREYES: valores do design system (tokens.json). O escuro e o tema principal.
// Os tokens semanticos tambem ficam como variaveis CSS em cybereyes.css (--ce-*).

/** Escala dourada; o indice 5 (#daa916) e o brand-gold. */
const gold: MantineColorsTuple = [
  '#fff8e0',
  '#fdeeb3',
  '#fbe07f',
  '#fdc104',
  '#e8b512',
  '#daa916',
  '#c4970f',
  '#a17b0b',
  '#7f5f00',
  '#4d3a00',
];

/** Neutros do tema escuro: texto (0) ate o fundo da pagina (7). */
const dark: MantineColorsTuple = [
  '#f1f2ee',
  '#c9ccd1',
  '#a4aab3',
  '#8d939d',
  '#666d78',
  '#22262c',
  '#131418',
  '#0a0c0e',
  '#1b1e23',
  '#050608',
];

const SANS = '"Space Grotesk Variable", "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Preenchimento dourado leva on-accent (#131418): branco sobre dourado nao tem contraste. */
const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  const color = input.color ?? input.theme.primaryColor;
  if (input.variant === 'filled' && (color === 'gold' || color.startsWith('gold.'))) {
    return { ...colors, color: '#131418', hover: 'var(--ce-accent-hover)' };
  }
  return colors;
};

export const theme = createTheme({
  variantColorResolver,
  primaryColor: 'gold',
  primaryShade: { light: 5, dark: 5 },
  colors: { gold, dark },
  defaultRadius: 'sm',
  // A marca e angular: 2px em selos, 4px em controles, 8px em cards e modais.
  radius: { xs: '2px', sm: '4px', md: '8px', lg: '8px', xl: '12px' },
  fontFamily: SANS,
  fontFamilyMonospace: MONO,
  headings: {
    fontFamily: SANS,
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '28px', lineHeight: '36px' },
      h2: { fontSize: '20px', lineHeight: '28px' },
      h3: { fontSize: '16px', lineHeight: '24px' },
      h4: { fontSize: '14px', lineHeight: '20px' },
    },
  },
  components: {
    Card: { defaultProps: { radius: 'md' } },
    Paper: { defaultProps: { radius: 'md' } },
    Modal: { defaultProps: { radius: 'md' } },
    Badge: { defaultProps: { radius: 'xs' } },
  },
});

/** Cores de status do design system nas variantes light e filled do Mantine. */
const STATUS = {
  teal: ['#3ccfb4', 'rgba(60, 207, 180, 0.14)', '#096d5b', 'rgba(9, 109, 91, 0.12)'],
  green: ['#3ccfb4', 'rgba(60, 207, 180, 0.14)', '#096d5b', 'rgba(9, 109, 91, 0.12)'],
  orange: ['#ff9f43', 'rgba(255, 159, 67, 0.14)', '#974a00', 'rgba(151, 74, 0, 0.12)'],
  red: ['#ff7e73', 'rgba(255, 126, 115, 0.14)', '#ae3126', 'rgba(174, 49, 38, 0.12)'],
  blue: ['#6cb4ff', 'rgba(108, 180, 255, 0.14)', '#1d5ab0', 'rgba(29, 90, 176, 0.12)'],
} as const;

function statusVars(mode: 'dark' | 'light'): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, [darkText, darkSoft, lightText, lightSoft]] of Object.entries(STATUS)) {
    vars[`--mantine-color-${name}-light-color`] = mode === 'dark' ? darkText : lightText;
    vars[`--mantine-color-${name}-light`] = mode === 'dark' ? darkSoft : lightSoft;
    vars[`--mantine-color-${name}-text`] = mode === 'dark' ? darkText : lightText;
  }
  return vars;
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    ...statusVars('light'),
    '--mantine-color-body': '#f8f9f6',
    '--mantine-color-text': '#131418',
    '--mantine-color-dimmed': '#555b65',
    '--mantine-color-placeholder': '#5f656f',
    '--mantine-color-default': '#ffffff',
    '--mantine-color-default-hover': '#eef0ec',
    '--mantine-color-default-border': '#dde0e4',
    '--mantine-color-anchor': '#7f5f00',
    '--mantine-color-gold-light-color': '#7f5f00',
    '--mantine-color-gold-light': 'rgba(218, 169, 22, 0.16)',
  },
  dark: {
    ...statusVars('dark'),
    '--mantine-color-body': '#0a0c0e',
    '--mantine-color-text': '#f1f2ee',
    '--mantine-color-dimmed': '#a4aab3',
    '--mantine-color-placeholder': '#8d939d',
    '--mantine-color-default': '#131418',
    '--mantine-color-default-hover': '#22262c',
    '--mantine-color-default-border': '#24282f',
    '--mantine-color-anchor': '#daa916',
    '--mantine-color-gold-light-color': '#daa916',
    '--mantine-color-gold-light': 'rgba(218, 169, 22, 0.14)',
  },
});
