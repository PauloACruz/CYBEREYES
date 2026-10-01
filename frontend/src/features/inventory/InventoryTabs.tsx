import { Tabs } from '@mantine/core';
import { IconBox, IconUsers } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { PATHS } from '../../app/paths';

export function InventoryTabs({ active }: { active: 'ativos' | 'pessoas' }) {
  const navigate = useNavigate();
  return (
    <Tabs
      value={active}
      onChange={(value) => {
        if (value === 'ativos' && active !== 'ativos') void navigate(PATHS.inventory);
        if (value === 'pessoas' && active !== 'pessoas') void navigate(PATHS.people);
      }}
      mb="md"
    >
      <Tabs.List>
        <Tabs.Tab value="ativos" leftSection={<IconBox size={16} />}>
          Ativos
        </Tabs.Tab>
        <Tabs.Tab value="pessoas" leftSection={<IconUsers size={16} />}>
          Pessoas
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
