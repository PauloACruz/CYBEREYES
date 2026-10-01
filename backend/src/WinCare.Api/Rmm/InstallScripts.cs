using System.Globalization;
using System.Text;

namespace WinCare.Api.Rmm;

public sealed record InstallParameters(string ApiUrl, int ClientId, int SiteId, string Token, string AgentType);

/// <summary>Scripts de instalacao do agente para Linux, macOS e Windows.</summary>
public static class InstallScripts
{
    public const string AutoType = "auto";

    /// <summary>
    /// Script Linux generico (sem segredos). Parametros por linha de comando. Com --agent-type auto (padrao),
    /// cadastra como estacao (workstation) quando ha ambiente grafico e como servidor quando so ha terminal.
    /// </summary>
    public static string Linux(string apiUrl, InstallParameters? embedded = null)
    {
        var defaults = embedded is null
            ? "CLIENT_ID=\"\"\nSITE_ID=\"\"\nTOKEN=\"\"\nAGENT_TYPE=\"auto\""
            : string.Create(CultureInfo.InvariantCulture,
                $"CLIENT_ID=\"{embedded.ClientId}\"\nSITE_ID=\"{embedded.SiteId}\"\nTOKEN=\"{embedded.Token}\"\nAGENT_TYPE=\"{embedded.AgentType}\"");
        return LinuxTemplate.Replace("__API_URL__", apiUrl, StringComparison.Ordinal)
            .Replace("__DEFAULTS__", defaults, StringComparison.Ordinal)
            .ReplaceLineEndings("\n");
    }

    public static string LinuxCommand(InstallParameters p)
    {
        var sb = new StringBuilder();
        sb.Append(CultureInfo.InvariantCulture, $"curl -fsSL '{p.ApiUrl}/api/install/linux.sh' | sudo bash -s -- ");
        sb.Append(CultureInfo.InvariantCulture, $"--client-id {p.ClientId} --site-id {p.SiteId} --auth {p.Token}");
        if (p.AgentType != AutoType)
        {
            sb.Append(CultureInfo.InvariantCulture, $" --agent-type {p.AgentType}");
        }
        return sb.ToString();
    }

    public static string MacCommand(InstallParameters p, string goarch) => string.Create(CultureInfo.InvariantCulture,
        $"curl -fsSL -o /tmp/wincare-agent '{p.ApiUrl}/api/agent/download/darwin/{goarch}' && chmod +x /tmp/wincare-agent && sudo /tmp/wincare-agent -m install -api {p.ApiUrl} -client-id {p.ClientId} -site-id {p.SiteId} -agent-type {Concrete(p.AgentType)} -auth {p.Token} -nomesh");

    public static string Windows(InstallParameters p, string goarch) => string.Create(CultureInfo.InvariantCulture, $$"""
        $ErrorActionPreference = 'Stop'
        $setup = Join-Path $env:TEMP 'wincare-agent-setup.exe'
        Invoke-WebRequest -UseBasicParsing -Uri '{{p.ApiUrl}}/api/agent/download/windows/{{goarch}}' -OutFile $setup
        Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES' -Wait
        Start-Sleep -Seconds 5
        & (Join-Path $env:ProgramFiles 'TacticalAgent\tacticalrmm.exe') -m install --api {{p.ApiUrl}} --client-id {{p.ClientId}} --site-id {{p.SiteId}} --agent-type {{Concrete(p.AgentType)}} --auth {{p.Token}} -nomesh
        Remove-Item $setup -Force
        """).ReplaceLineEndings("\r\n");

    private static string Concrete(string agentType) => agentType == AutoType ? Core.Rmm.MonitoringType.Workstation : agentType;

    private const string LinuxTemplate = """
        #!/usr/bin/env bash
        # Instalador do agente WinCare para Linux.
        # Uso: curl -fsSL <servidor>/api/install/linux.sh | sudo bash -s -- --client-id N --site-id N --auth TOKEN [--agent-type auto|server|workstation] [--insecure]
        set -euo pipefail

        API_URL="__API_URL__"
        __DEFAULTS__
        INSECURE=0

        AGENT_DIR="/opt/tacticalagent"
        AGENT_BIN="${AGENT_DIR}/tacticalagent"
        SERVICE_NAME="tacticalagent.service"
        SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"

        fail() { echo "ERRO: $*" >&2; exit 1; }

        while [ "$#" -gt 0 ]; do
            case "$1" in
                --api) API_URL="$2"; shift 2 ;;
                --client-id) CLIENT_ID="$2"; shift 2 ;;
                --site-id) SITE_ID="$2"; shift 2 ;;
                --auth) TOKEN="$2"; shift 2 ;;
                --agent-type) AGENT_TYPE="$2"; shift 2 ;;
                --insecure) INSECURE=1; shift ;;
                *) fail "parametro desconhecido: $1" ;;
            esac
        done

        [ "$(id -u)" -eq 0 ] || fail "execute como root (sudo)"
        [ -n "$CLIENT_ID" ] && [ -n "$SITE_ID" ] && [ -n "$TOKEN" ] || fail "informe --client-id, --site-id e --auth"
        command -v systemctl >/dev/null 2>&1 || fail "systemd e necessario"

        case "$(uname -m)" in
            x86_64 | amd64) ARCH="amd64" ;;
            aarch64 | arm64) ARCH="arm64" ;;
            armv6l | armv7l) ARCH="arm" ;;
            i386 | i686) ARCH="386" ;;
            *) fail "arquitetura nao suportada: $(uname -m)" ;;
        esac

        # Ambiente grafico: gerenciador de login ativo ou sessoes graficas instaladas.
        has_gui() {
            systemctl is-enabled display-manager.service >/dev/null 2>&1 && return 0
            for dm in gdm gdm3 lightdm sddm lxdm xdm slim greetd; do
                systemctl is-enabled "${dm}.service" >/dev/null 2>&1 && return 0
            done
            compgen -G "/usr/share/xsessions/*.desktop" >/dev/null && return 0
            compgen -G "/usr/share/wayland-sessions/*.desktop" >/dev/null && return 0
            return 1
        }

        if [ "$AGENT_TYPE" = "auto" ]; then
            if has_gui; then AGENT_TYPE="workstation"; else AGENT_TYPE="server"; fi
            echo "Ambiente detectado: ${AGENT_TYPE}"
        fi
        case "$AGENT_TYPE" in
            server | workstation) ;;
            *) fail "--agent-type deve ser auto, server ou workstation" ;;
        esac

        CURL_OPTS="-fsSL"
        INSTALL_FLAGS=()
        if [ "$INSECURE" -eq 1 ]; then CURL_OPTS="-fsSLk"; INSTALL_FLAGS+=(-insecure); fi

        if systemctl list-unit-files "${SERVICE_NAME}" >/dev/null 2>&1; then
            systemctl stop "${SERVICE_NAME}" >/dev/null 2>&1 || true
        fi

        mkdir -p "${AGENT_DIR}/bin"
        echo "Baixando o agente (${ARCH})..."
        curl ${CURL_OPTS} -o "${AGENT_BIN}.download" "${API_URL}/api/agent/download/linux/${ARCH}" || fail "falha no download do agente"
        mv -f "${AGENT_BIN}.download" "${AGENT_BIN}"
        chmod 0755 "${AGENT_BIN}"

        echo "Registrando o agente..."
        "${AGENT_BIN}" -m install -api "${API_URL}" -client-id "${CLIENT_ID}" -site-id "${SITE_ID}" \
            -agent-type "${AGENT_TYPE}" -auth "${TOKEN}" -nomesh "${INSTALL_FLAGS[@]}"

        cat > "${SERVICE_FILE}" <<UNIT
        [Unit]
        Description=WinCare Agent
        After=network-online.target
        Wants=network-online.target

        [Service]
        Type=simple
        ExecStart=${AGENT_BIN} -m svc
        User=root
        Group=root
        Restart=always
        RestartSec=5s
        KillMode=process

        [Install]
        WantedBy=multi-user.target
        UNIT

        systemctl daemon-reload
        systemctl enable --now "${SERVICE_NAME}"
        echo "Agente instalado como ${AGENT_TYPE}."
        """;
}
