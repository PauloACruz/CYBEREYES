import {
  createTheme,
  defaultVariantColorsResolver,
  Title,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core';

// Tema PCruzTI: preto e dourado. Valores do design system (colors_and_type.css).

/** Escala dourada; o indice 4 (#E2B622) e o dourado principal. */
const gold: MantineColorsTuple = [
  '#FFF8E1',
  '#FCEEB6',
  '#F7DE7E',
  '#F0CB45',
  '#E2B622',
  '#C99A11',
  '#A37A09',
  '#8A6708',
  '#6E5208',
  '#3A2B05',
];

/** Tons de tinta do design system, do texto (0) ao fundo (9). */
const dark: MantineColorsTuple = [
  '#E6E6E6',
  '#B5B5B5',
  '#8A8A8A',
  '#5A5A5A',
  '#3A3A3A',
  '#2E2E2E',
  '#1A1A1A',
  '#121212',
  '#0A0A0A',
  '#000000',
];

/** Preenchimento dourado leva texto escuro (#1A1300): branco sobre dourado nao tem contraste. */
const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  const color = input.color ?? input.theme.primaryColor;
  if (input.variant === 'filled' && (color === 'gold' || color.startsWith('gold.'))) {
    return { ...colors, color: '#1A1300' };
  }
  return colors;
};

export const theme = createTheme({
  variantColorResolver,
  primaryColor: 'gold',
  primaryShade: { light: 6, dark: 4 },
  colors: { gold, dark },
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', xl: '20px' },
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "SF Mono", "Cascadia Code", monospace',
  headings: {
    fontFamily: 'Oswald, "Bebas Neue", Impact, sans-serif',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '32px', lineHeight: '1.05', fontWeight: '700' },
      h2: { fontSize: '28px', lineHeight: '1.1', fontWeight: '700' },
      h3: { fontSize: '22px', lineHeight: '1.25' },
      h4: { fontSize: '18px', lineHeight: '1.3' },
    },
  },
  components: {
    // Titulos de pagina e secao em caixa alta, como a marca; niveis menores ficam em Inter.
    Title: Title.extend({
      styles: (_theme, props) => ({
        root:
          (props.order ?? 1) <= 2
            ? { textTransform: 'uppercase', letterSpacing: '0.01em' }
            : { fontFamily: 'var(--mantine-font-family)', fontWeight: 700 },
      }),
    }),
  },
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-body': '#000000',
    '--mantine-color-text': '#E6E6E6',
    '--mantine-color-dimmed': '#8A8A8A',
    '--mantine-color-default': '#1A1A1A',
    '--mantine-color-default-hover': '#232323',
    '--mantine-color-default-border': '#2E2E2E',
    '--mantine-color-placeholder': '#8A8A8A',
  },
});
