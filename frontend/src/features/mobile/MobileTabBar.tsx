import { Badge, Box, Text, UnstyledButton } from '@mantine/core';
import { IconDeviceDesktop, IconDots, IconTicket, IconWorldWww, type Icon } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS } from '../../api/types';
import { webAppsApi } from '../../api/webapps';
import { MOBILE_PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { useTicketSummary } from '../tickets/useTicketSummary';
import { MOBILE_FLOATING } from './mobileStyles';

interface Tab {
  to: string;
  label: string;
  icon: Icon;
  count?: number;
  countColor?: string;
  countLabel?: string;
}

/** Navegacao principal do app: chamados primeiro, depois agentes, aplicacoes e o resto. */
export function MobileTabBar() {
  const { data: me } = useMe();
  const canTickets = hasPermission(me, PERMISSIONS.ticketsView);
  const canAgents = hasPermission(me, PERMISSIONS.agentsView);
  const canApps = hasPermission(me, PERMISSIONS.appsView);
  const summary = useTicketSummary();
  const apps = useQuery({
    queryKey: queryKeys.webAppOverview({}),
    queryFn: () => webAppsApi.overview({}, { silent: true }),
    enabled: canApps,
    staleTime: 30_000,
  });
  const down = apps.data?.apps.filter((a) => a.status === 'down').length ?? 0;

  const tabs: Tab[] = [];
  if (canTickets) {
    tabs.push({ to: MOBILE_PATHS.tickets, label: 'Chamados', icon: IconTicket, count: summary.data?.open, countColor: 'gold', countLabel: 'chamados abertos' });
  }
  if (canAgents) tabs.push({ to: MOBILE_PATHS.agents, label: 'Agentes', icon: IconDeviceDesktop });
  if (canApps) tabs.push({ to: MOBILE_PATHS.webApps, label: 'Aplicações', icon: IconWorldWww, count: down, countColor: 'red', countLabel: 'fora do ar' });
  tabs.push({ to: MOBILE_PATHS.more, label: 'Mais', icon: IconDots });

  return (
    <Box
      component="nav"
      aria-label="Navegação do app"
      pos="sticky"
      bottom={0}
      px={8}
      pb="calc(8px + env(safe-area-inset-bottom))"
      style={{ zIndex: 20, background: 'linear-gradient(transparent, var(--ce-bg-base) 30%)' }}
    >
      <Box p={4} style={{ ...MOBILE_FLOATING, display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => (
          <UnstyledButton
            key={tab.to}
            component={NavLink}
            to={tab.to}
            mih={56}
            style={({ isActive }: { isActive: boolean }) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              borderRadius: 10,
              color: isActive ? 'var(--ce-accent-text)' : 'var(--ce-text-secondary)',
              fontWeight: isActive ? 600 : 500,
            })}
          >
            <Box pos="relative" display="flex">
              <tab.icon size={24} stroke={1.75} aria-hidden />
              {tab.count !== undefined && tab.count > 0 && (
                <Badge
                  size="xs"
                  circle={tab.count < 10}
                  color={tab.countColor}
                  variant="filled"
                  pos="absolute"
                  top={-6}
                  left={14}
                  aria-label={`${tab.count} ${tab.countLabel ?? ''}`.trim()}
                >
                  {tab.count > 99 ? '99+' : tab.count}
                </Badge>
              )}
            </Box>
            <Text span size="xs" fw="inherit" c="inherit">
              {tab.label}
            </Text>
          </UnstyledButton>
        ))}
      </Box>
    </Box>
  );
}
