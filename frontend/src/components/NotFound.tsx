import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { PATHS } from '../app/paths';

export function NotFound() {
  return (
    <Center py={80}>
      <Stack align="center" gap="sm" ta="center">
        <Title order={3}>Página não encontrada</Title>
        <Text c="dimmed">O endereço acessado não existe.</Text>
        <Button component={Link} to={PATHS.dashboard} variant="light">
          Ir para o painel
        </Button>
      </Stack>
    </Center>
  );
}
