import { useState } from 'react';
import type { AgentDetail } from '../../api/types';
import { ProcedureBrowser, type ProcedureFilters } from './ProcedureBrowser';

/** Procedimentos feitos nesta maquina, com as mesmas acoes da pagina geral. */
export function AgentProceduresTab({ agent }: { agent: AgentDetail }) {
  const [filters, setFilters] = useState<ProcedureFilters>({ linked: 'todos' });
  return <ProcedureBrowser agentId={agent.id} filters={filters} onFiltersChange={setFilters} />;
}
