import {
  IconAccessPoint,
  IconBox,
  IconCloud,
  IconDeviceDesktop,
  IconPrinter,
  IconRouter,
  IconServer,
  IconTopologyStar3,
  IconWall,
  type Icon,
} from '@tabler/icons-react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import type { AssetType } from '../../../api/types';

export type DiagramNodeKind = 'router' | 'switch' | 'firewall' | 'server' | 'workstation' | 'printer' | 'access_point' | 'cloud' | 'other';

export const DIAGRAM_NODE_KINDS: readonly DiagramNodeKind[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'workstation',
  'printer',
  'access_point',
  'cloud',
  'other',
];

export const NODE_KIND_INFO: Record<DiagramNodeKind, { label: string; icon: Icon; color: string }> = {
  router: { label: 'Roteador', icon: IconRouter, color: 'blue' },
  switch: { label: 'Switch', icon: IconTopologyStar3, color: 'cyan' },
  firewall: { label: 'Firewall', icon: IconWall, color: 'red' },
  server: { label: 'Servidor', icon: IconServer, color: 'violet' },
  workstation: { label: 'Estação', icon: IconDeviceDesktop, color: 'teal' },
  printer: { label: 'Impressora', icon: IconPrinter, color: 'orange' },
  access_point: { label: 'Access point', icon: IconAccessPoint, color: 'grape' },
  cloud: { label: 'Nuvem/Internet', icon: IconCloud, color: 'indigo' },
  other: { label: 'Outro', icon: IconBox, color: 'gray' },
};

export type DeviceNodeData = {
  kind: DiagramNodeKind;
  label: string;
  /** Ativo do inventario representado pelo no (abre a ficha com duplo clique). */
  assetId?: number;
};

export type DeviceNode = Node<DeviceNodeData, 'device'>;
export type DiagramEdge = Edge;

export interface SavedNode {
  id: string;
  type: 'device';
  position: { x: number; y: number };
  data: DeviceNodeData;
}

export interface SavedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export interface DiagramData {
  nodes: SavedNode[];
  edges: SavedEdge[];
  viewport: Viewport;
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
export const EMPTY_DIAGRAM: DiagramData = { nodes: [], edges: [], viewport: DEFAULT_VIEWPORT };

/** Limite do contrato para o JSON do diagrama. */
export const MAX_DIAGRAM_BYTES = 2 * 1024 * 1024;

export function isNodeKind(value: unknown): value is DiagramNodeKind {
  return typeof value === 'string' && (DIAGRAM_NODE_KINDS as readonly string[]).includes(value);
}

const ASSET_KIND: Partial<Record<AssetType, DiagramNodeKind>> = {
  workstation: 'workstation',
  laptop: 'workstation',
  server: 'server',
  printer: 'printer',
  switch: 'switch',
  router: 'router',
  firewall: 'firewall',
  access_point: 'access_point',
};

export function kindForAssetType(type: AssetType): DiagramNodeKind {
  return ASSET_KIND[type] ?? 'other';
}

function edgeLabel(label: Edge['label']): string | undefined {
  if (typeof label === 'string') return label.trim() ? label : undefined;
  if (typeof label === 'number') return String(label);
  return undefined;
}

/** Converte o estado do React Flow no JSON gravado (sem selecao, medidas e outros campos de tela). */
export function serializeDiagram(nodes: DeviceNode[], edges: DiagramEdge[], viewport: Viewport): DiagramData {
  return {
    nodes: nodes.map((node) => {
      const data: DeviceNodeData = { kind: node.data.kind, label: node.data.label };
      if (node.data.assetId !== undefined) data.assetId = node.data.assetId;
      return { id: node.id, type: 'device', position: { x: node.position.x, y: node.position.y }, data };
    }),
    edges: edges.map((edge) => {
      const saved: SavedEdge = { id: edge.id, source: edge.source, target: edge.target };
      if (edge.sourceHandle) saved.sourceHandle = edge.sourceHandle;
      if (edge.targetHandle) saved.targetHandle = edge.targetHandle;
      const label = edgeLabel(edge.label);
      if (label !== undefined) saved.label = label;
      return saved;
    }),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Le o JSON salvo pelo servidor, descartando nos e arestas invalidos. */
export function parseDiagramData(raw: unknown): DiagramData {
  const value: unknown = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!isRecord(value)) return EMPTY_DIAGRAM;

  const nodes: SavedNode[] = [];
  for (const item of Array.isArray(value.nodes) ? (value.nodes as unknown[]) : []) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const position = isRecord(item.position) ? item.position : {};
    const data = isRecord(item.data) ? item.data : {};
    const node: SavedNode = {
      id: item.id,
      type: 'device',
      position: { x: finite(position.x, 0), y: finite(position.y, 0) },
      data: { kind: isNodeKind(data.kind) ? data.kind : 'other', label: typeof data.label === 'string' ? data.label : '' },
    };
    if (typeof data.assetId === 'number' && Number.isInteger(data.assetId) && data.assetId > 0) node.data.assetId = data.assetId;
    nodes.push(node);
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: SavedEdge[] = [];
  for (const item of Array.isArray(value.edges) ? (value.edges as unknown[]) : []) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.source !== 'string' || typeof item.target !== 'string') continue;
    if (!ids.has(item.source) || !ids.has(item.target)) continue;
    const edge: SavedEdge = { id: item.id, source: item.source, target: item.target };
    const sourceHandle = optionalString(item.sourceHandle);
    const targetHandle = optionalString(item.targetHandle);
    const label = optionalString(item.label);
    // Conexoes gravadas sem ponto (por exemplo, pela API) saem por baixo e entram por cima.
    edge.sourceHandle = sourceHandle ?? 'bottom';
    edge.targetHandle = targetHandle ?? 'top';
    if (label) edge.label = label;
    edges.push(edge);
  }

  const vp = isRecord(value.viewport) ? value.viewport : {};
  const zoom = finite(vp.zoom, 1);
  return { nodes, edges, viewport: { x: finite(vp.x, 0), y: finite(vp.y, 0), zoom: zoom > 0 ? zoom : 1 } };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Identificador novo para nos e arestas criados no navegador. */
export function newElementId(prefix: 'n' | 'e'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
