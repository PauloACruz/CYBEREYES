import type { ReactNode } from 'react';
import { ActionIcon, Box, Group, Stack, Text, Title } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { Link } from 'react-router';
import { MOBILE_CARD, MOBILE_FLOATING } from './mobileStyles';
import { MobileTabBar } from './MobileTabBar';

interface MobileHeaderProps {
  title: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  /** Titulo em fonte monoespacada (hostname). */
  mono?: boolean;
}

/** Barra superior fixa: voltar, titulo e acoes (alvos de 44px). */
export function MobileHeader({ title, back, actions, mono = false }: MobileHeaderProps) {
  return (
    <Box
      component="header"
      pos="sticky"
      top={0}
      px={8}
      pt="calc(8px + env(safe-area-inset-top))"
      style={{ zIndex: 20, background: 'linear-gradient(var(--ce-bg-base) 70%, transparent)' }}
    >
      <Group h={56} gap={4} wrap="nowrap" pl={back ? 4 : 16} pr={4} style={MOBILE_FLOATING}>
        {back && (
          <ActionIcon component={Link} to={back.to} variant="subtle" color="gray" size={44} aria-label={`Voltar para ${back.label}`}>
            <IconChevronLeft size={24} />
          </ActionIcon>
        )}
        <Title
          order={1}
          fz={mono ? 16 : 18}
          ff={mono ? 'monospace' : undefined}
          fw={mono ? 500 : 600}
          lh="24px"
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {title}
        </Title>
        {actions}
      </Group>
    </Box>
  );
}

/** Barra fixa no rodape (resposta do chamado, executar tarefas). */
export function MobileBottomBar({ children }: { children: ReactNode }) {
  return (
    <Box
      pos="sticky"
      bottom={0}
      px={8}
      pb="calc(8px + env(safe-area-inset-bottom))"
      style={{ zIndex: 20, background: 'linear-gradient(transparent, var(--ce-bg-base) 30%)' }}
    >
      <Box p={10} style={MOBILE_FLOATING}>
        {children}
      </Box>
    </Box>
  );
}

interface MobilePageProps {
  header: ReactNode;
  children: ReactNode;
  /** O texto "tabs" (padrao) mostra a navegacao principal; outro conteudo vira uma barra fixa propria. */
  bottom?: ReactNode;
  /** Elemento flutuante (botao de novo chamado), posicionado sobre a barra inferior. */
  floating?: ReactNode;
}

export function MobilePage({ header, children, bottom = 'tabs', floating }: MobilePageProps) {
  return (
    <Box mih="100dvh" display="flex" style={{ flexDirection: 'column' }}>
      {header}
      <Stack component="main" gap="md" p={16} pb={24} style={{ flex: 1, minWidth: 0 }}>
        {children}
      </Stack>
      {floating}
      {bottom === 'tabs' ? <MobileTabBar /> : bottom ? <MobileBottomBar>{bottom}</MobileBottomBar> : null}
    </Box>
  );
}

/** Secao com rotulo em caixa alta, como os campos do console. */
export function MobileSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Stack gap={8} component="section" aria-label={title}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text component="h2" m={0} size="xs" fw={600} tt="uppercase" c="var(--ce-text-secondary)" style={{ letterSpacing: '0.08em' }}>
          {title}
        </Text>
        {action}
      </Group>
      {children}
    </Stack>
  );
}

/** Lista de pares rotulo e valor em cartao, com linhas de 48px. */
export function InfoRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <Box style={MOBILE_CARD} component="dl" m={0}>
      {rows.map((row, index) => (
        <Group
          key={row.label}
          justify="space-between"
          gap="sm"
          wrap="nowrap"
          mih={48}
          px={16}
          py={6}
          style={index > 0 ? { borderTop: '1px solid var(--ce-border-subtle)' } : undefined}
        >
          <Text component="dt" size="sm" c="var(--ce-text-secondary)" style={{ flexShrink: 0 }}>
            {row.label}
          </Text>
          <Text component="dd" m={0} size="sm" ta="right" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {row.value}
          </Text>
        </Group>
      ))}
    </Box>
  );
}
