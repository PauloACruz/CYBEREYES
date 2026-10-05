import type { ReactNode } from 'react';
import { Group } from '@mantine/core';
import { PageTitle } from './PageTitle';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
      <PageTitle title={title} description={description} />
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}
