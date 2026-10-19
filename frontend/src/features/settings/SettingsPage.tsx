import { Stack } from '@mantine/core';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { AssistantSection } from './AssistantSection';
import { KeystoreSection } from './KeystoreSection';
import { LogAlertRulesSection } from './LogAlertRulesSection';
import { LogsSection } from './LogsSection';
import { NotificationsSection } from './NotificationsSection';
import { RemotePoliciesSection } from './RemotePoliciesSection';
import { SelfServiceSection } from './SelfServiceSection';
import { SsoSection } from './SsoSection';
import { TicketsSection } from './TicketsSection';
import { UrlActionsSection } from './UrlActionsSection';

export function SettingsPage() {
  const { data: me } = useMe();
  return (
    <>
      <PageHeader title="Configurações" description="Notificações, assistente de IA, valores globais e atalhos usados nas ações sobre os agentes." />
      <Stack gap="xl">
        <NotificationsSection />
        <AssistantSection />
        <KeystoreSection />
        <UrlActionsSection />
        <RemotePoliciesSection />
        <SsoSection />
        <TicketsSection />
        <SelfServiceSection />
        <LogsSection />
        {hasPermission(me, PERMISSIONS.alertsManage) && <LogAlertRulesSection />}
      </Stack>
    </>
  );
}
