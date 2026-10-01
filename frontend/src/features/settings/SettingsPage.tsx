import { Stack } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import { KeystoreSection } from './KeystoreSection';
import { UrlActionsSection } from './UrlActionsSection';

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Valores globais e atalhos usados nas ações sobre os agentes." />
      <Stack gap="xl">
        <KeystoreSection />
        <UrlActionsSection />
      </Stack>
    </>
  );
}
