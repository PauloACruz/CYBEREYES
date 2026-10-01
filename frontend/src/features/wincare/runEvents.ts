import type { WinCareEvent, WinCareRunDto } from '../../api/types';

/** Junta eventos sem repetir `seq` e devolve a lista ordenada por `seq`. */
export function mergeRunEvents(current: readonly WinCareEvent[], incoming: readonly WinCareEvent[]): WinCareEvent[] {
  const bySeq = new Map<number, WinCareEvent>();
  for (const event of current) bySeq.set(event.seq, event);
  for (const event of incoming) if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Aplica um evento do hub sobre a execucao em cache (eventos repetidos sao ignorados). */
export function applyRunEvent(run: WinCareRunDto, event: WinCareEvent): WinCareRunDto {
  const events = run.events ?? [];
  if (events.some((e) => e.seq === event.seq)) return run;
  const next: WinCareRunDto = { ...run, events: mergeRunEvents(events, [event]) };
  switch (event.type) {
    case 'progress':
      next.progress = Math.max(run.progress, event.value);
      break;
    case 'task': {
      const newer = events.some((e) => e.type === 'task' && e.key === event.key && e.seq > event.seq);
      if (!newer) next.taskStatus = { ...run.taskStatus, [event.key]: event.status };
      break;
    }
    case 'done':
      next.status = event.status;
      next.rebootRequired = event.rebootRequired;
      next.finishedAt = run.finishedAt ?? event.time;
      break;
    default:
      break;
  }
  return next;
}

/** Evento wincareRunChanged: o resumo vem do servidor, os eventos ja recebidos ficam. */
export function applyRunChanged(previous: WinCareRunDto, run: WinCareRunDto): WinCareRunDto {
  return { ...run, events: mergeRunEvents(previous.events ?? [], run.events ?? []) };
}
