import { Badge, Card, Group, SimpleGrid, Text, ThemeIcon, Title } from '@mantine/core';
import { IconClipboardList, IconDeviceDesktop, IconTicket, type Icon } from '@tabler/icons-react';
import { useMe } from '../../auth/useMe';

interface ComingSoonCard {
  title: string;
  description: string;
  icon: Icon;
}

const CARDS: readonly ComingSoonCard[] = [
  { title: 'Agentes', description: 'Monitoramento e gestão remota das estações.', icon: IconDeviceDesktop },
  { title: 'Chamados', description: 'Abertura, atribuição e acompanhamento de chamados e incidentes.', icon: IconTicket },
  { title: 'Inventário', description: 'Ativos, hardware, software e usuários responsáveis.', icon: IconClipboardList },
];

export function DashboardPage() {
  const { data: me } = useMe();
  const firstName = (me?.fullName || me?.username || '').split(' ')[0] ?? '';

  return (
    <>
      <Title order={2}>Olá, {firstName}!</Title>
      <Text c="dimmed" mt={4} mb="xl">
        Bem-vindo ao WinCare. Os módulos abaixo chegam nas próximas fases.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {CARDS.map((card) => (
          <Card key={card.title} withBorder padding="lg" component="section" aria-label={card.title}>
            <Group justify="space-between" mb="sm">
              <ThemeIcon size={40} radius="md" variant="light">
                <card.icon size={22} />
              </ThemeIcon>
              <Badge variant="light" color="gray">
                Em breve
              </Badge>
            </Group>
            <Text fw={600}>{card.title}</Text>
            <Text size="sm" c="dimmed" mt={4}>
              {card.description}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
    </>
  );
}
