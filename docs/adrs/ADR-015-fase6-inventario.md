# ADR-015: Decisoes tecnicas da fase 6 (inventario e documentacao de rede)

- **Status**: Aprovado
- **Data**: 2026-10-01

## Decisoes
1. **Um ativo para cada agente, mantido pelo servidor** (a cada 10 minutos e sob demanda ao abrir a ficha): nome, cliente, site, tipo e dados de fabrica (fabricante, modelo, serie) vem do agente; patrimonio, status, localizacao, compra, garantia, observacoes e o tipo "notebook" sao do cadastro e nunca sao sobrescritos. Ativo de agente excluido fica como "baixado", preservando historico.
2. **Hardware lido do inventario que o agente ja envia** (`agent-wmi`): no Windows, classes do WMI (sistema, BIOS, CPU, video, discos, rede); no Linux e macOS, as chaves simples do agente. Valores de preenchimento ("unknown", "To be filled by O.E.M.") sao descartados.
3. **Responsavel com historico imutavel**: uma atribuicao aberta por ativo (indice unico parcial no banco); trocar fecha a anterior. Sugestao pelo ultimo usuario logado, ignorando o dominio.
4. **Documentacao de rede no PostgreSQL**: redes com CIDR normalizado (IPv4 e IPv6), IPs validados dentro da faixa e unicos por rede; a tela da rede mostra enderecos "descobertos" (IP do ativo e IPs locais informados pelos agentes) ainda nao registrados.
5. **Diagramas guardados como o JSON do React Flow** (`jsonb`, ate 2 MB), com `assetId` nos nos que representam ativos.
6. **Cofre de credenciais com AES-256-GCM e chave fora do banco** (`VAULT_KEY`, variavel de ambiente). Um dump do banco sozinho nao revela as senhas. Sem a chave, as rotas do cofre respondem 503. O segredo so sai na rota de revelar, com permissao propria (`credentials.reveal`) e registro de auditoria.
7. **Paginas em Markdown** renderizadas sem HTML bruto no console.

## Validacao
- Testes de integracao: ativo de agente com hardware do WMI, sugestao e historico de responsaveis, campos manuais preservados; rede com CIDR normalizado, IP fora da faixa e repetido recusados, descoberta de IP do agente; credencial cifrada no banco, ausente da listagem, revelada com auditoria.
- Ambiente real: o agente Go em Linux gerou o ativo com CPU, RAM, discos, IPs e sistema; a rede 192.0.2.0/24 descobriu o IP do agente; o cofre cifrou e revelou com a chave do compose.

## Limites conhecidos
- Perder a `VAULT_KEY` torna as senhas do cofre irrecuperaveis (registrado no runbook de backup). Rotacao de chave nao implementada.
- O agente Linux nao envia numero de serie; entra na evolucao do agente (fase 7).
- Equipamentos sem agente (impressoras, switches) sao cadastrados a mao ate a coleta SNMP (fase 8).
