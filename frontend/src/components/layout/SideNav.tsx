import { useState } from 'react';
import { ActionIcon, Box, Collapse, Group, NavLink, Stack, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { NavLink as RouterNavLink } from 'react-router';
import { isNavActive, type VisibleNavItem } from '../../app/navigation';
import { NavAlertBadge } from './NavAlertBadge';
import { NavTicketBadge } from './NavTicketBadge';

const ITEM_STYLE = { borderRadius: 'var(--mantine-radius-sm)' } as const;

interface SideNavProps {
  items: VisibleNavItem[];
  pathname: string;
  onNavigate: () => void;
}

function NavEntry({ item, pathname, onNavigate, nested = false }: { item: VisibleNavItem; pathname: string; onNavigate: () => void; nested?: boolean }) {
  return (
    <NavLink
      component={RouterNavLink}
      to={item.to}
      label={item.label}
      leftSection={<item.icon size={nested ? 18 : 20} stroke={1.75} />}
      rightSection={item.alertCounter ? <NavAlertBadge /> : item.ticketCounter ? <NavTicketBadge /> : undefined}
      active={isNavActive(pathname, item.to)}
      onClick={onNavigate}
      h={nested ? 32 : 36}
      py={0}
      style={ITEM_STYLE}
    />
  );
}

function NavGroup({ item, pathname, onNavigate }: { item: VisibleNavItem; pathname: string; onNavigate: () => void }) {
  const childActive = item.children.some((child) => isNavActive(pathname, child.to));
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (childActive || isNavActive(pathname, item.to));
  const groupId = `grupo-${item.to.replace(/\W+/g, '') || 'raiz'}`;
  const toggle = () => setUserOpen(!open);
  const headerColor = childActive && !open ? 'var(--ce-accent-text)' : undefined;

  return (
    <Box>
      <Group gap={0} wrap="nowrap" style={{ color: headerColor }}>
        {item.allowed ? (
          <Box style={{ flex: 1, minWidth: 0 }}>
            <NavEntry item={item} pathname={pathname} onNavigate={onNavigate} />
          </Box>
        ) : (
          <UnstyledButton onClick={toggle} style={{ flex: 1, minWidth: 0 }} aria-controls={groupId} aria-expanded={open}>
            <NavLink component="span" label={item.label} leftSection={<item.icon size={20} stroke={1.75} />} h={36} py={0} style={ITEM_STYLE} />
          </UnstyledButton>
        )}
        <ActionIcon
          variant="subtle"
          color="gray"
          size={28}
          onClick={toggle}
          aria-expanded={open}
          aria-controls={groupId}
          aria-label={`${open ? 'Recolher' : 'Expandir'} ${item.label}`}
        >
          <IconChevronDown size={16} stroke={1.75} style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 200ms ease-out' }} />
        </ActionIcon>
      </Group>
      <Collapse expanded={open} transitionDuration={200} keepMounted keepMountedMode="display-none">
        <Stack
          id={groupId}
          role="group"
          aria-label={item.label}
          gap={2}
          ml={21}
          pl={8}
          mt={2}
          style={{ borderLeft: '1px solid var(--ce-border-subtle)' }}
        >
          {item.children.map((child) => (
            <NavEntry key={child.to} item={child} pathname={pathname} onNavigate={onNavigate} nested />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

/** Menu lateral do console: itens simples e grupos recolhiveis (Clientes, Configuracoes). */
export function SideNav({ items, pathname, onNavigate }: SideNavProps) {
  return (
    <Stack gap={2}>
      {items.map((item) =>
        item.children.length > 0 ? (
          <NavGroup key={item.to} item={item} pathname={pathname} onNavigate={onNavigate} />
        ) : (
          <NavEntry key={item.to} item={item} pathname={pathname} onNavigate={onNavigate} />
        ),
      )}
    </Stack>
  );
}
