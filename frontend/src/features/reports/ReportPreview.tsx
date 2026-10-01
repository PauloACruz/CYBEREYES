import { Alert, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { ReportData } from '../../api/types';
import { EmptyRow } from '../../components/TableStates';
import { formatDateTime, formatInteger } from '../../lib/format';
import { formatReportCell, formatReportPeriod, formatSummaryValue, isNumericKind } from './reportFormat';

export const PREVIEW_ROW_LIMIT = 500;

export function ReportPreview({ data }: { data: ReportData }) {
  const period = formatReportPeriod(data.periodFrom, data.periodTo);
  const columns = data.columns;
  return (
    <section aria-labelledby="report-preview-title">
      <Stack gap="md">
        <div>
          <Title order={3} id="report-preview-title">
            {data.title}
          </Title>
          <Group gap="lg" mt={4}>
            {period && (
              <Text size="sm" c="dimmed">
                Período: {period}
              </Text>
            )}
            <Text size="sm" c="dimmed">
              Gerado em {formatDateTime(data.generatedAt)}
            </Text>
          </Group>
          {data.filtersText.length > 0 && (
            <Text size="sm" c="dimmed">
              Filtros: {data.filtersText.join('; ')}
            </Text>
          )}
        </div>

        {data.summary.length > 0 && (
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm" component="dl" m={0}>
            {data.summary.map((item, index) => (
              <Paper key={`${item.label}-${index}`} withBorder p="sm">
                <Text component="dt" size="xs" c="dimmed" fw={600}>
                  {item.label}
                </Text>
                <Text component="dd" m={0} fz="lg" fw={700}>
                  {formatSummaryValue(item.value)}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>
        )}

        {data.truncated && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} title="Prévia limitada">
            A prévia mostra só as primeiras {formatInteger(PREVIEW_ROW_LIMIT)} linhas. Gere o PDF ou o CSV para obter o relatório completo.
          </Alert>
        )}

        <Paper withBorder>
          <Table.ScrollContainer minWidth={Math.max(600, columns.length * 140)}>
            <Table striped verticalSpacing="xs" stickyHeader>
              <Table.Caption>
                {formatInteger(data.rows.length)} {data.rows.length === 1 ? 'linha' : 'linhas'}
                {data.truncated ? ' na prévia' : ''}
              </Table.Caption>
              <Table.Thead>
                <Table.Tr>
                  {columns.map((col) => (
                    <Table.Th key={col.key} ta={isNumericKind(col.kind) ? 'right' : undefined}>
                      {col.label}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.rows.length === 0 && <EmptyRow columns={Math.max(1, columns.length)} message="Nenhum registro para os filtros escolhidos." />}
                {data.rows.map((row, rowIndex) => (
                  <Table.Tr key={rowIndex}>
                    {columns.map((col) => (
                      <Table.Td key={col.key} ta={isNumericKind(col.kind) ? 'right' : undefined}>
                        {formatReportCell(row[col.key], col.kind)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </Stack>
    </section>
  );
}
