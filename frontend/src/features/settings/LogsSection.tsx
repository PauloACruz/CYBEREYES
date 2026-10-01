import { useState } from 'react';
import { Button, Checkbox, Group, NumberInput, Paper, Select, SimpleGrid, Skeleton, Stack, Switch, TagsInput, Text, Title } from '@mantine/core';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logsApi } from '../../api/logs';
import { queryKeys } from '../../api/queryKeys';
import type { LogCollectLevel, LogSettingsDto } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { isLogCollectLevel, LOG_COLLECT_LEVEL_OPTIONS } from '../logs/logFormat';

const STANDARD_LOGS = ['System', 'Application', 'Security'] as const;

function isStandard(name: string): boolean {
  return (STANDARD_LOGS as readonly string[]).some((s) => s.toLowerCase() === name.toLowerCase());
}

function LogSettingsForm({ initial }: { initial: LogSettingsDto }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [minLevel, setMinLevel] = useState<LogCollectLevel>(initial.minLevel);
  const [standard, setStandard] = useState<string[]>(() => STANDARD_LOGS.filter((s) => initial.windowsLogs.some((w) => w.toLowerCase() === s.toLowerCase())));
  const [others, setOthers] = useState<string[]>(() => initial.windowsLogs.filter((w) => !isStandard(w)));
  const [maxPerCycle, setMaxPerCycle] = useState<number | string>(initial.maxPerCycle);
  const [retentionDays, setRetentionDays] = useState<number | string>(initial.retentionDays);

  const max = Number(maxPerCycle);
  const retention = Number(retentionDays);
  const maxError = Number.isInteger(max) && max >= 50 && max <= 5000 ? undefined : 'Entre 50 e 5000';
  const retentionError = Number.isInteger(retention) && retention >= 1 && retention <= 365 ? undefined : 'Entre 1 e 365 dias';

  const save = useMutation({
    mutationFn: () =>
      logsApi.saveSettings({
        enabled,
        minLevel,
        windowsLogs: [...standard, ...others.map((o) => o.trim()).filter((o) => o && !isStandard(o))],
        maxPerCycle: max,
        retentionDays: retention,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.logSettings, saved);
      notifySuccess('Configuração de logs salva.');
    },
  });

  return (
    <Paper withBorder p="lg">
      <Stack gap="md">
        <Switch label="Coletar logs de sistema" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Nível mínimo"
            description="Eventos abaixo deste nível não são enviados"
            data={LOG_COLLECT_LEVEL_OPTIONS}
            value={minLevel}
            onChange={(v) => isLogCollectLevel(v) && setMinLevel(v)}
            allowDeselect={false}
          />
          <NumberInput
            label="Máximo por ciclo"
            description="Por máquina, a cada 60 segundos"
            min={50}
            max={5000}
            allowDecimal={false}
            value={maxPerCycle}
            onChange={setMaxPerCycle}
            error={maxError}
          />
          <NumberInput
            label="Retenção (dias)"
            description="Logs e amostras SNMP mais antigos são apagados"
            min={1}
            max={365}
            allowDecimal={false}
            value={retentionDays}
            onChange={setRetentionDays}
            error={retentionError}
          />
        </SimpleGrid>
        <Checkbox.Group
          label="Logs do Windows"
          description="Security aumenta muito o volume de eventos."
          value={standard}
          onChange={setStandard}
        >
          <Group mt="xs">
            {STANDARD_LOGS.map((name) => (
              <Checkbox key={name} value={name} label={name} />
            ))}
          </Group>
        </Checkbox.Group>
        <TagsInput
          label="Outros logs do Windows"
          description="Digite o nome do log e tecle Enter, por exemplo Microsoft-Windows-PowerShell/Operational"
          placeholder="Nome do log"
          value={others}
          onChange={setOthers}
          clearable
        />
        <Text size="xs" c="dimmed">
          Linux usa o journald e macOS o log unificado, sempre respeitando o nível mínimo.
        </Text>
        <Group justify="flex-end">
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} disabled={Boolean(maxError ?? retentionError)} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function LogsSection() {
  const settings = useQuery({ queryKey: queryKeys.logSettings, queryFn: logsApi.settings });
  return (
    <section aria-labelledby="logs-settings-title">
      <div>
        <Title order={3} id="logs-settings-title">
          Logs de sistema
        </Title>
        <Text size="sm" c="dimmed" mb="xs">
          O que os agentes coletam do Event Log, journald e log unificado, e por quanto tempo os registros ficam guardados.
        </Text>
      </div>
      {settings.isError && <LoadError error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.isPending && <Skeleton height={160} />}
      {settings.data && <LogSettingsForm initial={settings.data} />}
    </section>
  );
}
