import { Anchor, Badge, Checkbox, Group, Table, Text, Tooltip } from '@mantine/core';
import { IconBellOff, IconCircleCheck, IconFlame } from '@tabler/icons-react';
import { Link } from 'react-router';
import type { AlertDto } from '../../api/types';
import { agentPath } from '../../app/paths';
import { EmptyRow, LoadingRows } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { RelativeTime } from '../agents/agentDisplay';
import { SeverityBadge } from '../monitoring/MonitoringBadges';
import { ALERT_TYPE_LABEL, isSnoozed } from './alertFormat';

export function AlertStateBadge({ alert }: { alert: AlertDto }) {
  if (alert.resolved) {
    return (
      <Tooltip label={`Resolvido em ${formatDateTime(alert.resolvedAt)}`} withArrow>
        <Badge color="teal" variant="light" leftSection={<IconCircleCheck size={12} aria-hidden />}>
          Resolvido
        </Badge>
      </Tooltip>
    );
  }
  if (isSnoozed(alert)) {
    return (
      <Tooltip label={`Silenciado até ${formatDateTime(alert.snoozedUntil)}`} withArrow>
        <Badge color="gray" variant="light" leftSection={<IconBellOff size={12} aria-hidden />}>
          Silenciado
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Badge color="red" variant="light" leftSection={<IconFlame size={12} aria-hidden />}>
      Ativo
    </Badge>
  );
}

interface AlertsTableProps {
  alerts: AlertDto[];
  loading: boolean;
  showAgent: boolean;
  emptyMessage: string;
  /** Com seleção múltipla quando informado. */
  selection?: {
    selected: ReadonlySet<number>;
    onChange: (next: Set<number>) => void;
  };
}

export function AlertsTable({ alerts, loading, showAgent, emptyMessage, selection }: AlertsTableProps) {
  const columns = 5 + (showAgent ? 1 : 0) + (selection ? 1 : 0);
  const selectable = alerts.filter((a) => !a.resolved);
  const allSelected = selection !== undefined && selectable.length > 0 && selectable.every((a) => selection.selected.has(a.id));
  const someSelected = selection !== undefined && selectable.some((a) => selection.selected.has(a.id));

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const a of selectable) {
      if (allSelected) next.delete(a.id);
      else next.add(a.id);
    }
    selection.onChange(next);
  };
  const toggle = (id: number) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  return (
    <Table.ScrollContainer minWidth={showAgent ? 980 : 760}>
      <Table verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {selection && (
              <Table.Th w={40}>
                <Checkbox
                  aria-label="Selecionar todos os alertas da página"
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  disabled={selectable.length === 0}
                  onChange={toggleAll}
                />
              </Table.Th>
            )}
            <Table.Th w={130}>Severidade</Table.Th>
            {showAgent && <Table.Th w={220}>Agente</Table.Th>}
            <Table.Th>Mensagem</Table.Th>
            <Table.Th w={120}>Tipo</Table.Th>
            <Table.Th w={130}>Situação</Table.Th>
            <Table.Th w={130}>Criado</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading && <LoadingRows columns={columns} />}
          {!loading && alerts.length === 0 && <EmptyRow columns={columns} message={emptyMessage} />}
          {alerts.map((alert) => (
            <Table.Tr key={alert.id} bg={selection?.selected.has(alert.id) ? 'var(--mantine-primary-color-light)' : undefined}>
              {selection && (
                <Table.Td>
                  <Checkbox
                    aria-label={`Selecionar alerta ${alert.message}`}
                    checked={selection.selected.has(alert.id)}
                    disabled={alert.resolved}
                    onChange={() => toggle(alert.id)}
                  />
                </Table.Td>
              )}
              <Table.Td>
                <SeverityBadge severity={alert.severity} />
              </Table.Td>
              {showAgent && (
                <Table.Td>
                  <Anchor component={Link} to={`${agentPath(alert.agentId)}?aba=alertas`} size="sm" fw={500}>
                    {alert.hostname}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {alert.clientName} / {alert.siteName}
                  </Text>
                </Table.Td>
              )}
              <Table.Td>
                <Text size="sm">{alert.message}</Text>
              </Table.Td>
              <Table.Td>{ALERT_TYPE_LABEL[alert.alertType]}</Table.Td>
              <Table.Td>
                <AlertStateBadge alert={alert} />
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <RelativeTime value={alert.createdAt} />
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
