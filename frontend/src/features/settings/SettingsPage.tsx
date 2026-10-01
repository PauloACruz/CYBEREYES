import { Stack } from '@mantine/core';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { KeystoreSection } from './KeystoreSection';
import { LogAlertRulesSection } from './LogAlertRulesSection';
import { LogsSection } from './LogsSection';
import { MeshSection } from './MeshSection';
import { NotificationsSection } from './NotificationsSection';
import { SelfServiceSection } from './SelfServiceSection';
import { TicketsSection } from './TicketsSection';
import { UrlActionsSection } from './UrlActionsSection';

export function SettingsPage() {
  const { data: me } = useMe();
  return (
    <>
      <PageHeader title="Configurações" description="Notificações, valores globais e atalhos usados nas ações sobre os agentes." />
      <Stack gap="xl">
        <NotificationsSection />
        <KeystoreSection />
        <UrlActionsSection />
        <MeshSection />
        <TicketsSection />
        <SelfServiceSection />
        <LogsSection />
        {hasPermission(me, PERMISSIONS.alertsManage) && <LogAlertRulesSection />}
      </Stack>
    </>
  );
}
