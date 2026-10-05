import type { ReactNode } from 'react';
import { Box, Center, Paper, Stack, Text, Title, useComputedColorScheme } from '@mantine/core';
import { BrandMark } from '../../components/layout/BrandMark';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  width?: number;
  children: ReactNode;
}

/** Login e 2FA: textura de asas com veu de 75% e cartao central com o emblema. */
export function AuthLayout({ title, subtitle, width = 400, children }: AuthLayoutProps) {
  const scheme = useComputedColorScheme('dark');
  const texture = scheme === 'dark' ? '/brand/textura-asas-escura.webp' : '/brand/textura-asas-clara.webp';
  const veil = scheme === 'dark' ? 'rgba(10, 12, 14, 0.75)' : 'rgba(248, 249, 246, 0.75)';
  return (
    <Box
      mih="100vh"
      style={{
        backgroundColor: 'var(--ce-bg-base)',
        backgroundImage: `linear-gradient(${veil}, ${veil}), url(${texture})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <Center mih="100vh" p="md">
        <Paper
          component="main"
          w="100%"
          maw={width}
          p="xl"
          withBorder
          style={{ backgroundColor: 'var(--ce-bg-surface)', boxShadow: 'var(--ce-shadow-md)' }}
        >
          <Center mb={28}>
            <BrandMark size={40} nameSize={32} />
          </Center>
          <Stack gap={4} mb="lg">
            <Title order={1} fz={20} lh="28px">
              {title}
            </Title>
            {subtitle && (
              <Text c="dimmed" fz={13} lh="18px">
                {subtitle}
              </Text>
            )}
          </Stack>
          {children}
        </Paper>
      </Center>
    </Box>
  );
}
