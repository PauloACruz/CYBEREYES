import { useSearchParams } from 'react-router';
import type { ProcedureKind } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { ProcedureBrowser, type LinkedFilter, type ProcedureFilters } from './ProcedureBrowser';
import { PROCEDURE_KINDS } from './procedureFormat';

const LINKED: LinkedFilter[] = ['todos', 'sem-chamado', 'em-chamado'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(params: URLSearchParams): ProcedureFilters {
  const client = Number(params.get('cliente'));
  const kind = params.get('tipo');
  const linked = params.get('chamado');
  const from = params.get('de');
  const to = params.get('ate');
  return {
    clientId: Number.isInteger(client) && client > 0 ? client : undefined,
    userId: params.get('tecnico') ?? undefined,
    kind: PROCEDURE_KINDS.includes(kind as ProcedureKind) ? (kind as ProcedureKind) : undefined,
    linked: LINKED.includes(linked as LinkedFilter) ? (linked as LinkedFilter) : 'todos',
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  };
}

function writeFilters(f: ProcedureFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.clientId) params.set('cliente', String(f.clientId));
  if (f.userId) params.set('tecnico', f.userId);
  if (f.kind) params.set('tipo', f.kind);
  if (f.linked !== 'todos') params.set('chamado', f.linked);
  if (f.from) params.set('de', f.from);
  if (f.to) params.set('ate', f.to);
  return params;
}

/** Tudo o que foi feito nos agentes: acessos remotos, Cybereyes Care, comandos, reinicios... com o tempo de cada um. */
export function ProceduresPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  return (
    <>
      <PageHeader
        title="Procedimentos"
        description="Tudo o que foi feito nos agentes, com o técnico, a duração e o resultado. Selecione os que ainda não estão num chamado para incluí-los num chamado aberto ou registrar um chamado com eles."
      />
      <ProcedureBrowser filters={readFilters(searchParams)} onFiltersChange={(f) => setSearchParams(writeFilters(f), { replace: true })} />
    </>
  );
}
