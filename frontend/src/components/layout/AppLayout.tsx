import { Suspense } from 'react';
import {
  ActionIcon,
  Anchor,
  AppShell,
  Avatar,
  Box,
  Burger,
  Center,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import {
  IconChevronDown,
  IconKey,
  IconLogout,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { visibleNavItems } from '../../app/navigation';
import { PATHS } from '../../app/paths';
import { useMe } from '../../auth/useMe';
import { ConsoleHubContext } from '../../realtime/consoleHubContext';
import { useConsoleHub } from '../../realtime/useConsoleHub';
import { AppFooter } from './AppFooter';
import { BrandToggle } from './BrandToggle';
import { ChangePasswordModal } from './ChangePasswordModal';
import { SideNav } from './SideNav';

/** Conteineres flutuantes do shell: cantos de 15px, borda sutil e sombra. */
const FLOATING = {
  backgroundColor: 'var(--ce-bg-surface)',
  border: '1px solid var(--ce-border-subtle)',
  borderRadius: 15,
  boxShadow: 'var(--ce-shadow-md)',
} as const;

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
  const isMobile = useMediaQuery('(max-width: 47.99em)');
  const [menuCollapsed, setMenuCollapsed] = useLocalStorage({ key: 'cybereyes:menu-recolhido', defaultValue: false });
  const collapsed = menuCollapsed && !isMobile;
  const texture = colorScheme === 'dark' ? '/brand/textura-asas-escura.webp' : '/brand/textura-asas-clara.webp';
  const veil = colorScheme === 'dark' ? 'rgba(10, 12, 14, 0.9)' : 'rgba(248, 249, 246, 0.9)';

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate(PATHS.login, { replace: true });
    },
  });

  const displayName = me?.fullName || me?.username || '';

  const shellStyle = {
    minHeight: '100vh',
    backgroundColor: 'var(--ce-bg-base)',
    backgroundImage: `linear-gradient(${veil}, ${veil}), url(${texture})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
  } as const;

  return (
    <Box style={shellStyle}>
      <AppShell
        layout="alt"
        header={{ height: 68 }}
        navbar={{ width: collapsed ? 78 : 260, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
        padding={0}
        styles={{
          header: { backgroundColor: 'transparent', border: 0 },
          navbar: { backgroundColor: isMobile ? 'var(--ce-bg-base)' : 'transparent', border: 0 },
          main: { display: 'flex', flexDirection: 'column', minHeight: '100vh' },
        }}
      >
        <AppShell.Header px={12} pt={12}>
          <Group h={56} px={20} justify="space-between" wrap="nowrap" style={FLOATING}>
            <Group gap="sm" wrap="nowrap">
              <Burger opened={navOpened} onClick={nav.toggle} hiddenFrom="sm" size="sm" aria-label="Abrir menu" />
              <Anchor component={Link} to={PATHS.dashboard} underline="never" c="var(--ce-text-primary)" fw={600} fz={16} lh="24px" aria-label="CYBEREYES, ir para o Painel">
                CYBEREYES
              </Anchor>
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

        <AppShell.Navbar p={12} pr={isMobile ? 12 : 0}>
          <Stack h="100%" gap={12}>
            <Box pos="relative">
              <BrandToggle collapsed={collapsed} onToggle={() => setMenuCollapsed(!menuCollapsed)} interactive={!isMobile} />
              {isMobile && (
                <Burger opened onClick={nav.close} size="sm" aria-label="Fechar menu" color="#f1f2ee" pos="absolute" top={10} right={10} />
              )}
            </Box>
            <Box component="nav" aria-label="Navegação principal" p={12} style={{ ...FLOATING, flex: 1, minHeight: 0, display: 'flex' }}>
              <ScrollArea style={{ flex: 1 }} scrollbarSize={6}>
                <SideNav
                  items={visibleNavItems(me)}
                  pathname={pathname}
                  onNavigate={nav.close}
                  collapsed={collapsed}
                  onExpand={() => setMenuCollapsed(false)}
                />
              </ScrollArea>
            </Box>
          </Stack>
        </AppShell.Navbar>

        <AppShell.Main>
          <Box style={{ flex: 1 }} pt={28} pb={40} px={{ base: 16, sm: 32 }}>
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
          </Box>
          <Box px={12} pb={12}>
            <AppFooter />
          </Box>
        </AppShell.Main>

        <ChangePasswordModal opened={passwordOpened} onClose={passwordModal.close} />
      </AppShell>
    </Box>
  );
}
