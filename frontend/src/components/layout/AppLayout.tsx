import { Suspense } from 'react';
import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Center,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChevronDown,
  IconKey,
  IconLogout,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { visibleNavItems } from '../../app/navigation';
import { PATHS } from '../../app/paths';
import { useMe } from '../../auth/useMe';
import { ConsoleHubContext } from '../../realtime/consoleHubContext';
import { useConsoleHub } from '../../realtime/useConsoleHub';
import { BrandMark } from './BrandMark';
import { ChangePasswordModal } from './ChangePasswordModal';
import { SideNav } from './SideNav';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function AppLayout() {
  const { data: me } = useMe();
  const hub = useConsoleHub();
  const [navOpened, nav] = useDisclosure(false);
  const [passwordOpened, passwordModal] = useDisclosure(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme('light');

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate(PATHS.login, { replace: true });
    },
  });

  const displayName = me?.fullName || me?.username || '';

  return (
    <AppShell
      layout="alt"
      header={{ height: 56 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="xl"
      styles={{
        header: { backgroundColor: 'var(--ce-bg-surface)', borderColor: 'var(--ce-border-subtle)' },
        navbar: { backgroundColor: 'var(--ce-bg-surface)', borderColor: 'var(--ce-border-subtle)' },
        main: { backgroundColor: 'var(--ce-bg-base)' },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="xl" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpened} onClick={nav.toggle} hiddenFrom="sm" size="sm" aria-label="Abrir menu" />
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={colorScheme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
              <ActionIcon
                variant="default"
                size={36}
                onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
                aria-label="Alternar tema"
              >
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" width={220} shadow="md">
              <Menu.Target>
                <UnstyledButton aria-label="Menu do usuário">
                  <Group gap={8} wrap="nowrap">
                    <Avatar radius="xl" size={32} color="gray" variant="outline">
                      {initials(displayName)}
                    </Avatar>
                    <Text size="sm" fw={500} visibleFrom="xs" maw={160} truncate>
                      {displayName}
                    </Text>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me?.username}</Menu.Label>
                <Menu.Item leftSection={<IconKey size={16} />} onClick={passwordModal.open}>
                  Trocar senha
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => logout.mutate()}>
                  Sair
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" pt="md" component="nav" aria-label="Navegação principal">
        <AppShell.Section px={8} pb="md" mb="sm" style={{ borderBottom: '1px solid var(--ce-border-subtle)' }}>
          <Group justify="space-between" wrap="nowrap">
            <BrandMark />
            <Burger opened={navOpened} onClick={nav.close} hiddenFrom="sm" size="sm" aria-label="Fechar menu" />
          </Group>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea}>
          <SideNav items={visibleNavItems(me)} pathname={pathname} onNavigate={nav.close} />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Suspense
          fallback={
            <Center py="xl">
              <Loader />
            </Center>
          }
        >
          <ConsoleHubContext.Provider value={hub}>
            <Outlet />
          </ConsoleHubContext.Provider>
        </Suspense>
      </AppShell.Main>

      <ChangePasswordModal opened={passwordOpened} onClose={passwordModal.close} />
    </AppShell>
  );
}
