import { Badge, Group, Text, Tooltip } from '@mantine/core';
import { IconBell, IconMail, IconWebhook } from '@tabler/icons-react';
import type { CheckStatus, Severity } from '../../api/types';
import { CHECK_STATUS_INFO, isSeverity, SEVERITY_INFO } from './monitoringFormat';

type BadgeSize = 'xs' | 'sm' | 'md';

export function SeverityBadge({ severity, size = 'sm' }: { severity: Severity; size?: BadgeSize }) {
  const info = SEVERITY_INFO[severity];
  return (
    <Badge color={info.color} variant="light" size={size} leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}

/** Status do check; em falha mostra tambem a severidade (texto e icone, nao so cor). */
export function CheckStatusBadge({ status, severity }: { status: CheckStatus | null; severity: string | null }) {
  if (status === 'failing' && isSeverity(severity)) {
    const info = SEVERITY_INFO[severity];
    return (
      <Badge color={info.color} variant="light" leftSection={<info.icon size={12} aria-hidden />}>
        Falha: {info.label.toLowerCase()}
      </Badge>
    );
  }
  const info = CHECK_STATUS_INFO[status ?? 'pending'];
  return (
    <Badge color={info.color} variant="light" leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}

/** Canais de alerta ligados (e-mail, webhook, painel). */
export function AlertChannels({ email, webhook, dashboard }: { email: boolean; webhook: boolean; dashboard: boolean }) {
  const channels = [
    { on: email, label: 'E-mail', icon: IconMail },
    { on: webhook, label: 'Webhook', icon: IconWebhook },
    { on: dashboard, label: 'Painel', icon: IconBell },
  ].filter((c) => c.on);
  if (channels.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Nenhum
      </Text>
    );
  }
  return (
    <Group gap={6} wrap="nowrap">
      {channels.map((c) => (
        <Tooltip key={c.label} label={c.label} withArrow>
          <c.icon size={16} aria-label={c.label} role="img" />
        </Tooltip>
      ))}
    </Group>
  );
}

export function InheritedBadge({ policyName }: { policyName: string | null }) {
  return (
    <Tooltip label={policyName ? `Herdado da política ${policyName}` : 'Herdado de uma política'} withArrow>
      <Badge variant="outline" color="gray" size="sm">
        Herdado
      </Badge>
    </Tooltip>
  );
}
