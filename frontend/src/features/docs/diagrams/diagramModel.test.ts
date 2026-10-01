import { describe, expect, it } from 'vitest';
import { parseDiagramData, serializeDiagram, type DeviceNode, type DiagramEdge } from './diagramModel';

describe('serialização do diagrama', () => {
  it('grava nós, arestas rotuladas e viewport sem estado de tela e lê de volta', () => {
    const nodes: DeviceNode[] = [
      {
        id: 'n1',
        type: 'device',
        position: { x: 10, y: 20 },
        data: { kind: 'router', label: 'Roteador da operadora' },
        selected: true,
        dragging: false,
        measured: { width: 150, height: 50 },
      },
      { id: 'n2', type: 'device', position: { x: 200, y: 20 }, data: { kind: 'workstation', label: 'PC-RECEPCAO', assetId: 7 } },
    ];
    const edges: DiagramEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'right', targetHandle: 'left', label: 'porta 24, VLAN 10', selected: true, animated: true },
    ];

    const data = serializeDiagram(nodes, edges, { x: -5, y: 8, zoom: 1.25 });

    expect(data).toEqual({
      nodes: [
        { id: 'n1', type: 'device', position: { x: 10, y: 20 }, data: { kind: 'router', label: 'Roteador da operadora' } },
        { id: 'n2', type: 'device', position: { x: 200, y: 20 }, data: { kind: 'workstation', label: 'PC-RECEPCAO', assetId: 7 } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'right', targetHandle: 'left', label: 'porta 24, VLAN 10' }],
      viewport: { x: -5, y: 8, zoom: 1.25 },
    });
    expect(parseDiagramData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('descarta elementos inválidos ao ler o JSON do servidor', () => {
    const parsed = parseDiagramData({
      nodes: [{ id: 'a', position: { x: 1, y: 2 }, data: { kind: 'desconhecido', label: 'X', assetId: 'abc' } }, { position: {} }],
      edges: [{ id: 'e', source: 'a', target: 'sumiu' }],
    });
    expect(parsed).toEqual({
      nodes: [{ id: 'a', type: 'device', position: { x: 1, y: 2 }, data: { kind: 'other', label: 'X' } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  });

  it('liga por baixo e por cima as conexões gravadas sem ponto de conexão', () => {
    const parsed = parseDiagramData({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'router', label: 'R' } },
        { id: 'b', position: { x: 0, y: 200 }, data: { kind: 'server', label: 'S' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', label: 'VLAN 20' }],
    });
    expect(parsed.edges).toEqual([{ id: 'e', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: 'VLAN 20' }]);
  });
});
