#Requires -Version 5.1

<#
.SYNOPSIS
    Renomeia o computador Windows (estação ou servidor membro, em grupo de trabalho ou domínio) e, se pedido, agenda o reinício.
.DESCRIPTION
    Valida o nome novo (regras do NetBIOS e do DNS), confere o nome atual e o pendente, recusa
    controlador de domínio e Autoridade Certificadora, renomeia com Rename-Computer (no domínio,
    com a credencial recebida por variável de ambiente) e confere o registro. A troca só vale
    depois do reinício: sem -Reiniciar, sai com 3010; com -Reiniciar, agenda o reinício com
    aviso ao usuário e sai com 0, para o RMM receber o resultado antes de a máquina reiniciar.
    Rodar de novo com o mesmo nome não renomeia outra vez.
.PARAMETER NovoNome
    Nome novo: de 1 a 15 caracteres, só letras sem acento, números e hífen; não pode começar
    nem terminar com hífen nem ser só números. Obrigatório (validado no corpo: sem ele, sai com 3).
.PARAMETER Reiniciar
    Agenda o reinício depois de renomear (ou se a troca já estiver pendente), com aviso na tela.
.PARAMETER AtrasoSegundos
    Espera antes do reinício, de 30 a 86400 segundos; padrão 300 (5 minutos). O mínimo de 30 s
    dá tempo de o RMM receber o resultado. Cancelar o reinício: shutdown /a.
.PARAMETER PastaLog
    Pasta do log. Padrão: %ProgramData%\ManutencaoTI\Logs\win-conf-renomear-computador.
    Também lida de MANUTENCAOTI_PASTA_LOG.
.PARAMETER Confirmar
    Confirma a execução real sem pergunta interativa (uso no RMM). Sem ele e sem console, o
    script sai com 3 sem alterar nada.
.PARAMETER ArgumentosExtras
    Não informe. Recolhe parâmetro digitado errado para o script sair com 3 e a linha RESULTADO.
.EXAMPLE
    .\win-conf-renomear-computador.ps1 -NovoNome PC-FIN-012 -WhatIf
    Simula: mostra o nome atual e o que seria feito, sem alterar nada.
.EXAMPLE
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\win-conf-renomear-computador.ps1 -NovoNome PC-FIN-012 -Reiniciar -Confirmar
    Execução real, como no RMM: renomeia e reinicia em 5 minutos. No domínio, defina antes as
    variáveis de ambiente MANUTENCAOTI_DOMINIO_USUARIO (DOMINIO\usuario ou usuario@dominio)
    e MANUTENCAOTI_DOMINIO_SENHA, de uma conta com permissão de renomear o objeto do
    computador no AD.
.NOTES
    Nome        : win-conf-renomear-computador.ps1
    Plataforma  : WIN
    Genero      : CONF
    Severidade  : S3 (Alta)
    Shell       : PS51
    Manutencao  : Corretiva
    Alvo        : Estacao, Servidor
    Privilegio  : Administrador
    Reinicio    : Sim
    Reversivel  : Sim (renomear de volta e reiniciar)
    Idempotente : Sim
    Rollback    : Rodar de novo com -NovoNome <nome anterior, gravado no log> e reiniciar; antes do reinicio, shutdown /a cancela o reinicio agendado
    Requisitos  : Windows 10/11 ou Windows Server 2016+; Windows PowerShell 5.1; no dominio, credencial com permissao no objeto do computador
    Uso         : .\win-conf-renomear-computador.ps1 -NovoNome PC-FIN-012 -Reiniciar -Confirmar
    Codigos     : 0=OK 1=ALERTA 2=FALHA 3=DESCONHECIDO 3010=REINICIO
    Tags        : nome-do-computador, hostname, rename-computer, dominio
    Versao      : 1.0.0
    Data        : 2026-10-09
    Autor       : Equipe de TI
#>

# Parâmetros só escalares e sem Mandatory/Validate*: erro de vinculação sairia com 1 antes do
# corpo (o RMM leria ALERTA). A senha do domínio chega por variável de ambiente, nunca por argumento.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High', PositionalBinding = $false)]
param(
    [string] $NovoNome,

    [switch] $Reiniciar,

    [int] $AtrasoSegundos = 300,

    [string] $PastaLog = $env:MANUTENCAOTI_PASTA_LOG,

    [switch] $Confirmar,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ArgumentosExtras
)

# --- Modo estrito --------------------------------------------------------------------
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- Configuração --------------------------------------------------------------------
$NomeScript = 'win-conf-renomear-computador'   # fixo: o RMM salva o arquivo com outro nome
$VersaoScript = '1.0.0'
$Organizacao = 'ManutencaoTI'
$RetencaoLogDias = 90                          # o log guarda o nome anterior (rollback)
$BuildMinimo = 14393                           # Windows 10 1607 e Windows Server 2016
$VarUsuarioDominio = 'MANUTENCAOTI_DOMINIO_USUARIO'
$VarSenhaDominio = 'MANUTENCAOTI_DOMINIO_SENHA'

# --- Codificação da saída ------------------------------------------------------------
try {
    [Console]::OutputEncoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
} catch {
    Write-Verbose -Message ('Saída sem console; codificação mantida: {0}' -f $_.Exception.Message)
}
$estiloSaida = Get-Variable -Name PSStyle -ValueOnly -ErrorAction SilentlyContinue
if ($null -ne $estiloSaida) { $estiloSaida.OutputRendering = 'PlainText' }

# --- PowerShell de 32 bits num Windows de 64 bits --------------------------------------
if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    $ps64 = Join-Path -Path $env:SystemRoot -ChildPath 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
    if (-not $PSCommandPath -or -not (Test-Path -LiteralPath $ps64)) {
        Write-Output 'RESULTADO: DESCONHECIDO - PowerShell de 32 bits sem acesso ao de 64 bits'
        exit 3
    }
    $argumentos = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    foreach ($par in $PSBoundParameters.GetEnumerator()) {
        if ($par.Value -is [switch]) {
            if ($par.Value.IsPresent) { $argumentos += '-' + $par.Key }
            elseif ($par.Key -eq 'Confirm') { $argumentos += '-Confirmar' }
        } else {
            $argumentos += '-' + $par.Key
            $argumentos += [string]$par.Value
        }
    }
    & $ps64 @argumentos
    exit $LASTEXITCODE
}

# --- Estado (não edite) ----------------------------------------------------------------
$script:Estado = 'OK'
$script:Codigo = 0
$script:Resumo = ''
$script:Concluido = $false
$script:Simulacao = $false
$script:EAdmin = $false
$script:ArquivoLog = $null
$script:Mutex = $null
$script:MutexAdquirido = $false
$script:SemConsoleParaConfirmar = $false
$script:ParametrosInformados = @($PSBoundParameters.Keys) -join ', '
if (-not $script:ParametrosInformados) { $script:ParametrosInformados = '(nenhum)' }
$script:Peso = @{ OK = 0; REINICIO_PENDENTE = 1; ALERTA = 2; DESCONHECIDO = 3; FALHA = 4 }

# --- Saída na tela e log -----------------------------------------------------------------
function Write-Tela {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '', Justification = 'Mensagens ao operador: não podem entrar no pipeline de saída.')]
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Linha)
    Write-Host $Linha
}

function Write-LogArquivo {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $Texto)
    if (-not $script:ArquivoLog) { return }
    $carimbo = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz', [Globalization.CultureInfo]::InvariantCulture)
    try {
        $utf8Bom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $true
        [IO.File]::AppendAllText($script:ArquivoLog, ('{0} {1}{2}' -f $carimbo, $Texto, [Environment]::NewLine), $utf8Bom)
    } catch {
        $script:ArquivoLog = $null
        Write-Tela -Linha ('[ALERTA] Falha ao gravar o log ({0}); seguindo só com a tela.' -f $_.Exception.Message)
    }
}

function Write-Log {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidOverwritingBuiltInCmdlets', '', Justification = 'Não há Write-Log no 5.1; esta só vale dentro do script.')]
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Mensagem,
        [ValidateSet('INFO', 'OK', 'ALERTA', 'ERRO', 'SIMULACAO')] [string] $Nivel = 'INFO',
        [switch] $SoArquivo
    )
    $linha = '[{0}] {1}' -f $Nivel, $Mensagem
    Write-LogArquivo -Texto $linha
    if (-not $SoArquivo) { Write-Tela -Linha $linha }
}

# --- Resultado -----------------------------------------------------------------------------
function Merge-Resultado {
    # O pior estado vence; no empate, fica o primeiro motivo.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('OK', 'ALERTA', 'FALHA', 'DESCONHECIDO', 'REINICIO_PENDENTE')]
        [string] $Estado,
        [string] $Resumo = ''
    )
    if ($script:Peso[$Estado] -lt $script:Peso[$script:Estado]) { return }
    if ($script:Peso[$Estado] -eq $script:Peso[$script:Estado] -and $script:Resumo) { return }
    $script:Estado = $Estado
    $script:Resumo = $Resumo
    $script:Codigo = switch ($Estado) {
        'OK' { 0 }
        'ALERTA' { 1 }
        'DESCONHECIDO' { 3 }
        'REINICIO_PENDENTE' { 3010 }
        default { 2 }
    }
}

function Confirm-Acao {
    # Ponto único de ShouldProcess; na simulação registra [SIMULACAO] e devolve $false.
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSShouldProcess', '', Justification = 'Usa de propósito o ShouldProcess do script: o ConfirmImpact do topo vale para todas as ações.')]
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory = $true)] [string] $Alvo,
        [Parameter(Mandatory = $true)] [string] $Acao
    )
    if ($WhatIfPreference) {
        Write-Log -Nivel SIMULACAO -Mensagem ('{0}: {1}' -f $Acao, $Alvo)
        return $false
    }
    try {
        if ($script:PSCmdlet.ShouldProcess($Alvo, $Acao)) { return $true }
    } catch [System.Management.Automation.PSInvalidOperationException] {
        $script:SemConsoleParaConfirmar = $true
        throw
    }
    Write-Log -Nivel ALERTA -Mensagem ('Não confirmado pelo operador: {0}: {1}' -f $Acao, $Alvo)
    Merge-Resultado -Estado ALERTA -Resumo 'ação não confirmada pelo operador; nada foi alterado'
    return $false
}

# --- Ambiente: privilégio, pastas, trava ------------------------------------------------------
function Test-Administrador {
    [CmdletBinding()]
    [OutputType([bool])]
    param()
    $identidade = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object -TypeName Security.Principal.WindowsPrincipal -ArgumentList $identidade
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Initialize-PastaBase {
    # %ProgramData%\ManutencaoTI só com SYSTEM e Administradores; pasta existente sem essa
    # proteção (ou link/junção) é recusada e o script sai com 3.
    [CmdletBinding()]
    [OutputType([bool])]
    param()
    $base = Join-Path -Path $env:ProgramData -ChildPath $Organizacao
    if (Test-Path -LiteralPath $base) {
        $item = Get-Item -LiteralPath $base -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Merge-Resultado -Estado DESCONHECIDO -Resumo ('{0} não é uma pasta comum (arquivo, link ou junção): confira antes de usar' -f $base)
            return $false
        }
        $acl = Get-Acl -LiteralPath $base
        $dono = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($dono -notin @('S-1-5-18', 'S-1-5-32-544') -or -not $acl.AreAccessRulesProtected) {
            $heranca = if ($acl.AreAccessRulesProtected) { 'desligada' } else { 'ligada' }
            Merge-Resultado -Estado DESCONHECIDO -Resumo ('{0} não está protegida (dono {1}; herança de permissões {2}): confira a pasta e a ACL antes de usar' -f $base, $dono, $heranca)
            return $false
        }
        return $true
    }
    $null = New-Item -ItemType Directory -Path $base -WhatIf:$false -Confirm:$false
    $icacls = Join-Path -Path $env:SystemRoot -ChildPath 'System32\icacls.exe'
    $null = & $icacls $base /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
    $codigoAcl = $LASTEXITCODE
    $null = & $icacls $base /setowner '*S-1-5-32-544'
    $codigoDono = $LASTEXITCODE
    if ($codigoAcl -ne 0 -or $codigoDono -ne 0) {
        try { [IO.Directory]::Delete($base) } catch { Write-Verbose -Message $_.Exception.Message }
        Merge-Resultado -Estado DESCONHECIDO -Resumo ('icacls não conseguiu proteger {0} (códigos {1} e {2}); nada foi gravado nela' -f $base, $codigoAcl, $codigoDono)
        return $false
    }
    return $true
}

function Initialize-Log {
    [CmdletBinding()]
    param()
    $candidatas = @()
    if ($PastaLog) { $candidatas += $PastaLog }
    if ($script:EAdmin) { $candidatas += Join-Path -Path $env:ProgramData -ChildPath ('{0}\Logs\{1}' -f $Organizacao, $NomeScript) }
    if ($env:LOCALAPPDATA) { $candidatas += Join-Path -Path $env:LOCALAPPDATA -ChildPath ('{0}\Logs' -f $Organizacao) }
    $dia = (Get-Date).ToString('yyyyMMdd', [Globalization.CultureInfo]::InvariantCulture)
    foreach ($pasta in $candidatas) {
        try {
            $null = New-Item -ItemType Directory -Path $pasta -Force -WhatIf:$false -Confirm:$false
            $arquivo = Join-Path -Path $pasta -ChildPath ('{0}_{1}.log' -f $NomeScript, $dia)
            [IO.File]::AppendAllText($arquivo, '')
            $script:ArquivoLog = $arquivo
            break
        } catch {
            Write-Verbose -Message ('Pasta de log indisponível: {0} ({1})' -f $pasta, $_.Exception.Message)
        }
    }
    if (-not $script:ArquivoLog) {
        Write-Tela -Linha '[ALERTA] Nenhuma pasta de log gravável; seguindo só com a tela.'
        return
    }
    $limite = (Get-Date).AddDays(-$RetencaoLogDias)
    try {
        Get-ChildItem -LiteralPath (Split-Path -Path $script:ArquivoLog -Parent) -Filter ('{0}_*.log' -f $NomeScript) -File |
            Where-Object { $_.LastWriteTime -lt $limite } |
            Remove-Item -Force -WhatIf:$false -Confirm:$false
    } catch {
        Write-Log -Nivel ALERTA -Mensagem ('Falha ao aplicar a retenção de logs: {0}' -f $_.Exception.Message)
    }
}

function Lock-Execucao {
    [CmdletBinding()]
    [OutputType([bool])]
    param()
    $nome = 'Global\{0}-{1}' -f $Organizacao, $NomeScript
    try {
        $script:Mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList $false, $nome
        $script:MutexAdquirido = $script:Mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $script:MutexAdquirido = $true
    } catch [System.UnauthorizedAccessException] {
        $script:MutexAdquirido = $false
    }
    return $script:MutexAdquirido
}

function Unlock-Execucao {
    [CmdletBinding()]
    param()
    if (-not $script:Mutex) { return }
    if ($script:MutexAdquirido) { $script:Mutex.ReleaseMutex() }
    $script:Mutex.Dispose()
    $script:Mutex = $null
    $script:MutexAdquirido = $false
}

# --- Regras do nome e da máquina -----------------------------------------------------------------
function Test-NomeValido {
    # NetBIOS: até 15 caracteres. DNS: letras, números e hífen, sem hífen nas pontas e não só
    # números. Devolve o motivo da recusa ou $null.
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Nome)
    if ($Nome.Length -lt 1 -or $Nome.Length -gt 15) { return ('tem {0} caracteres (use de 1 a 15)' -f $Nome.Length) }
    if ($Nome -notmatch '^[A-Za-z0-9-]+$') { return 'use só letras sem acento, números e hífen' }
    if ($Nome.StartsWith('-') -or $Nome.EndsWith('-')) { return 'não pode começar nem terminar com hífen' }
    if ($Nome -match '^[0-9]+$') { return 'não pode ser só números' }
    return $null
}

function Get-NomeRegistro {
    # ActiveComputerName = nome em uso; ComputerName = nome que vale depois do reinício.
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory = $true)] [string] $Chave)
    $caminho = 'HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\{0}' -f $Chave
    return [string](Get-ItemProperty -LiteralPath $caminho -Name ComputerName).ComputerName
}

function Get-CredencialDominio {
    # Credencial por variável de ambiente (variável segura do RMM). A senha vira SecureString
    # caractere a caractere: ConvertTo-SecureString -AsPlainText registraria o valor no evento
    # 4103 se o Module Logging estiver ligado. As variáveis saem do ambiente do processo.
    [CmdletBinding()]
    [OutputType([pscredential])]
    param()
    $usuario = [Environment]::GetEnvironmentVariable($VarUsuarioDominio, 'Process')
    $senha = [Environment]::GetEnvironmentVariable($VarSenhaDominio, 'Process')
    [Environment]::SetEnvironmentVariable($VarSenhaDominio, $null, 'Process')
    if ([string]::IsNullOrWhiteSpace($usuario) -or [string]::IsNullOrEmpty($senha)) { return $null }
    $segura = New-Object -TypeName System.Security.SecureString
    foreach ($caractere in $senha.ToCharArray()) { $segura.AppendChar($caractere) }
    $segura.MakeReadOnly()
    $senha = $null
    return New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList $usuario.Trim(), $segura
}

function Invoke-Reinicio {
    # shutdown.exe com atraso: o script termina e o RMM recebe o resultado antes do reinício.
    # p:2:4 = Sistema operacional: reconfiguração (planejada).
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $Nome)
    $minutos = [math]::Ceiling($AtrasoSegundos / 60)
    if (-not (Confirm-Acao -Alvo $env:COMPUTERNAME -Acao ('Agendar o reinício em {0} s' -f $AtrasoSegundos))) { return $false }
    $mensagem = 'O computador vai reiniciar em {0} minuto(s) para concluir a troca de nome para {1}. Salve seu trabalho.' -f $minutos, $Nome
    $shutdown = Join-Path -Path $env:SystemRoot -ChildPath 'System32\shutdown.exe'
    $null = & $shutdown /r /t $AtrasoSegundos /d p:2:4 /c $mensagem
    $codigo = $LASTEXITCODE
    if ($codigo -eq 1190) {   # ERROR_SHUTDOWN_IS_SCHEDULED: já havia um desligamento agendado
        Write-Log -Nivel ALERTA -Mensagem 'Já havia um reinício ou desligamento agendado; o agendamento existente foi mantido.'
        return $true
    }
    if ($codigo -ne 0) { throw ('shutdown.exe devolveu {0} ao agendar o reinício' -f $codigo) }
    Write-Log -Nivel OK -Mensagem ('Reinício agendado em {0} s (cancelar: shutdown /a).' -f $AtrasoSegundos)
    return $true
}

# --- Ação principal ----------------------------------------------------------------------------
function Invoke-Principal {
    [CmdletBinding()]
    param()
    $sistema = Get-CimInstance -ClassName Win32_ComputerSystem
    $ativo = Get-NomeRegistro -Chave 'ActiveComputerName'
    $pendente = Get-NomeRegistro -Chave 'ComputerName'
    $local = if ($sistema.PartOfDomain) { 'domínio {0}' -f $sistema.Domain } else { 'grupo de trabalho {0}' -f $sistema.Workgroup }
    Write-Log -Mensagem ('Nome atual: {0}; depois do reinício: {1}; {2}.' -f $ativo, $pendente, $local)

    # Recusas: renomear DC ou CA exige procedimento próprio (netdom / migração da CA).
    if ($sistema.DomainRole -ge 4) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo 'controlador de domínio: renomeie com o procedimento de netdom computername, não com este script'
        return
    }
    if (Get-Service -Name CertSvc -ErrorAction SilentlyContinue) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo 'Autoridade Certificadora instalada: o nome não pode mudar sem migrar a CA'
        return
    }

    # Idempotência: o Windows não diferencia maiúsculas no nome.
    if ($ativo -ieq $NovoNome -and $pendente -ieq $NovoNome) {
        Write-Log -Nivel OK -Mensagem ('O computador já se chama {0}.' -f $ativo)
        Merge-Resultado -Estado OK -Resumo ('o computador já se chama {0}; nada a fazer' -f $ativo)
        return
    }

    $feito = 'troca já pendente'
    if ($pendente -ieq $NovoNome) {
        Write-Log -Mensagem ('A troca para {0} já foi feita e espera o reinício.' -f $pendente)
    } else {
        if ($pendente -ine $ativo) {
            Write-Log -Nivel ALERTA -Mensagem ('Havia outra troca pendente ({0}); ela será substituída por {1}.' -f $pendente, $NovoNome)
        }
        $parametros = @{ NewName = $NovoNome; Force = $true; PassThru = $true; WarningAction = 'SilentlyContinue'; Confirm = $false }
        if ($sistema.PartOfDomain) {
            # A conta do computador não basta para renomear o objeto no AD: a ajuda do
            # Rename-Computer pede credencial explícita para máquina no domínio.
            $credencial = Get-CredencialDominio
            if ($credencial) {
                $parametros['DomainCredential'] = $credencial
                Write-Log -SoArquivo -Mensagem ('Credencial do domínio recebida de {0} (usuário {1}).' -f $VarSenhaDominio, $credencial.UserName)
            } elseif ($WhatIfPreference) {
                Write-Log -Nivel ALERTA -Mensagem ('Sem {0} e {1}: a execução real no domínio vai exigi-las.' -f $VarUsuarioDominio, $VarSenhaDominio)
            } else {
                Merge-Resultado -Estado DESCONHECIDO -Resumo ('máquina no domínio: defina {0} e {1} (variável segura do RMM)' -f $VarUsuarioDominio, $VarSenhaDominio)
                return
            }
        }
        $sql = @(Get-Service -Name 'MSSQLSERVER', 'MSSQL$*' -ErrorAction SilentlyContinue)
        if ($sql.Count -gt 0) {
            Write-Log -Nivel ALERTA -Mensagem ('SQL Server instalado ({0}): depois do reinício, ajuste @@SERVERNAME com sp_dropserver/sp_addserver.' -f (($sql | ForEach-Object { $_.Name }) -join ', '))
        }
        if (Confirm-Acao -Alvo $ativo -Acao ('Renomear para {0}' -f $NovoNome)) {
            Write-Log -Mensagem ('Nome anterior: {0} (para desfazer: -NovoNome {0}).' -f $ativo)
            $retorno = Rename-Computer @parametros
            $pendente = Get-NomeRegistro -Chave 'ComputerName'
            if (-not $retorno.HasSucceeded -or $pendente -ine $NovoNome) {
                Merge-Resultado -Estado FALHA -Resumo ('Rename-Computer não concluiu a troca (nome pendente: {0})' -f $pendente)
                return
            }
            Write-Log -Nivel OK -Mensagem ('Renomeado: {0} -> {1} (vale depois do reinício).' -f $ativo, $NovoNome)
            if ($sql.Count -gt 0) {
                Merge-Resultado -Estado ALERTA -Resumo ('{0} renomeado para {1}; ajuste o nome no SQL Server depois do reinício' -f $ativo, $NovoNome)
            }
            $feito = 'renomeado'
        } elseif ($WhatIfPreference) {
            $feito = 'seria renomeado'
        } else {
            return   # o operador recusou no console: Confirm-Acao já registrou o ALERTA
        }
    }

    if ($Reiniciar) {
        if (Invoke-Reinicio -Nome $NovoNome) {
            Merge-Resultado -Estado OK -Resumo ('{0} -> {1} ({2}); reinício agendado em {3} s' -f $ativo, $NovoNome, $feito, $AtrasoSegundos)
        } elseif ($WhatIfPreference) {
            Merge-Resultado -Estado OK -Resumo ('{0} -> {1} ({2}); o reinício seria agendado' -f $ativo, $NovoNome, $feito)
        }
        return
    }
    Merge-Resultado -Estado REINICIO_PENDENTE -Resumo ('{0} -> {1} ({2}); reinicie para concluir' -f $ativo, $NovoNome, $feito)
}

# --- Fluxo principal -----------------------------------------------------------------------------
function Invoke-Fluxo {
    [CmdletBinding()]
    param()
    if ($ArgumentosExtras) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo ('parâmetro inválido ou inesperado: {0} (veja Get-Help)' -f ($ArgumentosExtras -join ' '))
        return
    }
    $script:NovoNome = if ($NovoNome) { $NovoNome.Trim() } else { '' }
    if (-not $script:NovoNome) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo 'informe -NovoNome <nome>'
        return
    }
    $motivo = Test-NomeValido -Nome $script:NovoNome
    if ($motivo) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo ('nome inválido "{0}": {1}' -f $script:NovoNome, $motivo)
        return
    }
    if ($AtrasoSegundos -lt 30 -or $AtrasoSegundos -gt 86400) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo ('-AtrasoSegundos fora da faixa: {0} (use de 30 a 86400)' -f $AtrasoSegundos)
        return
    }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo 'este script só roda no Windows'
        return
    }
    $script:EAdmin = Test-Administrador
    if ($script:EAdmin -and -not (Initialize-PastaBase)) { return }
    Initialize-Log
    $usuario = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Write-Log -Nivel INFO -SoArquivo -Mensagem ('Início: {0} {1}; host={2}; usuário={3}; admin={4}; pid={5}; PowerShell {6}' -f $NomeScript, $VersaoScript, $env:COMPUTERNAME, $usuario, $script:EAdmin, $PID, $PSVersionTable.PSVersion)
    Write-Log -Nivel INFO -SoArquivo -Mensagem ('Parâmetros informados: {0}; NovoNome={1}; Reiniciar={2}; AtrasoSegundos={3}' -f $script:ParametrosInformados, $script:NovoNome, [bool]$Reiniciar, $AtrasoSegundos)

    if (-not (Lock-Execucao)) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo 'outra execução deste script está em andamento'
        return
    }
    $build = [Environment]::OSVersion.Version.Build
    if ($build -lt $BuildMinimo) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo ('Windows build {0} abaixo do mínimo suportado ({1})' -f $build, $BuildMinimo)
        return
    }

    # S3: sem console (RMM, tarefa agendada), exige -Confirmar ou sai com 3.
    if ($Confirmar) { $script:ConfirmPreference = 'None' }
    $podePerguntar = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    if (-not $WhatIfPreference -and $ConfirmPreference -ne 'None' -and -not $podePerguntar) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo 'S3: confirme a execução real com -Confirmar (ou simule com -WhatIf)'
        return
    }
    $script:Simulacao = [bool]$WhatIfPreference
    $descricao = if ($script:Simulacao) { 'simulação' } else { 'execução real' }
    Write-Log -Nivel INFO -Mensagem ('{0} {1} em {2} (Windows build {3}): {4}.' -f $NomeScript, $VersaoScript, $env:COMPUTERNAME, $build, $descricao)

    if (-not $script:EAdmin) {
        if (-not $script:Simulacao) {
            Merge-Resultado -Estado DESCONHECIDO -Resumo 'a execução real exige administrador (PowerShell elevado ou SYSTEM no RMM)'
            return
        }
        Write-Log -Nivel ALERTA -Mensagem 'Sem administrador: a simulação continua, mas a execução real exigirá administrador.'
    }
    Invoke-Principal
}

try {
    Invoke-Fluxo
    $script:Concluido = $true
} catch {
    $erro = $_
    if ($script:SemConsoleParaConfirmar) {
        Merge-Resultado -Estado DESCONHECIDO -Resumo 'confirmação necessária e sem console para perguntar: repita com -Confirmar (ou simule com -WhatIf)'
    } else {
        $linha = $erro.InvocationInfo.ScriptLineNumber
        if ([string]$erro.ScriptStackTrace -match '^[^\r\n]*?(\d+)\s*(\r?\n|$)') { $linha = $Matches[1] }
        Write-Log -Nivel ERRO -Mensagem ('Falha na linha {0}: {1}' -f $linha, $erro.Exception.Message)
        Write-LogArquivo -Texto ('Pilha: {0}' -f ($erro.ScriptStackTrace -replace '\r?\n', ' | '))
        Merge-Resultado -Estado FALHA -Resumo ('erro inesperado na linha {0}: {1}' -f $linha, $erro.Exception.Message)
    }
} finally {
    if (-not $script:Concluido -and $script:Codigo -eq 0) {
        Merge-Resultado -Estado FALHA -Resumo 'execução interrompida antes do fim'
    }
    [Environment]::SetEnvironmentVariable($VarSenhaDominio, $null, 'Process')
    Unlock-Execucao
    $resumoFinal = if ($script:Resumo) { $script:Resumo } else { 'concluído' }
    $linhaResultado = 'RESULTADO: {0} - {1}' -f $script:Estado, $resumoFinal
    if ($script:Simulacao) { $linhaResultado += ' [simulação: nada foi alterado]' }
    Write-LogArquivo -Texto $linhaResultado
    Write-Tela -Linha $linhaResultado
}
exit $script:Codigo
