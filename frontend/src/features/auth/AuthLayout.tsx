import type { ReactNode } from 'react';
import { Box, Center, Group, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconShieldCheck } from '@tabler/icons-react';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  width?: number;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, width = 420, children }: AuthLayoutProps) {
  return (
    <Box bg="var(--mantine-color-body)" mih="100vh">
      <Center mih="100vh" p="md">
        <Stack w="100%" maw={width} gap="lg">
          <Group gap="xs" justify="center">
            <ThemeIcon size={36} radius="md">
              <IconShieldCheck size={22} />
            </ThemeIcon>
            <Text fw={700} fz="xl">
              WinCare
            </Text>
          </Group>
          <Paper withBorder shadow="sm" p="xl" radius="md" component="main">
            <Stack gap={4} mb="lg">
              <Title order={2} fz="h3">
                {title}
              </Title>
              {subtitle && (
                <Text c="dimmed" size="sm">
                  {subtitle}
                </Text>
              )}
            </Stack>
            {children}
          </Paper>
        </Stack>
      </Center>
    </Box>
  );
}
