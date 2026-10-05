import { Box, Image, UnstyledButton } from '@mantine/core';

const EASE = '320ms cubic-bezier(0.22, 1, 0.36, 1)';

// A aguia com asas ocupa a faixa toda; ao recolher, ela encolhe ate a cabeca coincidir
// com o emblema (28px), que aparece no lugar. As escalas vem das proporcoes dos arquivos.
const WINGS = { open: 'translate(-50%, -50%) translate(0px, 11px) scale(1)', closed: 'translate(-50%, -50%) scale(0.362)' };
const EMBLEM = { open: 'translate(-50%, -50%) translate(0px, 12px) scale(2.76)', closed: 'translate(-50%, -50%) scale(1)' };

interface BrandToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  /** No menu do celular o logo nao recolhe o menu. */
  interactive?: boolean;
}

/** Logo no topo do menu: com asas quando aberto, so o emblema quando recolhido. */
export function BrandToggle({ collapsed, onToggle, interactive = true }: BrandToggleProps) {
  const label = collapsed ? 'Expandir menu (CYBEREYES)' : 'Recolher menu (CYBEREYES)';
  const images = (
    <>
      <Image
        src="/brand/cybereyes-logo-asas.webp"
        alt=""
        w={190}
        h={190}
        fit="contain"
        pos="absolute"
        top="50%"
        left="50%"
        style={{
          transform: collapsed ? WINGS.closed : WINGS.open,
          opacity: collapsed ? 0 : 1,
          transition: `transform ${EASE}, opacity 220ms ease-out`,
          pointerEvents: 'none',
        }}
      />
      <Image
        src="/brand/cybereyes-emblema-branco.png"
        alt=""
        h={28}
        w="auto"
        pos="absolute"
        top="50%"
        left="50%"
        style={{
          transform: collapsed ? EMBLEM.closed : EMBLEM.open,
          opacity: collapsed ? 1 : 0,
          transition: `transform ${EASE}, opacity 260ms ease-out`,
          pointerEvents: 'none',
        }}
      />
    </>
  );
  const style = {
    position: 'relative',
    display: 'block',
    flexShrink: 0,
    width: '100%',
    height: collapsed ? 56 : 120,
    overflow: 'hidden',
    borderRadius: 15,
    border: '1px solid var(--ce-border-subtle)',
    backgroundColor: '#0a0c0e',
    boxShadow: 'var(--ce-shadow-md)',
    transition: `height ${EASE}`,
  } as const;

  if (!interactive) {
    return (
      <Box style={style} role="img" aria-label="CYBEREYES">
        {images}
      </Box>
    );
  }
  return (
    <UnstyledButton onClick={onToggle} aria-label={label} aria-expanded={!collapsed} title={label} style={style}>
      {images}
    </UnstyledButton>
  );
}
