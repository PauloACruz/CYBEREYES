import { IconCircleCheck, IconCircleX, IconClockHour4, IconPlayerPause, type Icon } from '@tabler/icons-react';
import type { AppRunStatus, WebAppDto, WebAppStatus } from '../../api/types';

export const WEBAPP_STATUS_INFO: Record<WebAppStatus, { label: string; color: string; icon: Icon }> = {
  up: { label: 'No ar', color: 'teal', icon: IconCircleCheck },
  down: { label: 'Fora do ar', color: 'red', icon: IconCircleX },
  pending: { label: 'Verificando', color: 'gray', icon: IconClockHour4 },
  paused: { label: 'Pausado', color: 'gray', icon: IconPlayerPause },
};

export const RUN_STATUS_INFO: Record<AppRunStatus, { label: string; color: string }> = {
  running: { label: 'Executando', color: 'blue' },
  success: { label: 'Concluído', color: 'teal' },
  failed: { label: 'Falhou', color: 'red' },
  cancelled: { label: 'Cancelado', color: 'gray' },
  timeout: { label: 'Tempo esgotado', color: 'orange' },
};

export const ENVIRONMENT_OPTIONS = ['Produção', 'Homologação', 'Desenvolvimento', 'Teste'];

export const STACK_SUGGESTIONS = ['Docker Compose', 'Node.js', 'Next.js', 'PHP', 'WordPress', 'Laravel', '.NET', 'Python', 'Java', 'Site estático'];

export const INTERVAL_OPTIONS = [
  { value: '30', label: '30 segundos' },
  { value: '60', label: '1 minuto' },
  { value: '120', label: '2 minutos' },
  { value: '300', label: '5 minutos' },
  { value: '600', label: '10 minutos' },
  { value: '1800', label: '30 minutos' },
  { value: '3600', label: '1 hora' },
];

/** Sugestoes de comandos salvos para servidores Linux (inseridas no formulario). */
export const COMMAND_TEMPLATES: { name: string; script: string; confirm?: boolean }[] = [
  { name: 'Uso de disco', script: 'df -h' },
  { name: 'Memória', script: 'free -h' },
  { name: 'Carga e tempo ligado', script: 'uptime' },
  { name: 'Containers', script: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"' },
  { name: 'Status do Compose', script: 'docker compose ps' },
  { name: 'Logs do Compose (200 linhas)', script: 'docker compose logs --tail=200 --no-color' },
  { name: 'Reiniciar o Compose', script: 'docker compose restart', confirm: true },
  { name: 'Processos PM2', script: 'pm2 status' },
  { name: 'Reiniciar PM2', script: 'pm2 restart all', confirm: true },
  { name: 'Testar e recarregar o Nginx', script: 'sudo nginx -t && sudo systemctl reload nginx', confirm: true },
  { name: 'Últimos erros do sistema', script: 'journalctl -p err -n 100 --no-pager' },
];

export const DEPLOY_TEMPLATES: { label: string; script: string }[] = [
  {
    label: 'Git + Docker Compose',
    script: 'git fetch --all --prune\ngit checkout "${DEPLOY_BRANCH:-main}"\ngit pull --ff-only\ndocker compose pull\ndocker compose up -d --build\ndocker image prune -f',
  },
  {
    label: 'Git + Node.js (PM2)',
    script: 'git pull --ff-only\nnpm ci\nnpm run build\npm2 reload "$CYBEREYES_APP" || pm2 restart all',
  },
  {
    label: 'Git + PHP (Composer)',
    script: 'git pull --ff-only\ncomposer install --no-dev --optimize-autoloader\nphp artisan migrate --force\nphp artisan optimize',
  },
];

/** Contagem por status para o resumo do topo. */
export function summarize(apps: WebAppDto[]): Record<WebAppStatus, number> & { total: number; sslSoon: number } {
  const now = Date.now();
  const summary = { up: 0, down: 0, pending: 0, paused: 0, total: apps.length, sslSoon: 0 };
  for (const app of apps) {
    summary[app.status] += 1;
    if (app.sslExpiresAt && new Date(app.sslExpiresAt).getTime() - now < 14 * 86_400_000) summary.sslSoon += 1;
  }
  return summary;
}

const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function formatUptime(value: number | null): string {
  return value === null ? 'Sem dados' : `${percent.format(value)}%`;
}

export function uptimeColor(value: number | null): string | undefined {
  if (value === null) return undefined;
  if (value >= 99.5) return 'teal';
  if (value >= 95) return 'yellow';
  return 'red';
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return 'Sem dados';
  return ms >= 1000 ? `${percent.format(ms / 1000)} s` : `${ms} ms`;
}

/** Dias ate o vencimento do certificado (negativo se ja venceu). */
export function daysUntil(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  return Math.floor((new Date(value).getTime() - now) / 86_400_000);
}

/** Endereco mostrado do servidor: usuario@host:porta (porta so quando nao e 22). */
export function sshAddress(server: { username: string; host: string; port: number }): string {
  return `${server.username}@${server.host}${server.port === 22 ? '' : `:${server.port}`}`;
}
