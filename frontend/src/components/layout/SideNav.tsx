import { useState } from 'react';
import { ActionIcon, Box, Collapse, Group, NavLink, Stack, Tooltip, UnstyledButton, VisuallyHidden } from '@mantine/core';
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
  /** Menu recolhido: so os icones, com o nome como dica. */
  collapsed?: boolean;
  /** Abre o menu recolhido (usado pelos grupos sem pagina propria). */
  onExpand?: () => void;
}

interface EntryProps {
  item: VisibleNavItem;
  pathname: string;
  onNavigate: () => void;
  nested?: boolean;
  collapsed?: boolean;
  /** Forca o destaque (grupo recolhido com a tela atual dentro dele). */
  active?: boolean;
}

function counter(item: VisibleNavItem, compact: boolean) {
  if (item.alertCounter) return <NavAlertBadge compact={compact} />;
  if (item.ticketCounter) return <NavTicketBadge compact={compact} />;
  return undefined;
}

function NavEntry({ item, pathname, onNavigate, nested = false, collapsed = false, active }: EntryProps) {
  const icon = <item.icon size={nested ? 18 : 20} stroke={1.75} />;
  const link = (
    <NavLink
      component={RouterNavLink}
      to={item.to}
      label={collapsed ? <VisuallyHidden>{item.label}</VisuallyHidden> : item.label}
      leftSection={
        collapsed ? (
          <Box component="span" pos="relative" display="flex">
            {icon}
            {counter(item, true)}
          </Box>
        ) : (
          icon
        )
      }
      rightSection={collapsed ? undefined : counter(item, false)}
      active={active ?? isNavActive(pathname, item.to)}
      onClick={onNavigate}
      h={nested ? 32 : 36}
      py={0}
      px={collapsed ? 10 : undefined}
      style={ITEM_STYLE}
    />
  );
  return collapsed ? (
    <Tooltip label={item.label} position="right" withArrow>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function NavGroup({ item, pathname, onNavigate, collapsed = false, onExpand }: EntryProps & { onExpand?: () => void }) {
  const childActive = item.children.some((child) => isNavActive(pathname, child.to));
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (childActive || isNavActive(pathname, item.to));
  const groupId = `grupo-${item.to.replace(/\W+/g, '') || 'raiz'}`;
  const toggle = () => setUserOpen(!open);
  const headerColor = childActive && !open ? 'var(--ce-accent-text)' : undefined;

  if (collapsed) {
    const highlighted = childActive || isNavActive(pathname, item.to);
    if (item.allowed) {
      return <NavEntry item={item} pathname={pathname} onNavigate={onNavigate} collapsed active={highlighted} />;
    }
    return (
      <Tooltip label={item.label} position="right" withArrow>
        <UnstyledButton
          onClick={() => {
            setUserOpen(true);
            onExpand?.();
          }}
          aria-label={`Expandir ${item.label}`}
        >
          <NavLink
            component="span"
            label={<VisuallyHidden>{item.label}</VisuallyHidden>}
            leftSection={<item.icon size={20} stroke={1.75} />}
            active={highlighted}
            h={36}
            py={0}
            px={10}
            style={ITEM_STYLE}
          />
        </UnstyledButton>
      </Tooltip>
    );
  }

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
export function SideNav({ items, pathname, onNavigate, collapsed = false, onExpand }: SideNavProps) {
  return (
    <Stack gap={2}>
      {items.map((item) =>
        item.children.length > 0 ? (
          <NavGroup key={item.to} item={item} pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} onExpand={onExpand} />
        ) : (
          <NavEntry key={item.to} item={item} pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />
        ),
      )}
    </Stack>
  );
}
