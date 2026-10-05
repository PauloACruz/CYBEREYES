import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { theme } from '../app/theme';
import { PageTitle } from './PageTitle';

function renderTitle(description?: string) {
  return render(
    <MantineProvider theme={theme}>
      <PageTitle title="Alertas" description={description} />
    </MantineProvider>,
  );
}

describe('PageTitle', () => {
  it('mostra a descrição só depois do clique no ícone de informação', async () => {
    renderTitle('Alertas gerados por checks.');
    const button = screen.getByRole('button', { name: 'Mostrar descrição' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Alertas gerados por checks.')).not.toBeVisible();

    await userEvent.click(button);

    expect(screen.getByRole('button', { name: 'Ocultar descrição' })).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByText('Alertas gerados por checks.')).toBeVisible());
  });

  it('não mostra o ícone quando não há descrição', () => {
    renderTitle();
    expect(screen.getByRole('heading', { name: 'Alertas', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
