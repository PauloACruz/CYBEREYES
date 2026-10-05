import { Group, Image, Text } from '@mantine/core';

interface BrandMarkProps {
  /** Altura do logotipo, em px. */
  size?: number;
}

/** Leão da PCruz Tecnologia com o nome do console. */
export function BrandMark({ size = 32 }: BrandMarkProps) {
  return (
    <Group gap={10} wrap="nowrap">
      <Image src="/brand/leao.jpg" alt="PCruz Tecnologia" w={size} h={size} radius="sm" fit="cover" />
      <Text
        component="span"
        ff="heading"
        fw={600}
        fz={13}
        c="gold"
        tt="uppercase"
        lh={1.25}
        style={{ letterSpacing: '0.18em' }}
      >
        Cybereyes
        <Text component="span" display="block" fz={9} c="dimmed" ff="heading" style={{ letterSpacing: '0.16em' }}>
          Console do técnico
        </Text>
      </Text>
    </Group>
  );
}
