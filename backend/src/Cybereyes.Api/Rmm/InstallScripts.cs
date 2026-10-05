using System.Globalization;
using System.Text;

namespace Cybereyes.Api.Rmm;

public sealed record InstallParameters(string ApiUrl, int ClientId, int SiteId, string Token, string AgentType);

/// <summary>
/// Scripts de instalacao do EYES para Linux, macOS e Windows. O proprio EYES registra o agente e cria o
/// servico do sistema; os scripts so escolhem a arquitetura, baixam o binario e chamam "eyes install".
/// </summary>
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

    /// <summary>Comando de uma linha para macOS. Sem goarch, detecta a arquitetura pelo uname.</summary>
    public static string MacCommand(InstallParameters p, string? goarch = null)
    {
        var arch = goarch ?? "$(uname -m | sed 's/x86_64/amd64/')";
        return string.Create(CultureInfo.InvariantCulture,
            $"curl -fsSL -o /tmp/eyes \"{p.ApiUrl}/api/agent/download/darwin/{arch}\" && chmod +x /tmp/eyes && sudo /tmp/eyes install --api {p.ApiUrl} --client-id {p.ClientId} --site-id {p.SiteId} --agent-type {Concrete(p.AgentType)} --auth {p.Token} && rm -f /tmp/eyes");
    }

    /// <summary>Script PowerShell para Windows. Sem goarch, detecta amd64, arm64 ou 386.</summary>
    public static string Windows(InstallParameters p, string? goarch = null)
    {
        var arch = goarch is null
            ? "$arch = if ($env:PROCESSOR_ARCHITEW6432 -eq 'ARM64' -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }"
            : $"$arch = '{goarch}'";
        return string.Create(CultureInfo.InvariantCulture, $$"""
            $ErrorActionPreference = 'Stop'
            $ProgressPreference = 'SilentlyContinue'
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            {{arch}}
            $eyes = Join-Path $env:TEMP ('eyes-setup-' + [guid]::NewGuid().ToString('N') + '.exe')
            Invoke-WebRequest -UseBasicParsing -Uri ('{{p.ApiUrl}}/api/agent/download/windows/' + $arch) -OutFile $eyes
            try {
                & $eyes install --api {{p.ApiUrl}} --client-id {{p.ClientId}} --site-id {{p.SiteId}} --agent-type {{Concrete(p.AgentType)}} --auth {{p.Token}}
                if ($LASTEXITCODE -ne 0) { throw "Falha na instalacao do EYES (codigo $LASTEXITCODE)" }
            } finally {
                Remove-Item $eyes -Force -ErrorAction SilentlyContinue
            }
            """).ReplaceLineEndings("\r\n");
    }

    private static string Concrete(string agentType) => agentType == AutoType ? Core.Rmm.MonitoringType.Workstation : agentType;

    private const string LinuxTemplate = """
        #!/usr/bin/env bash
        # Instalador do EYES (agente Cybereyes) para Linux.
        # Uso: curl -fsSL <servidor>/api/install/linux.sh | sudo bash -s -- --client-id N --site-id N --auth TOKEN [--agent-type auto|server|workstation] [--insecure]
        set -euo pipefail

        API_URL="__API_URL__"
        __DEFAULTS__
        INSECURE=0

        fail() { echo "ERRO: $*" >&2; exit 1; }

        while [ "$#" -gt 0 ]; do
            case "$1" in
                --api) API_URL="$2"; shift 2 ;;
                --client-id) CLIENT_ID="$2"; shift 2 ;;
                --site-id) SITE_ID="$2"; shift 2 ;;
                --auth) TOKEN="$2"; shift 2 ;;
                --agent-type) AGENT_TYPE="$2"; shift 2 ;;
                --insecure) INSECURE=1; shift ;;
                --nomesh) shift ;; # aceito por compatibilidade com comandos antigos; sem efeito
                *) fail "parametro desconhecido: $1" ;;
            esac
        done

        [ "$(id -u)" -eq 0 ] || fail "execute como root (sudo)"
        [ -n "$CLIENT_ID" ] && [ -n "$SITE_ID" ] && [ -n "$TOKEN" ] || fail "informe --client-id, --site-id e --auth"
        command -v curl >/dev/null 2>&1 || fail "curl e necessario"

        case "$(uname -m)" in
            x86_64 | amd64) ARCH="amd64" ;;
            aarch64 | arm64) ARCH="arm64" ;;
            armv6l | armv7l | armhf) ARCH="arm" ;;
            i386 | i686) ARCH="386" ;;
            *) fail "arquitetura nao suportada: $(uname -m)" ;;
        esac

        # Ambiente grafico: gerenciador de login ativo ou sessoes graficas instaladas.
        has_gui() {
            if command -v systemctl >/dev/null 2>&1; then
                systemctl is-enabled display-manager.service >/dev/null 2>&1 && return 0
                for dm in gdm gdm3 lightdm sddm lxdm xdm slim greetd; do
                    systemctl is-enabled "${dm}.service" >/dev/null 2>&1 && return 0
                done
            fi
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
        FLAGS=()
        if [ "$INSECURE" -eq 1 ]; then CURL_OPTS="-fsSLk"; FLAGS+=(--insecure); fi

        TMP="$(mktemp -d)"
        trap 'rm -rf "$TMP"' EXIT
        echo "Baixando o EYES (${ARCH})..."
        curl ${CURL_OPTS} -o "${TMP}/eyes" "${API_URL}/api/agent/download/linux/${ARCH}" || fail "falha no download do EYES"
        chmod 0755 "${TMP}/eyes"

        "${TMP}/eyes" install --api "${API_URL}" --client-id "${CLIENT_ID}" --site-id "${SITE_ID}" \
            --agent-type "${AGENT_TYPE}" --auth "${TOKEN}" ${FLAGS[@]+"${FLAGS[@]}"}
        """;
}
