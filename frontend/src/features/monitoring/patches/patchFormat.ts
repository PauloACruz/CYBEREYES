import type { PatchPolicy, PatchRule, RebootAfterInstall } from '../../../api/types';

export const PATCH_RULE_OPTIONS: { value: PatchRule; label: string }[] = [
  { value: 'approve', label: 'Aprovar' },
  { value: 'ignore', label: 'Ignorar' },
  { value: 'manual', label: 'Manual' },
];

export const PATCH_CATEGORIES: { key: 'critical' | 'important' | 'moderate' | 'low' | 'other'; label: string }[] = [
  { key: 'critical', label: 'Críticas' },
  { key: 'important', label: 'Importantes' },
  { key: 'moderate', label: 'Moderadas' },
  { key: 'low', label: 'Baixas' },
  { key: 'other', label: 'Outras' },
];

export const REBOOT_OPTIONS: { value: RebootAfterInstall; label: string }[] = [
  { value: 'never', label: 'Nunca reiniciar' },
  { value: 'required', label: 'Reiniciar se necessário' },
  { value: 'always', label: 'Sempre reiniciar' },
];

export function patchRuleLabel(rule: PatchRule): string {
  return PATCH_RULE_OPTIONS.find((o) => o.value === rule)?.label ?? rule;
}

export function defaultPatchPolicy(): PatchPolicy {
  return {
    critical: 'manual',
    important: 'manual',
    moderate: 'manual',
    low: 'manual',
    other: 'manual',
    runTimeDays: [],
    runTimeHour: 3,
    rebootAfterInstall: 'never',
  };
}

export function pickPatchPolicy(p: PatchPolicy): PatchPolicy {
  return {
    critical: p.critical,
    important: p.important,
    moderate: p.moderate,
    low: p.low,
    other: p.other,
    runTimeDays: [...p.runTimeDays].sort((a, b) => a - b),
    runTimeHour: p.runTimeHour,
    rebootAfterInstall: p.rebootAfterInstall,
  };
}
