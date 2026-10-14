import type { LeftoverKind, PackageManager, PendingActionDto, SoftwareActionResult, SoftwareLeftover, UninstallScanMode } from '../../../api/types';

export const UNINSTALL_TYPE = 'softwareuninstall';
export const CLEANUP_TYPE = 'softwarecleanup';

export const SCAN_MODES: { value: UninstallScanMode; label: string; description: string }[] = [
  { value: 'safe', label: 'Seguro', description: 'Só pastas e chaves com o nome exato do programa e os caminhos registrados por ele.' },
  {
    value: 'moderate',
    label: 'Moderado',
    description: 'Também variações do nome na pasta do fabricante, atalhos, inicialização automática, serviços e tarefas do programa.',
  },
  {
    value: 'advanced',
    label: 'Avançado',
    description: 'Também nomes parecidos fora da pasta do fabricante e o registro do Windows Installer. Revise com atenção.',
  },
];

export const KIND_LABELS: Record<LeftoverKind, string> = {
  key: 'Chave do registro',
  value: 'Inicialização automática',
  dir: 'Pasta',
  file: 'Atalho',
  service: 'Serviço',
  task: 'Tarefa agendada',
};

export const LEVEL_LABELS: Record<SoftwareLeftover['level'], { label: string; color: string }> = {
  high: { label: 'Alta', color: 'teal' },
  medium: { label: 'Média', color: 'yellow' },
  low: { label: 'Baixa', color: 'gray' },
};

/** Le o JSON de detalhes da acao pendente. */
export function actionDetails(action: PendingActionDto): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(action.details);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    // detalhes invalidos: tratados como vazios
  }
  return {};
}

function detailString(details: Record<string, unknown>, key: string): string {
  const value = details[key];
  return typeof value === 'string' ? value : '';
}

/** Nome do programa ou pacote gravado nos detalhes. */
export function actionName(action: PendingActionDto): string {
  return detailString(actionDetails(action), 'name');
}

/** Gerenciador de pacotes das acoes de instalacao; null nas demais. */
export function installManager(action: PendingActionDto): PackageManager | null {
  if (action.type === 'chocoinstall') return 'choco';
  if (action.type === 'wingetinstall') return 'winget';
  return null;
}

/** Texto da coluna "Ação" das acoes pendentes. */
export function describeAction(action: PendingActionDto): string {
  const details = actionDetails(action);
  const name = detailString(details, 'name') || action.details;
  switch (action.type) {
    case UNINSTALL_TYPE:
      return details.runUninstaller === false ? `Remoção forçada de ${name}` : `Desinstalar ${name}`;
    case CLEANUP_TYPE: {
      const count = typeof details.count === 'number' ? details.count : 0;
      return `Remover ${count} sobra(s) de ${name}`;
    }
    default:
      return `Instalar ${name}`;
  }
}

export function isSoftwareResultType(type: string): boolean {
  return type === UNINSTALL_TYPE || type === CLEANUP_TYPE;
}

/** Resultado estruturado da desinstalacao ou da limpeza; null enquanto pendente ou se a saida nao for JSON. */
export function actionResult(action: PendingActionDto): SoftwareActionResult | null {
  if (!isSoftwareResultType(action.type) || !action.output) return null;
  try {
    const parsed = JSON.parse(action.output) as Partial<SoftwareActionResult> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ok: parsed.ok === true,
      results: typeof parsed.results === 'string' ? parsed.results : '',
      leftovers: Array.isArray(parsed.leftovers) ? parsed.leftovers : [],
      scanned: parsed.scanned === true,
      ranUninstaller: parsed.ranUninstaller === true,
      stillInstalled: parsed.stillInstalled === true,
      removed: typeof parsed.removed === 'number' ? parsed.removed : 0,
      failed: typeof parsed.failed === 'number' ? parsed.failed : 0,
      backup: typeof parsed.backup === 'string' ? parsed.backup : null,
      reboot: parsed.reboot === true,
    };
  } catch {
    return null;
  }
}

/** Texto mostrado ao expandir a acao. */
export function actionOutput(action: PendingActionDto): string {
  return actionResult(action)?.results ?? action.output ?? '';
}

export function leftoverId(item: Pick<SoftwareLeftover, 'kind' | 'path' | 'name'>): string {
  return `${item.kind}\u0000${item.path}\u0000${item.name ?? ''}`;
}

/**
 * Sobras marcadas ao abrir a revisao: as de alta confianca fora dos perfis de usuario. Nada vem marcado quando o
 * desinstalador terminou mas o programa continua registrado (caso duvidoso).
 */
export function defaultSelection(result: SoftwareActionResult): Set<string> {
  if (result.ranUninstaller && result.stillInstalled) return new Set();
  return new Set(result.leftovers.filter((l) => l.level === 'high' && !l.user).map(leftoverId));
}
