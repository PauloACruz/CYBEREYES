import { Group, Select, Tabs } from '@mantine/core';
import { IconFileText, IconKey, IconNetwork, IconSitemap, type Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { useClients } from '../clients/useClients';
import { toId } from '../inventory/inventoryFormat';
import { CredentialsTab } from './credentials/CredentialsTab';
import { DiagramsTab } from './diagrams/DiagramsTab';
import { NetworksTab } from './networks/NetworksTab';
import { DocPagesTab } from './pages/DocPagesTab';

interface TabDef {
  value: string;
  label: string;
  icon: Icon;
  render: () => ReactNode;
}

export function DocsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.docsManage);
  const canManageCredentials = hasPermission(me, PERMISSIONS.credentialsManage);
  const canReveal = hasPermission(me, PERMISSIONS.credentialsReveal);
  const clients = useClients();
  const [searchParams, setSearchParams] = useSearchParams();
  const clientId = toId(searchParams.get('cliente'));

  const tabs: TabDef[] = [
    { value: 'redes', label: 'Redes', icon: IconNetwork, render: () => <NetworksTab clientId={clientId} canManage={canManage} /> },
    { value: 'diagramas', label: 'Diagramas', icon: IconSitemap, render: () => <DiagramsTab clientId={clientId} canManage={canManage} /> },
    {
      value: 'credenciais',
      label: 'Credenciais',
      icon: IconKey,
      render: () => <CredentialsTab clientId={clientId} canManage={canManageCredentials} canReveal={canReveal} />,
    },
    { value: 'paginas', label: 'Páginas', icon: IconFileText, render: () => <DocPagesTab clientId={clientId} canManage={canManage} /> },
  ];

  const requested = searchParams.get('aba');
  const activeTab = tabs.some((t) => t.value === requested) ? (requested ?? 'redes') : 'redes';

  const update = (key: string, value: string | null, defaultValue?: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === defaultValue) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <>
      <PageHeader
        title="Documentação"
        description="Redes, diagramas, credenciais e páginas de documentação dos clientes."
        actions={
          <Select
            aria-label="Filtrar por cliente"
            placeholder="Todos os clientes"
            clearable
            searchable
            data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            value={clientId ? String(clientId) : null}
            onChange={(v) => update('cliente', v)}
            w={220}
          />
        }
      />
      <Tabs value={activeTab} onChange={(v) => update('aba', v, 'redes')} keepMounted={false}>
        <Group mb="md">
          <Tabs.List>
            {tabs.map((tab) => (
              <Tabs.Tab key={tab.value} value={tab.value} leftSection={<tab.icon size={16} />}>
                {tab.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Group>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.value} value={tab.value}>
            {tab.render()}
          </Tabs.Panel>
        ))}
      </Tabs>
    </>
  );
}
