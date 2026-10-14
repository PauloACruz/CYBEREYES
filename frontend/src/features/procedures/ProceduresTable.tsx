import { Anchor, Badge, Box, Checkbox, Group, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { Link } from 'react-router';
import type { ProcedureDto } from '../../api/types';
import { agentPath, ticketPath } from '../../app/paths';
import { EmptyRow, LoadingRows } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { formatMinutes } from '../tickets/ticketFormat';
import { canInclude, PROCEDURE_KIND_INFO, PROCEDURE_STATUS_INFO, procedureDuration } from './procedureFormat';

export function ProcedureKindBadge({ procedure }: { procedure: Pick<ProcedureDto, 'kind'> }) {
  const info = PROCEDURE_KIND_INFO[procedure.kind];
  return (
    <Badge variant="light" color={info.color} size="sm" leftSection={<info.icon size={12} aria-hidden />} style={{ flexShrink: 0 }}>
      {info.label}
    </Badge>
  );
}

export function ProcedureStatusBadge({ procedure }: { procedure: Pick<ProcedureDto, 'status'> }) {
  const info = PROCEDURE_STATUS_INFO[procedure.status];
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={8} h={8} style={{ borderRadius: 4, flexShrink: 0 }} bg={`var(--mantine-color-${info.color}-6)`} aria-hidden />
      <Text size="sm">{info.label}</Text>
    </Group>
  );
}

/** Tipo, o que foi feito e o detalhe (shell, tarefas, motivo de nao ter conectado). */
export function ProcedureSummary({ procedure }: { procedure: ProcedureDto }) {
  return (
    <Stack gap={4} align="flex-start">
      <ProcedureKindBadge procedure={procedure} />
      {procedure.title && (
        <Text size="sm" lineClamp={2} title={procedure.title} style={{ wordBreak: 'break-word' }}>
          {procedure.title}
        </Text>
      )}
      {procedure.detail && (
        <Text size="xs" c="dimmed" lineClamp={1} title={procedure.detail} style={{ wordBreak: 'break-word' }}>
          {procedure.detail}
        </Text>
      )}
    </Stack>
  );
}

interface ProceduresTableProps {
  procedures: ProcedureDto[];
  loading: boolean;
  emptyMessage: string;
  /** Mostra a maquina e o cliente (lista geral); a aba do agente nao precisa. */
  showMachine?: boolean;
  /** Selecao para incluir em chamado; so os que podem entrar ficam marcaveis. */
  selected?: ReadonlySet<number>;
  onSelectedChange?: (ids: Set<number>) => void;
}

export function ProceduresTable({ procedures, loading, emptyMessage, showMachine = false, selected, onSelectedChange }: ProceduresTableProps) {
  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const columns = 6 + (showMachine ? 1 : 0) + (selectable ? 1 : 0);
  const eligible = procedures.filter(canInclude);
  const allChecked = selectable && eligible.length > 0 && eligible.every((p) => selected.has(p.id));
  const someChecked = selectable && eligible.some((p) => selected.has(p.id));

  const toggle = (id: number, checked: boolean) => {
    if (!onSelectedChange || !selected) return;
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={showMachine ? 1100 : 920}>
        <Table verticalSpacing="xs" highlightOnHover layout="fixed">
          <Table.Thead>
            <Table.Tr>
              {selectable && (
                <Table.Th w={44}>
                  <Checkbox
                    aria-label="Selecionar todos os procedimentos sem chamado"
                    checked={allChecked}
                    indeterminate={someChecked && !allChecked}
                    disabled={eligible.length === 0}
                    onChange={(e) => {
                      const next = new Set(selected);
                      for (const p of eligible) {
                        if (e.currentTarget.checked) next.add(p.id);
                        else next.delete(p.id);
                      }
                      onSelectedChange(next);
                    }}
                  />
                </Table.Th>
              )}
              <Table.Th w={136}>Início</Table.Th>
              <Table.Th>Procedimento</Table.Th>
              {showMachine && <Table.Th w={160}>Máquina</Table.Th>}
              <Table.Th w={140}>Técnico</Table.Th>
              <Table.Th w={110}>Duração</Table.Th>
              <Table.Th w={140}>Situação</Table.Th>
              <Table.Th w={190}>Chamado</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading && <LoadingRows columns={columns} rows={4} />}
            {!loading && procedures.length === 0 && <EmptyRow columns={columns} message={emptyMessage} />}
            {procedures.map((p) => (
              <Table.Tr key={p.id}>
                {selectable && (
                  <Table.Td>
                    <Tooltip
                      label={p.status === 'running' ? 'Ainda em andamento' : `Já está no chamado #${p.ticketId}`}
                      disabled={canInclude(p)}
                    >
                      <Checkbox
                        aria-label={`Selecionar ${PROCEDURE_KIND_INFO[p.kind].label.toLowerCase()} de ${formatDateTime(p.startedAt, '')}`}
                        checked={selected.has(p.id)}
                        disabled={!canInclude(p)}
                        onChange={(e) => toggle(p.id, e.currentTarget.checked)}
                      />
                    </Tooltip>
                  </Table.Td>
                )}
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(p.startedAt, '')}</Table.Td>
                <Table.Td>
                  <ProcedureSummary procedure={p} />
                </Table.Td>
                {showMachine && (
                  <Table.Td>
                    <Stack gap={0}>
                      {p.agentId !== null ? (
                        <Anchor component={Link} to={agentPath(p.agentId)} size="sm" ff="monospace" truncate title={p.hostname}>
                          {p.hostname}
                        </Anchor>
                      ) : (
                        <Text size="sm" ff="monospace" c="dimmed" truncate title={`${p.hostname} (agente removido)`}>
                          {p.hostname}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed" truncate>
                        {p.clientName}
                      </Text>
                    </Stack>
                  </Table.Td>
                )}
                <Table.Td>
                  <Text size="sm">{p.userName}</Text>
                  {p.source === 'tray' && (
                    <Text size="xs" c="dimmed">
                      pelo app de bandeja
                    </Text>
                  )}
                </Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{procedureDuration(p)}</Table.Td>
                <Table.Td>
                  <ProcedureStatusBadge procedure={p} />
                </Table.Td>
                <Table.Td>
                  {p.ticketId !== null ? (
                    <Stack gap={0}>
                      <Anchor component={Link} to={ticketPath(p.ticketId)} size="sm" truncate title={p.ticketTitle ?? undefined}>
                        #{p.ticketId} {p.ticketTitle}
                      </Anchor>
                      {p.serviceMinutes !== null && (
                        <Text size="xs" c="dimmed">
                          {formatMinutes(p.serviceMinutes)} de serviço
                        </Text>
                      )}
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Sem chamado
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
