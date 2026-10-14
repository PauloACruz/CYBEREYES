import type { CommandShell } from '../../../api/types';

export interface QuickCommand {
  label: string;
  command: string;
}

/*
 * Comandos rapidos do app: so leitura ou acoes reversiveis do dia a dia. Nada que derrube a rede da
 * maquina (como liberar o IP), porque o agente perderia a conexao no meio do comando.
 */
const CMD: readonly QuickCommand[] = [
  { label: 'Configuração de rede', command: 'ipconfig /all' },
  { label: 'Limpar cache DNS', command: 'ipconfig /flushdns' },
  { label: 'Reiniciar o Spooler', command: 'net stop spooler && net start spooler' },
  { label: 'Usuários logados', command: 'quser' },
  { label: 'Teste de conexão', command: 'ping -n 4 8.8.8.8' },
];

const POWERSHELL: readonly QuickCommand[] = [
  {
    label: 'Espaço em disco',
    command: "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{n='Livre (GB)';e={[math]::Round($_.Free/1GB,1)}}, @{n='Usado (GB)';e={[math]::Round($_.Used/1GB,1)}}",
  },
  {
    label: 'Serviços automáticos parados',
    command: "Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } | Select-Object Name, DisplayName, Status",
  },
  { label: 'Reiniciar o Spooler', command: 'Restart-Service -Name Spooler -Force' },
  { label: 'Limpar cache DNS', command: 'Clear-DnsClientCache' },
  { label: 'Tempo ligado', command: '(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime' },
  {
    label: 'Processos que mais usam memória',
    command: "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Name, Id, @{n='Memória (MB)';e={[math]::Round($_.WorkingSet64/1MB)}}",
  },
];

const UNIX: readonly QuickCommand[] = [
  { label: 'Espaço em disco', command: 'df -h' },
  { label: 'Memória', command: 'free -h' },
  { label: 'Tempo ligado e carga', command: 'uptime' },
  { label: 'Serviços com falha', command: 'systemctl --failed --no-pager' },
  { label: 'Processos que mais usam memória', command: 'ps aux --sort=-%mem | head -n 11' },
  { label: 'Teste de conexão', command: 'ping -c 4 8.8.8.8' },
];

export function quickCommandsFor(shell: CommandShell): readonly QuickCommand[] {
  if (shell === 'cmd') return CMD;
  if (shell === 'powershell') return POWERSHELL;
  return UNIX;
}
