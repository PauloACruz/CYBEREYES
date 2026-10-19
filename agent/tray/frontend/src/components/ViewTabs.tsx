export type Tab = 'tickets' | 'selfService' | 'help';

interface Props {
  active: Tab;
  running: boolean;
  /** Mostra a aba "Resolver sozinho" (autoatendimento liberado). */
  selfService: boolean;
  /** Mostra a aba "Ajuda" (há perguntas frequentes publicadas). */
  help: boolean;
  onChange: (tab: Tab) => void;
}

export function ViewTabs({ active, running, selfService, help, onChange }: Props) {
  const tab = (id: Tab, label: string) => (
    <button
      type="button"
      className={`tab${active === id ? ' tab-active' : ''}`}
      aria-current={active === id ? 'page' : undefined}
      onClick={() => { onChange(id); }}
    >
      {label}
      {id === 'selfService' && running && <span className="tab-dot" aria-label="Ação em andamento" title="Ação em andamento" />}
    </button>
  );
  return (
    <nav className="tabs" aria-label="Seções">
      {tab('tickets', 'Meus chamados')}
      {help && tab('help', 'Ajuda')}
      {selfService && tab('selfService', 'Resolver sozinho')}
    </nav>
  );
}
