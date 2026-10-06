import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend, RemoteEvent } from '../lib/types';
import { RemoteAccess } from './RemoteAccess';

afterEach(cleanup);

function fakeBackend() {
  let listener: ((e: RemoteEvent) => void) | null = null;
  const backend = {
    onRemote: (cb: (e: RemoteEvent) => void) => {
      listener = cb;
      return () => { listener = null; };
    },
    remoteAnswer: vi.fn(() => Promise.resolve()),
    remoteEnd: vi.fn(() => Promise.resolve()),
  };
  const emit = (e: RemoteEvent) => {
    act(() => { listener?.(e); });
  };
  return { backend: backend as unknown as Backend, mocks: backend, emit };
}

describe('RemoteAccess', () => {
  it('pede o aceite com contagem regressiva e envia a resposta', async () => {
    const { backend, mocks, emit } = fakeBackend();
    render(<RemoteAccess backend={backend} now={() => 0} />);
    emit({ event: 'remote-ask', session: 's1', technician: 'Carlos', timeout: 45 });
    expect(screen.getByRole('alertdialog').textContent).toContain('Carlos');
    expect(screen.getByText('Sem resposta, o pedido é recusado em 45 s.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Permitir' }));
    expect(mocks.remoteAnswer).toHaveBeenCalledWith('s1', true);
    await act(() => Promise.resolve());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('mostra o aviso durante a sessao e permite encerrar', () => {
    const { backend, mocks, emit } = fakeBackend();
    render(<RemoteAccess backend={backend} />);
    emit({ event: 'remote-notify', session: 's2', technician: 'Ana' });
    expect(screen.getByRole('status').textContent).toContain('Ana está acessando este computador.');

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar acesso' }));
    expect(mocks.remoteEnd).toHaveBeenCalledWith('s2');

    emit({ event: 'remote-ended', session: 's2' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('recusar fecha o pedido', async () => {
    const { backend, mocks, emit } = fakeBackend();
    render(<RemoteAccess backend={backend} now={() => 0} />);
    emit({ event: 'remote-ask', session: 's3' });
    expect(screen.getByRole('alertdialog').textContent).toContain('Um técnico');
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(mocks.remoteAnswer).toHaveBeenCalledWith('s3', false);
    await act(() => Promise.resolve());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
