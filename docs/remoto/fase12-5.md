# Fase 12.5: transferencia de arquivos facilitada

Referencias: RFC-001 (secao 4.7), ADR-022, `docs/remoto/contrato-remoto.md` (secoes 2 e 7).

## O que foi entregue

### EYES

- Pacote `internal/remote/files`, no servico (SYSTEM ou root): `home` (Area de Trabalho, pasta pessoal e Downloads do usuario da sessao; no Windows pelo token do usuario, que segue pastas redirecionadas; no Linux pelo `user-dirs.dirs`), `list` (pastas primeiro, ate 5000 itens, ocultos marcados), `stat`, `mkdir`, `rename` (sem sobrescrever), `delete` (recursivo nao segue links), `upload-begin` e `upload-end`, `download-begin` e `clipboard-files`.
- Caminhos validados pelas regras da secao 7.3 do contrato (`..`, nulo, prefixos `\\.\` e `\\?\`, nomes reservados e `:` fora da unidade no Windows).
- Envio: grava em `<destino>.partial` na posicao esperada, devolve credito por bloco (4 MiB no inicio), confere tamanho e SHA-256 do disco com o da API e so entao troca o `.partial` pelo destino; com hash diferente apaga o `.partial`. No Linux o arquivo e a pasta criados passam para o usuario da sessao.
- Download: blocos de 256 KiB so com credito, a partir de `offset` (Range), pasta ou varios itens como zip gerado durante o envio, SHA-256 do que foi enviado na resposta final.
- Windows: arquivos copiados no Explorer geram `FILES_COPIED` (CF_HDROP lido pelo remote-helper) e arquivos colados no visualizador vao para a area de transferencia da sessao (CF_HDROP gravado pelo remote-helper, pelo canal de controle do servico).

### API

- Canal `files` com transferencias: credito, blocos e cancelamento nos dois sentidos.
- Rotas da secao 2.1: `files/home`, `files/list`, `files/mkdir`, `files/rename`, `files/delete`, `files/clipboard`, `uploads`, `uploads/{id}` (PUT com `Content-Range`, 416 com `received` fora de ordem), `uploads/{id}/complete` e `download` (Range, zip, `Content-Disposition` com o nome em UTF-8). Todas na replica dona (encaminhamento como nas outras rotas da sessao), com a permissao `agents.files` e a politica `filesUpload` e `filesDownload` e o limite `maxFileMb`.
- `remote_transfers` registra cada envio e download (caminho, tamanho, SHA-256, situacao) e a auditoria registra envio, download, pasta criada, renomeacao e exclusao.
- Sessao so de arquivos fica ativa quando o canal do agente conecta.

### Console

- Visualizador: com `agents.files`, a sessao inclui o canal de arquivos. Arrastar e soltar na tela envia para a Area de Trabalho do usuario (D-05); botao "Arquivos" abre o painel; "Arquivos copiados na maquina remota" com o link "Baixar"; arquivos colados (Ctrl+V com arquivos, estacao Windows) vao para Downloads e ficam prontos para colar na estacao.
- Painel de arquivos: atalhos (Area de Trabalho, Downloads, pasta pessoal), navegacao por pastas, mostrar ocultos, nova pasta, renomear, apagar com confirmacao, baixar (pasta como zip), enviar por botao ou arrastando para a lista, fila de transferencias com progresso.
- Aba "Arquivos" no agente (online e com `agents.files`): abre uma sessao so de arquivos enquanto a aba esta aberta.
- Envio em blocos de 1 MiB com retomada: queda de rede, 502, 503 ou 504 tentam de novo (ate 5 vezes, espera crescente) e continuam do `received`.

## Testes

| Teste | O que confere |
|---|---|
| Go `files` | regras de caminho nos dois formatos; envio com retomada, hash conferido, `.partial` removido; download com credito e com posicao; zip de pasta; politica, limite, hash errado, `..`; lista com pastas primeiro e ocultos; renomear sem sobrescrever; apagar recursivo; `clipboard-files` sem suporte |
| Go `remote` | FILES_COPIED uma vez por lista e arquivos para a area de transferencia |
| `RemoteFilesE2ETests` | EYES real: pasta criada, 2,5 MB enviados em blocos com "queda" e retomada, 416 fora de ordem, SHA-256 conferido, arquivo igual no disco, 409 `FILE_EXISTS`, lista, download inteiro e com Range (206), pasta como zip, 404, 422 com `..`, apagar recursivo |
| vitest | envio em blocos com `Content-Range`, retomada depois de queda, erro definitivo sem nova tentativa; painel (lista, ocultos, link de download, nova pasta, apagar, navegar); arquivos copiados viram "Baixar"; navegacao de caminhos Windows e Unix |

## O que ficou pendente desta fase

- Windows real: CF_HDROP (copiar e colar arquivos), pastas redirecionadas e arquivos no limite de D-05 entram no roteiro do piloto (secao 5).
- Retomada entre sessoes diferentes (por exemplo depois de recarregar a pagina) comeca do zero, como descrito no contrato.
- Arquivos colados vao para Downloads, nao para uma pasta temporaria (mudanca registrada no contrato, secao 7.6).
