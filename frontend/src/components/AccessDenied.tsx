import { Button, Center, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { Link } from 'react-router';
import { PATHS } from '../app/paths';

export function AccessDenied() {
  return (
    <Center py={80}>
      <Stack align="center" gap="sm" maw={420} ta="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="gray">
          <IconLock size={28} />
        </ThemeIcon>
        <Title order={3}>Acesso negado</Title>
        <Text c="dimmed">Você não tem permissão para acessar esta página. Fale com um administrador se precisar de acesso.</Text>
        <Button component={Link} to={PATHS.dashboard} variant="light">
          Voltar ao painel
        </Button>
      </Stack>
    </Center>
  );
}
