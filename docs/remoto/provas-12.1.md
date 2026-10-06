# Fase 12.1: provas tecnicas (RFC-001, secao 7.1)

Ambiente de medicao: container Linux com 4 vCPU (Intel Xeon 2,8 GHz), Go 1.26.4, Nginx 1.28.3 (pacote oficial nginx.org), Xvfb e Chromium 1194 (Playwright). Os numeros sao desta maquina; maquinas dos usuarios podem ser mais lentas ou mais rapidas.

| Prova | Resultado | Decisao |
|---|---|---|
| S1 Windows | Nao executavel aqui (sem Windows). As chamadas necessarias (`CreateProcessAsUser` com token de SYSTEM na sessao do usuario, `OpenInputDesktop`/`SetThreadDesktop`, `BitBlt`, `SendInput`, `AddClipboardFormatListener`, `SendSAS`) sao Win32 comuns, chamaveis de Go puro por `golang.org/x/sys/windows`; o MeshAgent usa as mesmas em C | **Segue**, com o codigo compilado para Windows no CI (`go vet` e `build.sh`) e validacao em maquina real no roteiro `docs/remoto/roteiro-piloto.md` |
| S2 Codificacao | Tela 1080p inteira: 68 ms e 560 KiB por quadro (qualidade 50). Digitacao: 9,4 ms e 1,6 KiB por quadro. Tela parada: 0,18 ms (so comparacao). Reducao para 50%: 25 ms | **Segue**. Uso de escritorio cabe na meta de 10 quadros por segundo; troca de tela inteira depende da adaptacao de qualidade, escala e quadros |
| S3 Relay | Com servidores fixos, `hash $sessao consistent` manteve as 4 rotas de cada sessao na mesma replica (300 sessoes, 0 divergencias). Com `server api:8080 resolve`, como na producao, o Nginx 1.28.3 **ignorou o hash** e alternou as replicas a cada requisicao (300 de 300 divergentes) | **Muda o desenho**: sem `hash` no Nginx. Usamos a alternativa prevista na RFC: a replica que recebe a ponta encaminha para a replica dona da sessao pela rede interna, com o endereco da dona registrado no Redis (secao 4.3 da RFC e 4.1 do contrato) |
| S4 Navegadores | Chromium: `writeText` funciona sem gesto com a aba em foco, mesmo sem permissao concedida; `readText` fica aguardando a permissao ate o usuario permitir e depois funciona; Ctrl+V entrega o texto pelo evento `paste` sem pedir permissao. Firefox e Safari nao existem neste ambiente | **Segue** com o desenho da secao 6 do contrato. Firefox e Safari entram no roteiro do piloto |
| S5 Linux | X11 por `jezek/xgb` (BSD) em Go puro: captura 1920x1080 em 34 ms (`GetImage`); RandR, XTEST e XFixes disponiveis na biblioteca. Wayland: nao avaliado em execucao (sem compositor Wayland aqui) | **Segue** com X11. **D-06**: Wayland fica fora da v1; a sessao Wayland responde `REMOTE_UNSUPPORTED` |
| S6 macOS | Nao executavel aqui (sem macOS). `ebitengine/purego` (Apache 2.0) permite chamar CoreGraphics sem CGO | **Segue** com captura por CoreGraphics via `purego`, compilada no CI; validacao em maquina real no roteiro do piloto, junto com as permissoes de Gravacao de Tela e Acessibilidade |

## Detalhes

### S2: comandos e saida
`go test -run x -bench . -benchtime 3s ./internal/remote/encode/` em `agent/`:

```
BenchmarkFullFrame1080p-4      55   68122639 ns/op   560.1 KiB/quadro
BenchmarkTypingUpdate1080p-4  387    9435431 ns/op     1.624 KiB/quadro
BenchmarkIdleCompare1080p-4 19950     175415 ns/op
BenchmarkScaleHalf1080p-4     141   25212241 ns/op
```

A imagem do teste imita uma tela de escritorio (fundo claro e linhas de texto). O tempo de digitacao inclui a copia de um quadro inteiro feita pelo proprio benchmark.

### S3: configuracao testada
Duas replicas atras do mesmo nome (`api.test` com dois registros A no dnsmasq), upstream com `zone`, `hash $remote_sid consistent` e `server api.test:8080 resolve`. O `$remote_sid` vinha de um `map` sobre `$uri`. Com dois `server` de IP fixo e o mesmo `hash`, a afinidade funcionou; com `resolve`, nao.

### S5: comando
`DISPLAY=:99 go test -v -run TestX11 ./internal/remote/capture/` com `Xvfb :99 -screen 0 1920x1080x24`: `captura 1920x1080 em 35.8ms`; benchmark: 33,98 ms por captura.
