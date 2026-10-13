import { ActionIcon, Badge, Box, Button, Group, Popover, SegmentedControl, Select, Stack, Text, Tooltip } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconFilterOff } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import type { DashboardPeriod } from '../../api/types';
import { useClients } from '../clients/useClients';
import { DEFAULT_PERIOD, PERIODS, type DashboardFilterValues } from './filterValues';

interface DashboardFiltersProps {
  value: DashboardFilterValues;
  onChange: (next: DashboardFilterValues) => void;
  canViewClients: boolean;
  canViewTickets: boolean;
}

/** Filtros do Painel recolhidos num icone: cliente, tecnico e periodo, com o recorte atual escrito ao lado. */
export function DashboardFilters({ value, onChange, canViewClients, canViewTickets }: DashboardFiltersProps) {
  const [opened, setOpened] = useState(false);
  const clients = useClients(canViewClients);
  const technicians = useQuery({ queryKey: queryKeys.ticketAssignees, queryFn: ticketsApi.assignees, enabled: canViewTickets, staleTime: 60_000 });
  const clientName = clients.data?.find((c) => c.id === value.clientId)?.name;
  const technicianName = technicians.data?.find((t) => t.id === value.technicianId)?.name;
  const active = (value.clientId ? 1 : 0) + (value.technicianId ? 1 : 0) + (value.days !== DEFAULT_PERIOD ? 1 : 0);
  const scope = [clientName, technicianName && `chamados de ${technicianName}`, `últimos ${value.days} dias`].filter(Boolean).join(' · ');

  return (
    <Group gap="sm" wrap="nowrap">
      <Text size="sm" c="dimmed" aria-live="polite">
        {scope}
      </Text>
      <Popover opened={opened} onChange={setOpened} position="bottom-end" width={300} shadow="md" trapFocus withinPortal>
        <Popover.Target>
          <Box pos="relative">
            <Tooltip label="Filtros">
              <ActionIcon
                variant={opened ? 'light' : 'default'}
                size={36}
                aria-label={active > 0 ? `Filtros (${active} ativos)` : 'Filtros'}
                aria-expanded={opened}
                onClick={() => setOpened((o) => !o)}
              >
                <IconAdjustmentsHorizontal size={20} />
              </ActionIcon>
            </Tooltip>
            {active > 0 && (
              <Badge size="xs" circle pos="absolute" top={-6} right={-6} style={{ pointerEvents: 'none' }} aria-hidden>
                {active}
              </Badge>
            )}
          </Box>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="sm" role="group" aria-label="Filtros do painel">
            {canViewClients && (
              <Select
                label="Cliente"
                placeholder="Todos os clientes"
                data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
                value={value.clientId ? String(value.clientId) : null}
                onChange={(v) => onChange({ ...value, clientId: v ? Number(v) : undefined })}
                clearable
                searchable
                comboboxProps={{ withinPortal: false }}
              />
            )}
            {canViewTickets && (
              <Select
                label="Técnico"
                description="Filtra os chamados pelo técnico responsável."
                placeholder="Todos os técnicos"
                data={(technicians.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
                value={value.technicianId ?? null}
                onChange={(v) => onChange({ ...value, technicianId: v ?? undefined })}
                clearable
                searchable
                comboboxProps={{ withinPortal: false }}
              />
            )}
            <Stack gap={4}>
              <Text size="sm" fw={500} id="periodo-painel">
                Período
              </Text>
              <SegmentedControl
                aria-labelledby="periodo-painel"
                data={PERIODS.map((d) => ({ value: String(d), label: `${d} dias` }))}
                value={String(value.days)}
                onChange={(v) => onChange({ ...value, days: Number(v) as DashboardPeriod })}
                fullWidth
              />
            </Stack>
            <Button
              variant="subtle"
              leftSection={<IconFilterOff size={16} />}
              disabled={active === 0}
              onClick={() => onChange({ days: DEFAULT_PERIOD })}
              style={{ alignSelf: 'flex-start' }}
            >
              Limpar filtros
            </Button>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}
