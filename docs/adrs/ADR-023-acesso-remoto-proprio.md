# ADR-023: Acesso remoto proprio no lugar do MeshCentral

- **Status**: Aprovado
- **Data**: 2026-10-05
- **Substitui**: ADR-013 e a parte do ADR-004 que mantem o MeshCentral (o requisito de acesso remoto pelo navegador continua)
- **Detalhes**: `docs/rfcs/RFC-001-acesso-remoto-proprio.md`

## Contexto
- O acesso remoto depende do MeshCentral (servidor Node.js) e do MeshAgent (agente em C), com dois agentes por estacao, segundo dominio, segunda base de usuarios sincronizada e a interface do MeshCentral aberta em outra aba (RFC-001, secao 1.2).
- A area de transferencia automatica do MeshCentral e opcional, so de texto, e soltar um arquivo sobre a tela nao transfere o arquivo.
- MeshCentral e MeshAgent sao Apache 2.0: podem servir de referencia e ter trechos adaptados, com os avisos de copyright.

## Decisoes
1. **Modulo proprio (D-01)**: o acesso remoto e escrito neste repositorio, dividido entre o EYES (captura, entrada, area de transferencia e arquivos), a API (sessoes, relay WebSocket, politicas e auditoria) e o console (visualizador). Sem fork do MeshCentral ou do MeshAgent.
2. **Visualizador no navegador (D-03)**: dentro do console, sem instalar nada no computador do tecnico. Um app nativo fica como fase futura opcional.
3. **Area de transferencia automatica e transferencia de arquivos facilitada** sao requisitos da v1 (RFC-001, secoes 4.6 e 4.7).
4. **Sem aviso por padrao (D-04)**: "avisar" e "perguntar" ao usuario podem ser ligados em Configuracoes, por cliente ou site.
5. **Sem assinatura de codigo no inicio (D-07)**: o piloto mede alertas de antivirus e EDR.
6. **Servidor limpo (D-08)**: o servidor deixa de oferecer o MeshAgent ja; o MeshCentral sai do repositorio e da VPS antes da migracao das 400 estacoes, sem periodo de convivencia em producao.

## Consequencias
- Um agente por estacao, um dominio, um login e a auditoria toda no Cybereyes.
- Ate o fim da fase 12.8, estacoes novas ficam sem tela remota (o terminal do EYES continua), e a migracao das 400 estacoes espera.
- Linux com Wayland e macOS dependem das provas S5 e S6; sem o MeshCentral, nao ha alternativa para essas maquinas ate la.
- Binarios sem assinatura podem gerar alertas de antivirus e EDR na captura de tela e na injecao de entrada.
- Pendentes: ordem dos sistemas (D-02), destino e limite dos arquivos (D-05), Wayland (D-06), gravacao de sessao (D-09) e a parte de LGPD do D-04.
