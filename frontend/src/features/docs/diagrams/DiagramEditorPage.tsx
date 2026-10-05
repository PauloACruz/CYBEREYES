import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
  useComputedColorScheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconDeviceFloppy, IconId, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../../api/client';
import { diagramsApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AssetListItem, type DiagramDetail } from '../../../api/types';
import { assetPath, docsTabPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { NotFound } from '../../../components/NotFound';
import { LoadError } from '../../../components/TableStates';
import { notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';
import { AssetSearchSelect } from '../../inventory/AssetSearchSelect';
import { DeviceNodeView } from './DeviceNodeView';
import {
  DIAGRAM_NODE_KINDS,
  kindForAssetType,
  MAX_DIAGRAM_BYTES,
  newElementId,
  NODE_KIND_INFO,
  parseDiagramData,
  serializeDiagram,
  type DeviceNode,
  type DiagramEdge,
  type DiagramNodeKind,
} from './diagramModel';
import { PageTitle } from '../../../components/PageTitle';

const nodeTypes: NodeTypes = { device: DeviceNodeView };

/** Mudancas que nao alteram o diagrama gravado. */
const PASSIVE_CHANGES: ReadonlySet<string> = new Set(['select', 'dimensions']);

export function DiagramEditorPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const diagram = useQuery({
    queryKey: queryKeys.diagram(id),
    queryFn: () => diagramsApi.get(id),
    enabled: valid,
    // O canvas guarda o estado local; recarregar no foco descartaria alteracoes.
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!valid || (diagram.error instanceof ApiError && diagram.error.status === 404)) return <NotFound />;
  if (diagram.isError) return <LoadError error={diagram.error} onRetry={() => void diagram.refetch()} />;
  if (!diagram.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando diagrama" />
      </Center>
    );
  }
  return (
    <ReactFlowProvider>
      <DiagramEditor key={diagram.data.id} diagram={diagram.data} />
    </ReactFlowProvider>
  );
}

function DiagramEditor({ diagram }: { diagram: DiagramDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.docsManage);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const colorScheme = useComputedColorScheme('light');
  const flow = useReactFlow<DeviceNode, DiagramEdge>();
  const canvasRef = useRef<HTMLDivElement>(null);

  const initial = useMemo(() => parseDiagramData(diagram.data), [diagram.data]);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<DeviceNode>(initial.nodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<DiagramEdge>(initial.edges);
  const [name, setName] = useState(diagram.name);
  const [dirty, setDirty] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const selectedNode = nodes.find((n) => n.selected);
  const selectedEdge = selectedNode ? undefined : edges.find((e) => e.selected);

  const onNodesChange = useCallback(
    (changes: NodeChange<DeviceNode>[]) => {
      onNodesChangeBase(changes);
      if (changes.some((c) => (c.type === 'position' ? c.dragging === true : !PASSIVE_CHANGES.has(c.type)))) setDirty(true);
    },
    [onNodesChangeBase],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<DiagramEdge>[]) => {
      onEdgesChangeBase(changes);
      if (changes.some((c) => c.type !== 'select')) setDirty(true);
    },
    [onEdgesChangeBase],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge({ ...connection, id: newElementId('e') }, current));
      setDirty(true);
    },
    [setEdges],
  );

  // Aviso ao fechar a aba ou recarregar com alteracoes pendentes.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  const centerPosition = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    const jitter = (nodes.length % 5) * 24;
    return flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 70 + jitter, y: rect.top + rect.height / 2 - 25 + jitter });
  };

  const addNode = (kind: DiagramNodeKind, label: string, assetId?: number) => {
    const node: DeviceNode = {
      id: newElementId('n'),
      type: 'device',
      position: centerPosition(),
      data: assetId === undefined ? { kind, label } : { kind, label, assetId },
      selected: true,
    };
    setNodes((current) => [...current.map((n) => (n.selected ? { ...n, selected: false } : n)), node]);
    setEdges((current) => current.map((e) => (e.selected ? { ...e, selected: false } : e)));
    setDirty(true);
  };

  const renameNode = (id: string, label: string) => {
    setNodes((current) => current.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)));
    setDirty(true);
  };
  const relabelEdge = (id: string, label: string) => {
    setEdges((current) => current.map((e) => (e.id === id ? { ...e, label } : e)));
    setDirty(true);
  };
  const deleteSelected = () => {
    void flow.deleteElements({ nodes: nodes.filter((n) => n.selected), edges: edges.filter((e) => e.selected) });
  };

  const save = useMutation({
    mutationFn: () => {
      const data = serializeDiagram(nodes, edges, flow.getViewport());
      if (new Blob([JSON.stringify(data)]).size > MAX_DIAGRAM_BYTES) {
        throw new Error('O diagrama passou do limite de 2 MB.');
      }
      return diagramsApi.update(diagram.id, {
        clientId: diagram.clientId,
        siteId: diagram.siteId ?? undefined,
        name: name.trim() || diagram.name,
        data,
      });
    },
    onSuccess: (saved) => {
      notifySuccess('Diagrama salvo.');
      setDirty(false);
      queryClient.setQueryData(queryKeys.diagram(diagram.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.diagramLists });
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) notifications.show({ color: 'red', title: 'Não foi possível salvar', message: error.message });
    },
  });

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={docsTabPath('redes')} size="sm">
          Documentação
        </Anchor>
        <Anchor component={Link} to={docsTabPath('diagramas')} size="sm">
          Diagramas
        </Anchor>
        <Text size="sm">{diagram.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap" gap="sm">
        <PageTitle
          title={diagram.name}
          heading={
            canManage ? (
              <TextInput
              aria-label="Nome do diagrama"
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
                setDirty(true);
              }}
              maxLength={200}
              size="md"
              fw={600}
              w={360}
              error={name.trim() ? undefined : 'Informe o nome'}
            />
            ) : undefined
          }
          description={
            <>
              {diagram.clientName} · atualizado em {formatDateTime(diagram.updatedAt)} por {diagram.updatedBy}
            </>
          }
        />
        {canManage ? (
          <Group gap="sm">
            {dirty && (
              <Badge color="yellow" variant="light">
                Alterações não salvas
              </Badge>
            )}
            <Menu position="bottom-end" width={220} shadow="md">
              <Menu.Target>
                <Button variant="default" leftSection={<IconPlus size={16} />} rightSection={<IconChevronDown size={16} />}>
                  Adicionar nó
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {DIAGRAM_NODE_KINDS.map((kind) => {
                  const info = NODE_KIND_INFO[kind];
                  return (
                    <Menu.Item key={kind} leftSection={<info.icon size={16} />} onClick={() => addNode(kind, info.label)}>
                      {info.label}
                    </Menu.Item>
                  );
                })}
              </Menu.Dropdown>
            </Menu>
            <Button variant="default" leftSection={<IconId size={16} />} onClick={() => setAssetPickerOpen(true)}>
              Adicionar ativo
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              loading={save.isPending}
              disabled={!dirty || !name.trim()}
              onClick={() => save.mutate()}
            >
              Salvar
            </Button>
          </Group>
        ) : (
          <Badge variant="light" color="gray">
            Somente leitura
          </Badge>
        )}
      </Group>

      <Paper withBorder ref={canvasRef} h="calc(100dvh - 240px)" mih={480} pos="relative" style={{ overflow: 'hidden' }}>
        <ReactFlow<DeviceNode, DiagramEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, node) => {
            if (node.data.assetId !== undefined) void navigate(assetPath(node.data.assetId));
          }}
          defaultViewport={initial.viewport}
          fitView={initial.nodes.length > 0 && initial.viewport.zoom === 1 && initial.viewport.x === 0 && initial.viewport.y === 0}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={canManage}
          nodesConnectable={canManage}
          edgesReconnectable={false}
          deleteKeyCode={canManage ? ['Backspace', 'Delete'] : null}
          defaultEdgeOptions={{ labelBgPadding: [6, 3], labelBgBorderRadius: 4 }}
          colorMode={colorScheme}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={20} />
          <MiniMap pannable zoomable ariaLabel="Minimapa do diagrama" />
          <Controls showInteractive={false} />
        </ReactFlow>

        {canManage && (selectedNode ?? selectedEdge) && (
          <Paper withBorder shadow="md" p="sm" pos="absolute" top={12} right={12} w={260} style={{ zIndex: 5 }}>
            <Group justify="space-between" mb="xs" wrap="nowrap">
              <Text size="sm" fw={600}>
                {selectedNode ? NODE_KIND_INFO[selectedNode.data.kind].label : 'Conexão'}
              </Text>
              <Group gap={4} wrap="nowrap">
                <Tooltip label="Excluir">
                  <ActionIcon variant="subtle" color="red" aria-label="Excluir selecionado" onClick={deleteSelected}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Fechar">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Fechar painel"
                    onClick={() => {
                      setNodes((current) => current.map((n) => ({ ...n, selected: false })));
                      setEdges((current) => current.map((e) => ({ ...e, selected: false })));
                    }}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            {selectedNode && (
              <Stack gap="xs">
                <TextInput label="Nome" value={selectedNode.data.label} maxLength={200} onChange={(e) => renameNode(selectedNode.id, e.currentTarget.value)} />
                {selectedNode.data.assetId !== undefined && (
                  <Anchor component={Link} to={assetPath(selectedNode.data.assetId)} size="sm">
                    Abrir ficha do ativo
                  </Anchor>
                )}
              </Stack>
            )}
            {selectedEdge && (
              <TextInput
                label="Rótulo"
                description="Porta, VLAN ou velocidade do enlace"
                placeholder="Ex.: porta 24, VLAN 10"
                value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
                maxLength={100}
                onChange={(e) => relabelEdge(selectedEdge.id, e.currentTarget.value)}
              />
            )}
          </Paper>
        )}
      </Paper>
      <Text size="xs" c="dimmed" mt="xs">
        {canManage
          ? 'Arraste entre os pontos dos nós para conectar. Selecione um nó ou conexão para renomear; Delete exclui. Duplo clique em um ativo abre a ficha.'
          : 'Duplo clique em um nó vinculado a um ativo abre a ficha.'}
      </Text>

      <Modal opened={assetPickerOpen} onClose={() => setAssetPickerOpen(false)} title="Adicionar ativo ao diagrama" centered>
        {assetPickerOpen && (
          <AssetPicker
            clientId={diagram.clientId}
            onPick={(asset) => {
              addNode(kindForAssetType(asset.type), asset.name, asset.id);
              setAssetPickerOpen(false);
            }}
          />
        )}
      </Modal>

      <Modal opened={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Alterações não salvas" centered>
        <Text size="sm">O diagrama tem alterações que ainda não foram salvas. Deseja sair mesmo assim?</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => blocker.reset?.()}>
            Continuar editando
          </Button>
          <Button color="red" onClick={() => blocker.proceed?.()}>
            Sair sem salvar
          </Button>
        </Group>
      </Modal>
    </>
  );
}

function AssetPicker({ clientId, onPick }: { clientId: number; onPick: (asset: AssetListItem) => void }) {
  return (
    <AssetSearchSelect
      label="Ativo"
      description="Ativos do cliente deste diagrama"
      clientId={clientId}
      value={null}
      onChange={(_, asset) => {
        if (asset) onPick(asset);
      }}
    />
  );
}
