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
  NavLink,
  ScrollArea,
  Text,
  ThemeIcon,
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
  IconShieldCheck,
  IconSun,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink as RouterNavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { visibleNavItems } from '../../app/navigation';
import { PATHS } from '../../app/paths';
import { useMe } from '../../auth/useMe';
import { ConsoleHubContext } from '../../realtime/consoleHubContext';
import { useConsoleHub } from '../../realtime/useConsoleHub';
import { ChangePasswordModal } from './ChangePasswordModal';
import { NavAlertBadge } from './NavAlertBadge';
import { NavTicketBadge } from './NavTicketBadge';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

function isActive(pathname: string, to: string): boolean {
  return to === PATHS.dashboard ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
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
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpened} onClick={nav.toggle} hiddenFrom="sm" size="sm" aria-label="Abrir menu" />
            <ThemeIcon size={30} radius="md">
              <IconShieldCheck size={18} />
            </ThemeIcon>
            <Text fw={700}>WinCare</Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={colorScheme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
              <ActionIcon
                variant="subtle"
                color="gray"
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
                    <Avatar radius="xl" size={30} color="blue">
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

      <AppShell.Navbar p="sm" component="nav" aria-label="Navegação principal">
        <AppShell.Section grow component={ScrollArea}>
          {visibleNavItems(me).map((item) => (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              label={item.label}
              leftSection={<item.icon size={18} stroke={1.6} />}
              rightSection={item.alertCounter ? <NavAlertBadge /> : item.ticketCounter ? <NavTicketBadge /> : undefined}
              active={isActive(pathname, item.to)}
              onClick={nav.close}
              style={{ borderRadius: 'var(--mantine-radius-md)' }}
            />
          ))}
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
