import type { ReactNode } from 'react';
import { Box, Center, Group, Image, Stack, Text, Title } from '@mantine/core';
import { BrandMark } from '../../components/layout/BrandMark';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  width?: number;
  children: ReactNode;
}

const GOLD_RULE = 'linear-gradient(135deg, #F0CB45 0%, #E2B622 50%, #A37A09 100%)';

export function AuthLayout({ title, subtitle, width = 380, children }: AuthLayoutProps) {
  return (
    <Box mih="100vh" bg="var(--mantine-color-body)" style={{ display: 'flex' }}>
      <Box
        component="section"
        aria-label="PCruz Tecnologia"
        visibleFrom="md"
        pos="relative"
        p={48}
        bg="black"
        style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      >
        <Image src="/brand/leao-coroado.jpg" alt="" pos="absolute" inset={0} w="100%" h="100%" fit="cover" />
        <Box
          pos="absolute"
          inset={0}
          style={{ background: 'linear-gradient(180deg, rgba(0, 0, 0, 0) 40%, rgba(0, 0, 0, 0.7) 100%)' }}
        />
        <Text pos="relative" ff="heading" fz={32} lh={1.1} c="white" tt="uppercase">
          Reis em{' '}
          <Text component="span" inherit c="gold">
            TI.
          </Text>
        </Text>
        <Group pos="relative" gap={8} mt={18}>
          <Box w={24} h={1} bg="gold" />
          <Text ff="monospace" fz={11} c="rgba(255, 255, 255, 0.6)" tt="uppercase" style={{ letterSpacing: '0.12em' }}>
            ITIL · COBIT · LGPD
          </Text>
        </Group>
      </Box>
      <Center p={{ base: 'md', sm: 48 }} style={{ flex: 1 }}>
        <Stack component="main" w="100%" maw={width} gap={0}>
          <Box mb="xl">
            <BrandMark size={48} />
          </Box>
          <Title order={1} fz={title.length > 14 ? 30 : 40}>
            {title}
          </Title>
          <Box w={56} h={3} mt={14} mb={16} style={{ background: GOLD_RULE, borderRadius: 2 }} />
          {subtitle && (
            <Text c="dimmed" size="sm" mb="lg">
              {subtitle}
            </Text>
          )}
          {children}
        </Stack>
      </Center>
    </Box>
  );
}
