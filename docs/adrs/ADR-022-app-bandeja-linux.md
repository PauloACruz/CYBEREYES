# ADR-022: App de bandeja no Linux distribuido e iniciado pelo EYES

- Status: aceito
- Data: 2026-10-05

## Contexto
- Requisito: ao instalar o agente numa estacao, o usuario precisa ter na bandeja o app para falar com o tecnico, abrir chamado vinculado a maquina e acompanhar o andamento dos chamados abertos.
- Ate o EYES 3.0.1 isso so acontecia no Windows (ADR-020): o servico baixa o `eyes-tray.exe` da API e o inicia em cada sessao. No Linux o canal local ja funcionava, mas o app nao era compilado nem distribuido: o Wails precisa de CGO, GTK 3 e WebKitGTK, e a imagem da API so compilava binarios sem CGO. Por isso o runbook de migracao deixava o app de bandeja para uma onda posterior.
- No macOS o problema e o mesmo, com um agravante: compilar o Wails (Cocoa) exige o SDK da Apple, que nao existe na imagem Linux da API.

## Decisao
1. **Compilacao na imagem da API**: estagio `tray-linux` no `backend/Dockerfile`, em `golang:1.26-bookworm` com `libgtk-3-dev` e `libwebkit2gtk-4.1-dev`, pelo script `agent/tray/build-linux.sh` (CGO, tag `gtk3`).
   - Gera `eyes-tray-v<versao>-linux-<arch>` na arquitetura de quem compila, sem emulacao (no CI, `amd64`), entao o build nunca depende de QEMU.
   - Debian 12 (glibc 2.36): o binario exige no maximo `GLIBC_2.34`.
2. **Distribuicao pela rota que ja existia**: `/api/agent/download/linux/<arch>?component=tray`, sem mudanca no backend. Sem binario para a arquitetura (por exemplo `arm64`), a rota responde 404 e o agente so registra no log.
3. **Supervisor no servico do EYES**, como no Windows (ADR-008: o agente supervisiona o app):
   - so roda como servico e em maquinas com ambiente grafico (gerenciador de login configurado, sessoes X11/Wayland instaladas ou uma sessao grafica aberta); sem ambiente grafico, confere de novo a cada 6 horas;
   - baixa o app para `/opt/cybereyes/eyes-tray` quando falta ou a versao do EYES muda (`eyes-tray.version`), troca o arquivo de forma atomica e encerra as instancias da versao antiga, esperando ate 5 s que saiam;
   - confere as bibliotecas com `eyes-tray --version`, que sai antes de abrir a interface. Se o carregador recusar o binario ("error while loading shared libraries"):
     - em **estacoes** (`agent_type` workstation), instala a WebKitGTK 4.1, que traz o GTK 3: `apt-get install libwebkit2gtk-4.1-0` (com `apt-get update` se a primeira tentativa falhar), `dnf install webkit2gtk4.1`, `zypper install libwebkit2gtk-4_1-0` ou `pacman -S webkit2gtk-4.1`;
     - em **servidores**, so avisa no log (pacote grafico nao e instalado sem pedido do administrador);
   - cria o atalho "EYES" no menu de aplicativos (`/usr/share/applications/eyes-tray.desktop`, icone em `/opt/cybereyes/eyes-tray.png`). Com o app ja na bandeja, abrir pelo menu so mostra a janela;
   - a cada 15 s lista as sessoes graficas ativas pelo logind (`loginctl`: tipo x11, wayland ou mir, classe user, ativa) e inicia o app com `--hidden` nas sessoes cujo usuario ainda nao o tem aberto. Sem logind, usa os processos de usuarios comuns com `DISPLAY` ou `WAYLAND_DISPLAY`;
   - o ambiente do app (tela, barramento D-Bus, area de trabalho e idioma) vem de um processo grafico da propria sessao (`/proc/<pid>/environ`), por uma lista fixa de variaveis;
   - o app e iniciado como o usuario por `systemd-run --user`: fica em `user@<uid>.service`, fora do cgroup do servico do EYES, e termina com o logout. Sem o systemd do usuario, o processo e iniciado direto, em sessao propria;
   - sessao aberta depois do servico: espera 20 s para a area de trabalho subir. No maximo 5 inicios por hora por usuario (como no Windows, o app volta se for fechado).
4. **App**: flag `--version` (versao injetada no build) e segunda instancia com `--hidden` nao abre a janela; so o atalho do menu (sem `--hidden`) mostra a janela.
5. **Desinstalacao** (`eyes uninstall`): encerra o app nas sessoes e apaga o atalho; binario e icone saem com a pasta de instalacao.
6. **Acompanhamento no app** (todas as plataformas):
   - linha do andamento no chamado: aberto, em atendimento (com o tecnico ou "Aguardando um tecnico") e resolvido ou encerrado;
   - destaque quando o andamento depende do usuario ("Aguardando sua resposta") e dica no campo de mensagem;
   - lista separada em "Em andamento" e "Encerrados";
   - status com texto para o usuario ("Aguardando voce" no lugar de "Aguardando usuario");
   - chamado fechado explica que foi encerrado, em vez de dizer que o chat sera liberado quando um tecnico assumir;
   - a ultima mensagem nao fica mais escondida atras do campo de mensagem ao rolar ate o fim.
7. **EYES 3.0.3**, para os agentes ja instalados receberem o supervisor pela atualizacao automatica.

## Validacao
- Testes unitarios do agente: sessoes do logind, ambiente e processos do app com `/proc` falso, atalho, limite de inicios e espera de saida. Testes da interface (vitest) para a linha do andamento, a lista e o chat bloqueado.
- `eyes-tray --version` em conteineres Ubuntu 22.04 e 24.04, Debian 12, Fedora, openSUSE Leap 15.6 e Arch, depois de instalar o pacote de cada um.
- Ponta a ponta em conteineres Ubuntu 24.04 (systemd 255) e 22.04 (systemd 249) com systemd e logind, contra a API real (imagem construida com o Dockerfile novo) e PostgreSQL:
  - comando de instalacao do Linux gerado pelo servidor, servico systemd e cadastro como estacao;
  - sessao x11 da usuaria `maria` registrada no logind pelo PAM, sem WebKitGTK instalada;
  - o agente baixou o app, instalou a WebKitGTK pelo apt (cerca de 30 s), criou o atalho e iniciou o app por `systemd-run --user`;
  - token pelo canal local, conexao em tempo real, chamado aberto pela interface (com captura de tela) vinculado a maquina e a usuaria;
  - retorno do tecnico (atribuicao, mensagem, aguardando usuario, resolvido e fechado) mostrado em tempo real, nota interna oculta, resposta da usuaria reabrindo o atendimento;
  - app reiniciado pelo supervisor depois de encerrado, troca de versao do app e desinstalacao.

## Consequencias
- A imagem da API cresce cerca de 12 MB (binario amd64) e o build ganha o estagio `tray-linux`.
- Estacoes Linux recebem um pacote do sistema (WebKitGTK 4.1) instalado pelo agente. O apt espera ate 5 min pelo lock do dpkg; se a instalacao falhar (sem rede ou repositorio fora do ar), o agente tenta de novo na verificacao seguinte, a cada 6 horas.
- Distribuicoes atendidas: as que tem WebKitGTK 4.1 e glibc 2.34 ou mais nova (Ubuntu 22.04+, Debian 12+, Fedora, openSUSE Leap 15.6, Arch). Ubuntu 20.04 e Debian 11 ficam de fora (glibc 2.31).
- Binario do Linux so para a arquitetura de quem constroi a imagem (amd64 no CI).
- Limites que continuam:
  - GNOME sem a extensao AppIndicator (Fedora, Debian com GNOME puro) nao mostra o icone da bandeja; o usuario abre pelo atalho "EYES" do menu;
  - captura de tela em sessao Wayland pura falha (o chamado abre sem a captura, com aviso);
  - notificacoes dependem do servidor de notificacoes da area de trabalho.
- O caminho sem systemd do usuario (processo direto) so tem testes unitarios da descoberta de sessoes; o ponta a ponta usou systemd.
- macOS continua sem distribuicao automatica: precisa de build no macOS, empacotamento em `EYES.app` e assinatura.
- Windows: comportamento mantido (ADR-020). O supervisor do Windows passou a usar o mesmo codigo de download do Linux; nao foi executado em Windows neste trabalho.
