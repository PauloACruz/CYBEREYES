import { useEffect, useState } from 'react';
import { Alert, Badge, Box, Button, Center, Code, Group, List, Loader, Modal, Paper, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCopy, IconKeyboard, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERIPHERAL_TEST_MIN_VERSION, peripheralTestsApi } from '../../../api/peripheralTests';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, PeripheralDevice, PeripheralKeyboardState, PeripheralSection, PeripheralTest } from '../../../api/types';
import { LoadError } from '../../../components/TableStates';
import { notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';
import { useConsoleHubConnection } from '../../../realtime/consoleHubContext';
import { versionAtLeast } from '../../snmp/snmpFormat';
import { defaultLabel, KEYBOARD_ROWS, systemLabel } from './keyboardMap';
import { buildSummary, isOpen, SECTION_KINDS, SECTION_LABEL, SECTIONS, VERDICT_COLOR } from './peripheralFormat';

interface PeripheralTestModalProps {
  agent: Pick<AgentDetail, 'id' | 'hostname' | 'version'>;
  opened: boolean;
  /** Abrir e encerrar exige agents.control; acompanhar, agents.view. */
  canStart: boolean;
  onClose: () => void;
}

// Sem resposta do app nesse tempo, o tecnico ve as causas provaveis.
const NO_ANSWER_MS = 15_000;

export function PeripheralTestModal({ agent, opened, canStart, onClose }: PeripheralTestModalProps) {
  const fullScreen = useMediaQuery('(max-width: 48em)');
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconKeyboard size={20} />
          <Text fw={600}>Teste de periféricos · {agent.hostname}</Text>
        </Group>
      }
      size={1100}
      fullScreen={fullScreen}
      centered
    >
      {opened && <PeripheralTestPanel agent={agent} canStart={canStart} />}
    </Modal>
  );
}

/** Entra no grupo da maquina no hub e aplica cada estado que o app manda. */
function usePeripheralRealtime(agentId: number) {
  const queryClient = useQueryClient();
  const { connection, connected } = useConsoleHubConnection();

  useEffect(() => {
    if (!connection) return;
    const onChanged = (test: PeripheralTest) => {
      if (test.agentId !== agentId) return;
      queryClient.setQueryData<PeripheralTest | null>(queryKeys.agentPeripheralTest(agentId), (prev) =>
        prev && prev.id === test.id && prev.updatedAt > test.updatedAt ? prev : test,
      );
    };
    connection.on('peripheralTestChanged', onChanged);
    return () => connection.off('peripheralTestChanged', onChanged);
  }, [connection, agentId, queryClient]);

  useEffect(() => {
    if (!connection || !connected) return;
    connection.invoke('JoinPeripheralTests', agentId).catch(() => undefined);
    return () => {
      connection.invoke('LeavePeripheralTests', agentId).catch(() => undefined);
    };
  }, [connection, connected, agentId]);
}

/** Relogio de 1 s enquanto o app nao responde, para trocar a espera pelo aviso. */
function useWaiting(test: PeripheralTest | null | undefined): boolean {
  const [now, setNow] = useState(() => Date.now());
  const pending = test?.status === 'pending';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  return pending && now - new Date(test.updatedAt).getTime() > NO_ANSWER_MS;
}

function PeripheralTestPanel({ agent, canStart }: Pick<PeripheralTestModalProps, 'agent' | 'canStart'>) {
  const queryClient = useQueryClient();
  usePeripheralRealtime(agent.id);
  const [choice, setChoice] = useState<PeripheralSection>('keyboard');
  const current = useQuery({
    queryKey: queryKeys.agentPeripheralTest(agent.id),
    queryFn: () => peripheralTestsApi.current(agent.id),
    // Seguranca caso um evento do hub se perca.
    refetchInterval: (q) => (isOpen(q.state.data) ? 3000 : false),
  });
  const test = current.data;
  const open = isOpen(test);
  const section = open && test ? test.section : choice;
  const noAnswer = useWaiting(test);

  const apply = (t: PeripheralTest) => queryClient.setQueryData(queryKeys.agentPeripheralTest(agent.id), t);
  const start = useMutation({ mutationFn: (s: PeripheralSection) => peripheralTestsApi.start(agent.id, s), onSuccess: apply });
  const end = useMutation({ mutationFn: (id: number) => peripheralTestsApi.end(agent.id, id), onSuccess: apply });

  const state = test?.state ?? null;
  const devices = (state?.devices ?? []).filter((d) => SECTION_KINDS[section].includes(d.kind));
  const supported = versionAtLeast(agent.version, PERIPHERAL_TEST_MIN_VERSION);

  return (
    <Stack gap="md">
      {!supported && (
        <Alert color="yellow" variant="light" title={`Disponível a partir do EYES ${PERIPHERAL_TEST_MIN_VERSION}`}>
          Esta máquina está com o EYES {agent.version || 'desconhecido'}. O app de bandeja com a tela de teste chega junto com a atualização do agente
          (Ações › Atualizar EYES); o último teste feito continua abaixo.
        </Alert>
      )}
      {canStart && supported && (
        <Paper withBorder p="sm">
          <Group align="flex-end" gap="md" wrap="wrap">
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Teste
              </Text>
              <SegmentedControl
                value={section}
                onChange={(s) => {
                  setChoice(s);
                  // Com o teste aberto, a tela do usuario troca junto.
                  if (open) start.mutate(s);
                }}
                data={SECTIONS.map((s) => ({ value: s, label: SECTION_LABEL[s] }))}
              />
            </Stack>
            {open && test ? (
              <Button color="red" variant="light" leftSection={<IconPlayerStop size={16} />} loading={end.isPending} onClick={() => end.mutate(test.id)}>
                Encerrar teste
              </Button>
            ) : (
              <Button leftSection={<IconPlayerPlay size={16} />} loading={start.isPending} onClick={() => start.mutate(section)}>
                Abrir teste no computador
              </Button>
            )}
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            A janela do EYES abre sozinha no computador do usuário, já no teste escolhido e com o aviso de que você está acompanhando. No teclado, peça para a
            pessoa digitar o texto da tela olhando para as teclas: o modelo do teclado e o layout configurado aparecem aqui.
          </Text>
        </Paper>
      )}

      {current.isError && <LoadError error={current.error} onRetry={() => void current.refetch()} />}
      {current.isPending && (
        <Center py="xl">
          <Loader aria-label="Carregando teste" />
        </Center>
      )}
      {current.isSuccess && !test && (
        <Text c="dimmed" ta="center" py="xl">
          Nenhum teste de periféricos feito nesta máquina ainda.
        </Text>
      )}
      {test && <StatusLine test={test} hostname={agent.hostname} noAnswer={noAnswer} />}

      {state && section === 'keyboard' && state.keyboard && <KeyboardLive keyboard={state.keyboard} />}
      {state && section !== 'keyboard' && <SectionLines lines={state.results[section]} section={section} />}
      {state?.supported && <DeviceList title={`${SECTION_LABEL[section]}: dispositivos conectados`} devices={devices} />}

      {test && state && SECTIONS.some((s) => state.results[s]) && (
        <Group justify="flex-end">
          <Button
            variant="default"
            leftSection={<IconCopy size={16} />}
            onClick={() => {
              void navigator.clipboard.writeText(buildSummary(state, new Date(test.updatedAt))).then(() => notifySuccess('Resumo copiado. Cole no chamado.'));
            }}
          >
            Copiar resumo
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function StatusLine({ test, hostname, noAnswer }: { test: PeripheralTest; hostname: string; noAnswer: boolean }) {
  if (test.status === 'pending') {
    return noAnswer ? (
      <Alert color="yellow" variant="light" title="O app do EYES ainda não respondeu">
        Confira se há alguém logado em {hostname}, se o ícone do EYES aparece na bandeja ao lado do relógio e se o EYES está atualizado. O teste abre sozinho
        assim que o app se conectar.
      </Alert>
    ) : (
      <Group gap="xs">
        <Loader size="sm" />
        <Text size="sm">Abrindo o teste no computador {hostname}...</Text>
      </Group>
    );
  }
  if (test.status === 'active') {
    return (
      <Group gap="xs">
        <Badge color="teal" variant="filled">
          Ao vivo
        </Badge>
        <Text size="sm">
          {test.username ? `Usuário ${test.username}` : 'App conectado'} · aberto por {test.requestedBy}
        </Text>
      </Group>
    );
  }
  return (
    <Group gap="xs">
      <Badge color="gray" variant="light">
        Encerrado
      </Badge>
      <Text size="sm" c="dimmed">
        {test.endedBy ? `por ${test.endedBy}` : ''} {test.endedAt ? `em ${formatDateTime(test.endedAt)}` : ''} · aberto por {test.requestedBy}
      </Text>
    </Group>
  );
}

const MARK_STYLE = {
  s: { background: 'var(--mantine-color-red-light)', outline: '1px solid var(--mantine-color-red-6)' },
  i: { background: 'var(--mantine-color-red-light)', outline: '1px solid var(--mantine-color-red-6)' },
  d: { background: 'var(--mantine-color-yellow-light)', textDecoration: 'line-through', opacity: 0.7 },
} as const;

function KeyboardLive({ keyboard }: { keyboard: PeripheralKeyboardState }) {
  const pressed = new Set(keyboard.pressed);
  const down = new Set(keyboard.down);
  return (
    <Stack gap="sm">
      <Group gap="xl" wrap="wrap" align="flex-start">
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            Layout configurado
          </Text>
          <Text fw={600}>{keyboard.layout?.name || 'não lido'}</Text>
          {keyboard.layout?.id && keyboard.layout.id !== keyboard.layout.name && (
            <Text size="xs" c="dimmed" ff="monospace">
              {keyboard.layout.id}
            </Text>
          )}
          {keyboard.layout?.installed && keyboard.layout.installed.length > 0 && (
            <Text size="xs" c="dimmed">
              Também instalado: {keyboard.layout.installed.join(', ')}
            </Text>
          )}
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="dimmed">
            Modelo provável do teclado
          </Text>
          <Text fw={600}>{keyboard.model ?? 'aguardando a digitação'}</Text>
        </Stack>
      </Group>

      <Alert color={VERDICT_COLOR[keyboard.verdict]} variant="light" title={keyboard.verdict === 'mismatch' ? 'As teclas não batem com o layout' : undefined}>
        <Text size="sm">{keyboard.message}</Text>
        {keyboard.differences.length > 0 && keyboard.verdict !== 'pending' && (
          <List size="sm" mt="xs">
            {keyboard.differences.slice(0, 10).map((d) => (
              <List.Item key={d}>{d}</List.Item>
            ))}
          </List>
        )}
      </Alert>

      <Stack gap={4}>
        <Text size="xs" c="dimmed">
          Texto de referência
        </Text>
        <Code block>{keyboard.reference}</Code>
        <Text size="xs" c="dimmed">
          Texto digitado
        </Text>
        <Code block data-testid="typed-text" style={{ whiteSpace: 'pre-wrap', minHeight: 34 }}>
          {keyboard.ops.length === 0
            ? ' '
            : keyboard.ops.map((op, i) =>
                op.t === 'm' ? (
                  <span key={i}>{op.g}</span>
                ) : (
                  <span key={i} style={MARK_STYLE[op.t]} title={op.t === 'd' ? `Faltou ${op.e ?? ''}` : op.t === 's' ? `Esperado ${op.e ?? ''}` : 'A mais'}>
                    {op.t === 'd' ? op.e : op.g}
                  </span>
                ),
              )}
        </Code>
      </Stack>

      <KeyboardMapView layoutKeys={keyboard.layoutKeys} pressed={pressed} down={down} />
      <Text size="xs" c="dimmed">
        {keyboard.tested} de {keyboard.total} teclas testadas. Cada tecla do desenho mostra o que o sistema escreve com ela; as verdes já foram pressionadas e a
        amarela está pressionada agora.
        {keyboard.others.length > 0 ? ` Outras teclas: ${keyboard.others.join(', ')}.` : ''}
      </Text>
    </Stack>
  );
}

function KeyboardMapView({ layoutKeys, pressed, down }: { layoutKeys: Record<string, string>; pressed: Set<string>; down: Set<string> }) {
  return (
    <Box
      role="img"
      aria-label={`Teclado: ${String(pressed.size)} teclas pressionadas`}
      p={8}
      style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, maxWidth: 720 }}
    >
      {KEYBOARD_ROWS.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 3 }}>
          {row.map((k) => {
            const grow = { flexGrow: k.w ?? 1, flexBasis: 0, minWidth: 0 };
            if (k.gap) return <span key={k.code} style={grow} />;
            const fromSystem = k.label ? '' : systemLabel(layoutKeys[k.code]);
            const isDown = down.has(k.code);
            const tested = pressed.has(k.code);
            return (
              <span
                key={k.code}
                data-code={k.code}
                data-tested={tested || undefined}
                aria-hidden="true"
                style={{
                  ...grow,
                  height: 30,
                  display: 'grid',
                  placeItems: 'center',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  fontFamily: 'var(--mantine-font-family-monospace)',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: `1px solid ${isDown ? 'var(--mantine-color-yellow-6)' : tested ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-default-border)'}`,
                  background: isDown ? 'var(--mantine-color-yellow-5)' : tested ? 'var(--mantine-color-teal-light)' : 'var(--mantine-color-default)',
                  color: isDown ? 'var(--mantine-color-black)' : !k.label && !fromSystem ? 'var(--mantine-color-dimmed)' : undefined,
                }}
              >
                {k.label ?? (fromSystem || defaultLabel(k.code))}
              </span>
            );
          })}
        </div>
      ))}
    </Box>
  );
}

function SectionLines({ lines, section }: { lines: string[] | null; section: PeripheralSection }) {
  if (!lines || lines.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {section === 'usb'
          ? 'Peça para conectar um pendrive, mouse ou cabo do celular em cada porta USB, uma de cada vez.'
          : section === 'camera'
            ? 'Peça para a pessoa clicar em "Ligar câmera". A imagem fica só na tela dela; aqui chegam o nome, a resolução e se a imagem está normal.'
            : 'Peça para a pessoa usar o mouse ou o touchpad dentro da área de teste.'}
      </Text>
    );
  }
  return (
    <Paper withBorder p="sm">
      <Title order={6} mb={4}>
        {SECTION_LABEL[section]}
      </Title>
      <List size="sm" spacing={2}>
        {lines.map((l) => (
          <List.Item key={l}>{l}</List.Item>
        ))}
      </List>
    </Paper>
  );
}

function DeviceList({ title, devices }: { title: string; devices: PeripheralDevice[] }) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {title}
      </Text>
      {devices.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nenhum encontrado.
        </Text>
      ) : (
        devices.map((d) => (
          <Group key={d.id} gap="xs" wrap="nowrap">
            <Badge size="xs" color={d.ok ? 'teal' : 'red'} variant="light">
              {d.ok ? 'OK' : 'Problema'}
            </Badge>
            <Text size="sm">
              {d.name}
              <Text span size="xs" c="dimmed">
                {' '}
                {[d.model, d.manufacturer, d.bus].filter(Boolean).join(' · ')}
              </Text>
              {!d.ok && d.problem && (
                <Text span size="xs" c="red">
                  {' '}
                  — {d.problem}
                </Text>
              )}
            </Text>
          </Group>
        ))
      )}
    </Stack>
  );
}
