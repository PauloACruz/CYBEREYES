import type { ScriptPlatform, ScriptShell } from '../../api/types';

export const SCRIPT_SHELLS: readonly { value: ScriptShell; label: string }[] = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Batch (cmd)' },
  { value: 'python', label: 'Python' },
  { value: 'shell', label: 'Shell (Linux e macOS)' },
  { value: 'nushell', label: 'Nushell' },
  { value: 'deno', label: 'Deno' },
];

export const SCRIPT_PLATFORMS: readonly { value: ScriptPlatform; label: string }[] = [
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
  { value: 'darwin', label: 'macOS' },
];

export function shellLabel(shell: string): string {
  return SCRIPT_SHELLS.find((s) => s.value === shell)?.label ?? shell;
}

export function platformLabel(plat: string): string {
  return SCRIPT_PLATFORMS.find((p) => p.value === plat)?.label ?? plat;
}

/** Linguagem do Monaco para cada shell. */
export function editorLanguage(shell: ScriptShell): string {
  switch (shell) {
    case 'powershell':
      return 'powershell';
    case 'cmd':
      return 'bat';
    case 'python':
      return 'python';
    case 'shell':
      return 'shell';
    case 'deno':
      return 'javascript';
    case 'nushell':
      return 'plaintext';
  }
}

/** Variaveis aceitas em argumentos, variaveis de ambiente e padroes de URL actions. */
export const TEMPLATE_VARIABLES: readonly { name: string; description: string }[] = [
  { name: '{{agent.hostname}}', description: 'Nome da máquina' },
  { name: '{{agent.agent_id}}', description: 'Identificador do agente' },
  { name: '{{agent.description}}', description: 'Descrição do agente' },
  { name: '{{agent.public_ip}}', description: 'IP público' },
  { name: '{{client.name}}', description: 'Nome do cliente' },
  { name: '{{site.name}}', description: 'Nome do site' },
  { name: '{{global.NOME}}', description: 'Valor da chave NOME no keystore global' },
];

export function supportsPlatform(script: { platforms: readonly string[] }, plat: string): boolean {
  return script.platforms.includes(plat);
}
