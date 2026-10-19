import { useState } from 'react';
import { Badge, Button, Select, Tabs } from '@mantine/core';
import { IconBulb, IconHelpCircle, IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { faqApi } from '../../api/assistant';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type FaqEntryDto } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { useClients } from '../clients/useClients';
import { toId } from '../inventory/inventoryFormat';
import { FaqArticles } from './FaqArticles';
import { FaqFormModal } from './FaqFormModal';
import { FaqSuggestions } from './FaqSuggestions';

const TABS = ['publicadas', 'sugestoes'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return (TABS as readonly (string | null)[]).includes(value);
}

/**
 * FAQ: problemas conhecidos e como resolver. A equipe, o assistente de IA (a partir dos chamados resolvidos) e os usuários do
 * app EYES alimentam; o assistente no chat, os técnicos nas respostas e os usuários na ajuda do app consultam.
 */
export function FaqPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.docsManage);
  const clients = useClients();
  const [searchParams, setSearchParams] = useSearchParams();
  const clientId = toId(searchParams.get('cliente'));
  const requested = searchParams.get('aba');
  const tab: Tab = isTab(requested) ? requested : 'publicadas';
  const overview = useQuery({ queryKey: queryKeys.faqOverview(clientId), queryFn: () => faqApi.overview(clientId) });
  const [editing, setEditing] = useState<FaqEntryDto | null>(null);
  const [opened, setOpened] = useState(false);

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

  const open = (entry: FaqEntryDto | null) => {
    setEditing(entry);
    setOpened(true);
  };

  const proposed = overview.data?.proposed ?? 0;

  return (
    <>
      <PageHeader
        title="FAQ"
        description="Problemas conhecidos e como resolver. A equipe, o assistente de IA e os usuários do app EYES alimentam; o assistente no chat, os técnicos e os usuários na ajuda do app consultam."
        actions={
          <>
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
            <Button leftSection={<IconPlus size={16} />} onClick={() => open(null)}>
              {canManage ? 'Nova entrada' : 'Sugerir entrada'}
            </Button>
          </>
        }
      />
      <Tabs value={tab} onChange={(v) => update('aba', v, 'publicadas')} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="publicadas" leftSection={<IconHelpCircle size={16} />}>
            Publicadas
          </Tabs.Tab>
          <Tabs.Tab
            value="sugestoes"
            leftSection={<IconBulb size={16} />}
            rightSection={
              proposed > 0 ? (
                <Badge size="sm" circle={proposed < 10} color="orange" aria-label={`${proposed} aguardando revisão`}>
                  {proposed}
                </Badge>
              ) : undefined
            }
          >
            Sugestões
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="publicadas">
          <FaqArticles clientId={clientId} canManage={canManage} overview={overview.data} onEdit={open} />
        </Tabs.Panel>
        <Tabs.Panel value="sugestoes">
          <FaqSuggestions clientId={clientId} canManage={canManage} onReview={open} />
        </Tabs.Panel>
      </Tabs>
      <FaqFormModal opened={opened} onClose={() => setOpened(false)} entry={editing} defaultClientId={clientId} />
    </>
  );
}
