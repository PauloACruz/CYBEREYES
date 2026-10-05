import { useId, useState, type ReactNode } from 'react';
import { ActionIcon, Collapse, Group, Stack, Text, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

interface PageTitleProps {
  title: ReactNode;
  /** Texto de apoio; fica oculto ate o clique no icone de informacao. */
  description?: ReactNode;
  /** Selos ao lado do titulo (status, CIDR...). O icone fica depois deles. */
  badges?: ReactNode;
  /** Substitui o h1, como o campo de nome do editor de diagrama. */
  heading?: ReactNode;
}

/** Titulo da pagina com a descricao recolhida atras de um icone "i" a direita. */
export function PageTitle({ title, description, badges, heading }: PageTitleProps) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const label = open ? 'Ocultar descrição' : 'Mostrar descrição';

  return (
    <Stack gap={4}>
      <Group gap="sm" wrap="wrap">
        {heading ?? <Title order={1}>{title}</Title>}
        {badges}
        {description && (
          <ActionIcon
            variant={open ? 'light' : 'subtle'}
            color={open ? 'gold' : 'gray'}
            size={28}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={descriptionId}
            aria-label={label}
            title={label}
          >
            <IconInfoCircle size={18} stroke={1.75} />
          </ActionIcon>
        )}
      </Group>
      {description && (
        <Collapse expanded={open} transitionDuration={150} keepMounted keepMountedMode="display-none">
          <Text id={descriptionId} c="dimmed" size="sm" component="div">
            {description}
          </Text>
        </Collapse>
      )}
    </Stack>
  );
}
