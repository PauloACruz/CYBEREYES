import { useState } from 'react';
import { Button, Chip, Group, Input, NumberInput, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import type { PatchPolicy } from '../../../api/types';
import { WEEKDAYS } from '../monitoringFormat';
import { joinPt } from '../tasks/schedule';
import { defaultPatchPolicy, PATCH_CATEGORIES, PATCH_RULE_OPTIONS, patchRuleLabel, pickPatchPolicy, REBOOT_OPTIONS } from './patchFormat';

interface PatchPolicyFormProps {
  initial: PatchPolicy | null;
  saving: boolean;
  onSave: (policy: PatchPolicy) => void;
  onCancel?: () => void;
}

export function PatchPolicyForm({ initial, saving, onSave, onCancel }: PatchPolicyFormProps) {
  const [value, setValue] = useState<PatchPolicy>(() => pickPatchPolicy(initial ?? defaultPatchPolicy()));
  const hourValid = Number.isInteger(value.runTimeHour) && value.runTimeHour >= 0 && value.runTimeHour <= 23;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 5 }}>
        {PATCH_CATEGORIES.map((cat) => (
          <Select
            key={cat.key}
            label={cat.label}
            allowDeselect={false}
            data={PATCH_RULE_OPTIONS}
            value={value[cat.key]}
            onChange={(v) => v && setValue({ ...value, [cat.key]: v })}
          />
        ))}
      </SimpleGrid>
      <Input.Wrapper label="Dias de instalação" description="Sem dias marcados, a instalação automática não é agendada">
        <Chip.Group
          multiple
          value={value.runTimeDays.map(String)}
          onChange={(days) => setValue({ ...value, runTimeDays: days.map(Number).sort((a, b) => a - b) })}
        >
          <Group gap={6} mt={6}>
            {WEEKDAYS.map((d) => (
              <Chip key={d.value} value={String(d.value)} size="sm" aria-label={d.long}>
                {d.short}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </Input.Wrapper>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <NumberInput
          label="Hora da instalação"
          min={0}
          max={23}
          allowDecimal={false}
          suffix="h"
          value={value.runTimeHour}
          error={hourValid ? undefined : 'Entre 0 e 23'}
          onChange={(v) => setValue({ ...value, runTimeHour: typeof v === 'number' ? v : Number.parseInt(v, 10) })}
        />
        <Select
          label="Reinício após instalar"
          allowDeselect={false}
          data={REBOOT_OPTIONS}
          value={value.rebootAfterInstall}
          onChange={(v) => v && setValue({ ...value, rebootAfterInstall: v })}
        />
      </SimpleGrid>
      <Group justify="flex-end">
        {onCancel && (
          <Button variant="default" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button loading={saving} disabled={!hourValid} onClick={() => onSave(value)}>
          Salvar política de patch
        </Button>
      </Group>
    </Stack>
  );
}

/** Resumo somente leitura de uma politica de patch. */
export function PatchPolicySummary({ policy }: { policy: PatchPolicy }) {
  const days = policy.runTimeDays.map((d) => WEEKDAYS[d]?.long ?? String(d));
  return (
    <Stack gap={4}>
      <Text size="sm">{PATCH_CATEGORIES.map((c) => `${c.label}: ${patchRuleLabel(policy[c.key]).toLowerCase()}`).join(' · ')}</Text>
      <Text size="sm" c="dimmed">
        {days.length ? `Instala ${joinPt(days)}, às ${policy.runTimeHour}h` : 'Sem dias de instalação automática'} ·{' '}
        {REBOOT_OPTIONS.find((r) => r.value === policy.rebootAfterInstall)?.label ?? policy.rebootAfterInstall}
      </Text>
    </Stack>
  );
}
