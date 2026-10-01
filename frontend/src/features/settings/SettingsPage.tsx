import { Stack } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import { KeystoreSection } from './KeystoreSection';
import { MeshSection } from './MeshSection';
import { NotificationsSection } from './NotificationsSection';
import { UrlActionsSection } from './UrlActionsSection';

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Notificações, valores globais e atalhos usados nas ações sobre os agentes." />
      <Stack gap="xl">
        <NotificationsSection />
        <KeystoreSection />
        <UrlActionsSection />
        <MeshSection />
      </Stack>
    </>
  );
}
