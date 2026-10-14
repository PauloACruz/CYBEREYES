import type { ReactNode } from 'react';
import { Avatar, Box, Group, Stack, Text, UnstyledButton, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertTriangle, IconChevronRight, IconKey, IconLayoutDashboard, IconLogout, IconMoon, IconSun } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { PERMISSIONS } from '../../api/types';
import { PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { ChangePasswordModal } from '../../components/layout/ChangePasswordModal';
import { MobileHeader, MobilePage, MobileSection } from './MobilePage';
import { MOBILE_CARD } from './mobileStyles';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

interface RowProps {
  icon: ReactNode;
  label: string;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
}

function Row({ icon, label, to, onClick, danger = false }: RowProps) {
  const content = (
    <Group gap={14} wrap="nowrap" mih={52} px={16} c={danger ? 'red' : undefined}>
      <Box c={danger ? 'red' : 'var(--ce-text-secondary)'} display="flex">
        {icon}
      </Box>
      <Text size="md" style={{ flex: 1 }} c="inherit">
        {label}
      </Text>
      {to && <IconChevronRight size={18} color="var(--ce-text-tertiary)" aria-hidden />}
    </Group>
  );
  return to ? (
    <UnstyledButton component={Link} to={to} display="block">
      {content}
    </UnstyledButton>
  ) : (
    <UnstyledButton onClick={onClick} display="block" w="100%">
      {content}
    </UnstyledButton>
  );
}

const DIVIDER = { borderTop: '1px solid var(--ce-border-subtle)' } as const;

/** Conta, tema, atalhos para o console completo e sair. */
export function MobileMorePage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme('dark');
  const [passwordOpened, passwordModal] = useDisclosure(false);
  const displayName = me?.fullName || me?.username || '';
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate(PATHS.login, { replace: true });
    },
  });

  return (
    <MobilePage header={<MobileHeader title="Mais" />}>
      <Group gap="md" wrap="nowrap" p={16} style={MOBILE_CARD}>
        <Avatar radius="xl" size={48} color="gray" variant="outline">
          {initials(displayName)}
        </Avatar>
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} truncate>
            {displayName}
          </Text>
          <Text size="sm" c="var(--ce-text-secondary)" truncate>
            {me?.username}
          </Text>
        </Stack>
      </Group>
      <MobileSection title="Console">
        <Box style={MOBILE_CARD}>
          <Row icon={<IconLayoutDashboard size={22} />} label="Abrir o console completo" to={PATHS.dashboard} />
          {hasPermission(me, PERMISSIONS.alertsView) && (
            <Box style={DIVIDER}>
              <Row icon={<IconAlertTriangle size={22} />} label="Alertas" to={PATHS.alerts} />
            </Box>
          )}
        </Box>
      </MobileSection>
      <MobileSection title="Conta">
        <Box style={MOBILE_CARD}>
          <Row
            icon={colorScheme === 'dark' ? <IconSun size={22} /> : <IconMoon size={22} />}
            label={colorScheme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
          />
          <Box style={DIVIDER}>
            <Row icon={<IconKey size={22} />} label="Trocar senha" onClick={passwordModal.open} />
          </Box>
          <Box style={DIVIDER}>
            <Row icon={<IconLogout size={22} />} label="Sair" danger onClick={() => logout.mutate()} />
          </Box>
        </Box>
      </MobileSection>
      <ChangePasswordModal opened={passwordOpened} onClose={passwordModal.close} />
    </MobilePage>
  );
}
