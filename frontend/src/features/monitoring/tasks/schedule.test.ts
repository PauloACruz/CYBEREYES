import { describe, expect, it } from 'vitest';
import { describeSchedule } from './schedule';

const base = { runAt: null, time: '08:00', daysOfWeek: [], dayOfMonth: null, assignedCheckId: null };

describe('describeSchedule', () => {
  it('descreve o agendamento semanal com os dias em ordem e o horário', () => {
    expect(describeSchedule({ ...base, scheduleType: 'weekly', daysOfWeek: [5, 1, 3] })).toBe(
      'Toda semana na segunda-feira, na quarta-feira e na sexta-feira, às 08:00',
    );
  });

  it('resume dias úteis e a semana inteira', () => {
    expect(describeSchedule({ ...base, scheduleType: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] })).toBe('De segunda a sexta-feira às 08:00');
    expect(describeSchedule({ ...base, scheduleType: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })).toBe('Todos os dias às 08:00');
    expect(describeSchedule({ ...base, scheduleType: 'weekly', daysOfWeek: [6, 2], time: '22:30' })).toBe('Toda semana na terça-feira e no sábado, às 22:30');
  });
});
