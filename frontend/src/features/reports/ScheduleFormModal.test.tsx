import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportScheduleDto, ReportTypeDto, SaveReportSchedule } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';
import { validateSchedule, initialScheduleValues } from './scheduleForm';

const TYPES: ReportTypeDto[] = [
  { type: 'alerts', label: 'Alertas', description: 'Alertas do período.', usesPeriod: true, filters: ['clientId', 'severity'] },
];

describe('formulário de agendamento de relatório', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('valida nome, destinatários e dia do mês antes de salvar', async () => {
    let saved: SaveReportSchedule | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['reports.view', 'reports.manage'] })),
      'GET /api/reports/types': () => json(TYPES),
      'GET /api/reports/schedules': () => json([]),
      'POST /api/reports/schedules': (init) => {
        saved = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveReportSchedule;
        const created: ReportScheduleDto = { ...saved, id: 7, nextRunAt: '2026-10-05T11:00:00Z', createdBy: 'tecnico' };
        return json(created, 201);
      },
    });
    renderApp('/relatorios?aba=agendamentos');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Novo agendamento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo agendamento' });
    await user.click(within(dialog).getByRole('button', { name: 'Criar agendamento' }));

    expect(await within(dialog).findByText('Informe o nome')).toBeInTheDocument();
    expect(within(dialog).getByText('Informe ao menos um destinatário')).toBeInTheDocument();
    expect(saved).toBeUndefined();

    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Alertas da semana');
    const recipients = within(dialog).getByLabelText(/Destinatários/);
    await user.type(recipients, 'gestor{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Criar agendamento' }));
    expect(await within(dialog).findByText('E-mail inválido: gestor')).toBeInTheDocument();

    await user.type(recipients, '{Backspace}');
    await user.type(recipients, 'gestor@empresa.com.br{Enter}');

    const frequency = within(dialog).getByRole('combobox', { name: 'Frequência' });
    await user.click(frequency);
    const listbox = document.getElementById(frequency.getAttribute('aria-controls') ?? '') as HTMLElement;
    await user.click(await within(listbox).findByRole('option', { name: 'Mensal', hidden: true }));
    const day = within(dialog).getByRole('textbox', { name: 'Dia do mês' });
    await user.clear(day);
    await user.click(within(dialog).getByRole('button', { name: 'Criar agendamento' }));
    expect(await within(dialog).findByText('Escolha um dia entre 1 e 28')).toBeInTheDocument();
    expect(saved).toBeUndefined();

    await user.clear(day);
    await user.type(day, '5');
    await user.click(within(dialog).getByRole('button', { name: 'Criar agendamento' }));

    await waitFor(() =>
      expect(saved).toEqual({
        name: 'Alertas da semana',
        params: { type: 'alerts', period: 'last_7d' },
        format: 'pdf',
        frequency: 'monthly',
        time: '08:00',
        dayOfWeek: null,
        dayOfMonth: 5,
        recipients: ['gestor@empresa.com.br'],
        enabled: true,
      }),
    );
    expect(await screen.findByText('Agendamento criado.')).toBeInTheDocument();
  });

  it('exige período relativo para tipos com período', () => {
    const values = { ...initialScheduleValues(null, 'alerts'), name: 'Semanal', recipients: ['a@b.com'] };
    expect(validateSchedule(values, TYPES[0])).toEqual({});
    expect(validateSchedule({ ...values, filters: { ...values.filters, period: 'custom' } }, TYPES[0])).toEqual({
      'filters.period': 'Escolha um período relativo',
    });
  });
});
