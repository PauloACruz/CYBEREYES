import { useState } from 'react';
import { Alert, Button, Group, Paper, Select, Skeleton, Stack, Text } from '@mantine/core';
import { IconFileTypeCsv, IconDownload, IconEye, IconFileTypePdf } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reportDownloadUrl, reportsApi } from '../../api/reports';
import { queryKeys } from '../../api/queryKeys';
import type { ReportFormat, ReportParams, ReportRunDto, ReportTypeDto } from '../../api/types';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { formatBytes } from '../../lib/format';
import { ReportFilters } from './ReportFilters';
import { buildReportParams, EMPTY_FILTERS, FORMAT_LABEL, type ReportFilterValues } from './reportFormat';
import { ReportPreview } from './ReportPreview';

interface ReportBuilderProps {
  types: ReportTypeDto[] | undefined;
  loading: boolean;
}

export function ReportBuilder({ types, loading }: ReportBuilderProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReportFilterValues>(EMPTY_FILTERS);
  const [attempted, setAttempted] = useState(false);
  const def = types?.find((t) => t.type === selected) ?? types?.[0];

  const preview = useMutation({ mutationFn: (params: ReportParams) => reportsApi.preview(params) });
  const generate = useMutation({
    mutationFn: ({ format }: { format: ReportFormat }) => {
      if (!def) throw new Error('Tipo de relatório não escolhido');
      return reportsApi.generate({ ...buildReportParams(def, filters).params, format }, { silent: true });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.reportRuns }),
  });

  const built = def ? buildReportParams(def, filters) : null;
  const periodError = attempted || filters.range[0] ? built?.error : undefined;
  const busy = preview.isPending || generate.isPending;

  const changeFilters = (patch: Partial<ReportFilterValues>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  if (loading) return <Skeleton height={160} />;
  if (!types || types.length === 0 || !def) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        Nenhum tipo de relatório disponível.
      </Text>
    );
  }

  return (
    <Stack gap="lg">
      <Paper withBorder p="md">
        <Stack gap="md">
          <Select
            id="report-type"
            label="Tipo de relatório"
            allowDeselect={false}
            data={types.map((t) => ({ value: t.type, label: t.label }))}
            value={def.type}
            description={def.description}
            onChange={(v) => {
              setSelected(v);
              preview.reset();
              generate.reset();
            }}
            maw={420}
          />
          <ReportFilters def={def} values={filters} onChange={changeFilters} periodError={periodError} idPrefix="report" />
          <Group gap="sm">
            <Button
              leftSection={<IconEye size={16} />}
              loading={preview.isPending}
              disabled={busy && !preview.isPending}
              onClick={() => {
                setAttempted(true);
                if (!built || built.error) return;
                preview.mutate(built.params);
              }}
            >
              Visualizar
            </Button>
            <Button
              variant="default"
              leftSection={<IconFileTypePdf size={16} />}
              loading={generate.isPending && generate.variables.format === 'pdf'}
              disabled={busy && !(generate.isPending && generate.variables.format === 'pdf')}
              onClick={() => {
                setAttempted(true);
                if (built && !built.error) generate.mutate({ format: 'pdf' });
              }}
            >
              Gerar PDF
            </Button>
            <Button
              variant="default"
              leftSection={<IconFileTypeCsv size={16} />}
              loading={generate.isPending && generate.variables.format === 'csv'}
              disabled={busy && !(generate.isPending && generate.variables.format === 'csv')}
              onClick={() => {
                setAttempted(true);
                if (built && !built.error) generate.mutate({ format: 'csv' });
              }}
            >
              Gerar CSV
            </Button>
          </Group>
          <div aria-live="polite">
            {generate.isSuccess && <GeneratedRun run={generate.data} />}
            {generate.isError && <ApiErrorAlert error={generate.error} />}
          </div>
        </Stack>
      </Paper>
      {preview.isPending && <Skeleton height={240} />}
      {preview.isSuccess && <ReportPreview data={preview.data} />}
    </Stack>
  );
}

function GeneratedRun({ run }: { run: ReportRunDto }) {
  if (run.status === 'error') {
    return (
      <Alert color="red" title="Não foi possível gerar o relatório">
        {run.error ?? 'Tente novamente com filtros mais restritos.'}
      </Alert>
    );
  }
  return (
    <Alert color="teal" title={`${FORMAT_LABEL[run.format]} gerado`}>
      <Group justify="space-between" gap="sm">
        <Text size="sm">
          {run.fileName} ({formatBytes(run.size)})
        </Text>
        <Button component="a" href={reportDownloadUrl(run.id)} download={run.fileName} size="xs" leftSection={<IconDownload size={14} />}>
          Baixar {run.fileName}
        </Button>
      </Group>
    </Alert>
  );
}
