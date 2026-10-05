# Fase 12.0: especificacao e decisoes (RFC-001)

## Entregue
- Contrato de fio v1: `docs/remoto/contrato-remoto.md`.
- Decisoes D-01, D-03, D-04, D-07 e D-08: ADR-022.
- Etapa 0: o servidor deixou de oferecer o MeshAgent (`Mesh:DistributeAgent`, padrao `false`).

## Pendente (precisa do responsavel pelo produto)

### D-02: distribuicao de sistemas das 400 estacoes
As estacoes ainda estao no servidor do Tactical, fora do alcance deste repositorio. Preencher a partir dele:

| Sistema | Quantidade | Observacao |
|---|---|---|
| Windows 10 | | |
| Windows 11 | | |
| Windows Server | | |
| Linux (X11) | | |
| Linux (Wayland) | | sessao grafica atual de cada maquina |
| macOS | | |

A ordem proposta (Windows, Linux X11, macOS) so muda se essa tabela mostrar outra prioridade.

### D-04 (parte LGPD): texto do aviso e retencao
Texto proposto para o modo "avisar" (o tecnico aparece pelo nome):

> `<nome do tecnico>` (suporte de TI) esta acessando este computador para atendimento. Clique em Encerrar para finalizar o acesso.

Texto proposto para o modo "perguntar":

> `<nome do tecnico>` (suporte de TI) pede acesso a este computador. Permitir?

Retencao da auditoria das sessoes e transferencias: a definir com o juridico (proposta para discussao: 12 meses, alinhada a retencao do restante da auditoria, se houver).

### D-05: arquivos
Padrao provisorio no contrato: destino na Area de Trabalho do usuario conectado e limite de 2048 MB por arquivo, ajustavel por politica.

### D-06 e D-09
- Wayland: decide depois da prova S5.
- Gravacao de sessao: recomendacao de deixar fora da v1.

## Proxima fase
12.1: provas tecnicas S1 a S6 (RFC-001, secao 7.1).
