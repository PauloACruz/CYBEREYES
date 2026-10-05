import { Group, Image, Text, useComputedColorScheme } from '@mantine/core';

interface BrandMarkProps {
  /** Altura do emblema, em px (28 na navegacao). */
  size?: number;
  /** Tamanho do nome, em px (16 na navegacao, 32 no login). */
  nameSize?: number;
}

/** Emblema da aguia com o nome CYBEREYES. O emblema troca de arquivo conforme o tema. */
export function BrandMark({ size = 28, nameSize = 16 }: BrandMarkProps) {
  const scheme = useComputedColorScheme('dark');
  const src = scheme === 'dark' ? '/brand/cybereyes-emblema-branco.png' : '/brand/cybereyes-emblema-preto.png';
  return (
    <Group gap={10} wrap="nowrap">
      <Image src={src} alt="" h={size} w="auto" fit="contain" />
      <Text component="span" fw={600} fz={nameSize} lh={1.25} c="var(--ce-text-primary)" style={{ letterSpacing: nameSize > 20 ? '-0.02em' : undefined }}>
        CYBEREYES
      </Text>
    </Group>
  );
}
