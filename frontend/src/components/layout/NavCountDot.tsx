import { Box, VisuallyHidden } from '@mantine/core';

/** Ponto colorido que substitui o contador quando o menu esta recolhido. */
export function NavCountDot({ color, label }: { color: string; label: string }) {
  return (
    <Box component="span" pos="absolute" top={-3} right={-4} w={8} h={8} style={{ borderRadius: 9999, backgroundColor: color }}>
      <VisuallyHidden>{label}</VisuallyHidden>
    </Box>
  );
}
