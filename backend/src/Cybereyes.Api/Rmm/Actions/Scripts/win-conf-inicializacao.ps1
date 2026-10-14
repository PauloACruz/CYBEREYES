#Requires -Version 5.1

<#
.SYNOPSIS
    Lista, habilita e desabilita os programas da inicialização do Windows (os mesmos do Gerenciador de Tarefas).
.DESCRIPTION
    Lê as chaves Run da máquina (64 e 32 bits) e dos usuários com sessão aberta (HKEY_USERS) e as pastas
    Inicializar (de todos os usuários e de cada usuário com sessão). O estado vem de StartupApproved, onde o
    Gerenciador de Tarefas grava: habilitar e desabilitar mudam só esse valor, a entrada continua no lugar e
    pode voltar a qualquer momento.
    Sem a variável CYBEREYES_INICIO_ACAO, só lista. Com ela, altera a entrada indicada e lista de novo.
    A lista sai numa linha "JSONB64:" (JSON em UTF-8, em base64, imune à página de código do console).
    Variáveis da alteração:
      CYBEREYES_INICIO_ACAO      habilitar | desabilitar
      CYBEREYES_INICIO_ESCOPO    HKLM ou o SID do usuário
      CYBEREYES_INICIO_LOCAL     Run | Run32 | StartupFolder
      CYBEREYES_INICIO_NOME_B64  nome do valor (Run) ou do arquivo (pasta), em UTF-8 e base64
.NOTES
    Nome        : win-conf-inicializacao.ps1
    Plataforma  : WIN
    Genero      : CONF
    Shell       : PS51
    Alvo        : Estacao, Servidor
    Codigos     : 0 = ok; 1 = falha; 3 = parâmetro inválido ou entrada inexistente
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$aprovadoBase = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
$caminhosRun = @{
    'Run'   = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
    'Run32' = 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
}
$visao = [Microsoft.Win32.RegistryView]::Registry64
$maquina = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $visao)
$usuarios = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::Users, $visao)

function Get-Raiz([string]$escopo) {
    if ($escopo -eq 'HKLM') { return $maquina }
    return $usuarios.OpenSubKey($escopo, $true)
}

function Get-NomeUsuario([string]$sid) {
    try {
        return (New-Object System.Security.Principal.SecurityIdentifier($sid)).Translate([System.Security.Principal.NTAccount]).Value
    } catch {
        return $sid
    }
}

# Pasta Inicializar do usuário: a de "Shell Folders" do perfil dele, ou a padrão dentro do perfil.
function Get-PastaUsuario([string]$sid) {
    $perfil = $maquina.OpenSubKey("SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid")
    if ($null -eq $perfil) { return $null }
    $casa = [string]$perfil.GetValue('ProfileImagePath')
    if (-not $casa) { return $null }
    $pastas = $usuarios.OpenSubKey("$sid\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders")
    if ($null -ne $pastas) {
        $pasta = [string]$pastas.GetValue('Startup')
        if ($pasta -and -not $pasta.Contains('%')) { return $pasta }
    }
    return Join-Path $casa 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
}

function Get-Executavel([string]$comando) {
    if (-not $comando) { return $null }
    $texto = [Environment]::ExpandEnvironmentVariables($comando.Trim())
    if ($texto.StartsWith('"')) {
        $fim = $texto.IndexOf('"', 1)
        if ($fim -gt 1) { return $texto.Substring(1, $fim - 1) }
        return $null
    }
    $achado = [regex]::Match($texto, '^(.+?\.(exe|com|bat|cmd|ps1|vbs|js))(\s|$)', 'IgnoreCase')
    if ($achado.Success) { return $achado.Groups[1].Value }
    return ($texto -split '\s+')[0]
}

function Get-InfoArquivo([string]$caminho) {
    $info = @{ descricao = $null; publicador = $null }
    if ($caminho -and [IO.Path]::IsPathRooted($caminho) -and (Test-Path -LiteralPath $caminho -PathType Leaf)) {
        try {
            $versao = (Get-Item -LiteralPath $caminho).VersionInfo
            if ($versao.FileDescription) { $info.descricao = $versao.FileDescription.Trim() }
            if ($versao.CompanyName) { $info.publicador = $versao.CompanyName.Trim() }
        } catch {
            Write-Verbose $_.Exception.Message
        }
    }
    return $info
}

# Valor em StartupApproved: ausente = habilitado; primeiro byte ímpar (03, 07) = desabilitado, com a data em FILETIME.
function Get-Estado($raiz, [string]$local, [string]$nome) {
    $chave = $raiz.OpenSubKey("$aprovadoBase\$local")
    $bytes = if ($null -ne $chave) { $chave.GetValue($nome) } else { $null }
    if ($bytes -isnot [byte[]] -or $bytes.Length -eq 0 -or ($bytes[0] -band 1) -eq 0) {
        return @{ habilitado = $true; desde = $null }
    }
    $desde = $null
    if ($bytes.Length -ge 12) {
        $ft = [BitConverter]::ToInt64($bytes, 4)
        if ($ft -gt 0) {
            try { $desde = [DateTime]::FromFileTimeUtc($ft).ToString('o') } catch { $desde = $null }
        }
    }
    return @{ habilitado = $false; desde = $desde }
}

function ConvertTo-ItemInicio($raiz, [string]$escopo, [string]$local, [string]$nome, [string]$usuario, [string]$comando, [string]$arquivo) {
    $estado = Get-Estado $raiz $local $nome
    $info = Get-InfoArquivo $arquivo
    [pscustomobject]@{
        scope       = $escopo
        location    = $local
        name        = $nome
        user        = $usuario
        command     = $comando
        file        = $arquivo
        description = $info.descricao
        publisher   = $info.publicador
        enabled     = $estado.habilitado
        disabledAt  = $estado.desde
    }
}

function Get-ItensRun($raiz, [string]$escopo, [string]$usuario, [string[]]$locais) {
    foreach ($local in $locais) {
        $chave = $raiz.OpenSubKey($caminhosRun[$local])
        if ($null -eq $chave) { continue }
        foreach ($nome in $chave.GetValueNames()) {
            if (-not $nome) { continue }
            $comando = [string]$chave.GetValue($nome)
            ConvertTo-ItemInicio $raiz $escopo $local $nome $usuario $comando (Get-Executavel $comando)
        }
    }
}

function Get-ItensPasta($raiz, [string]$escopo, [string]$usuario, [string]$pasta) {
    if (-not $pasta -or -not (Test-Path -LiteralPath $pasta -PathType Container)) { return }
    $atalhos = $null
    foreach ($arquivo in Get-ChildItem -LiteralPath $pasta -File -Force) {
        if ($arquivo.Name -ieq 'desktop.ini') { continue }
        $alvo = $arquivo.FullName
        $comando = $arquivo.FullName
        if ($arquivo.Extension -ieq '.lnk') {
            try {
                if ($null -eq $atalhos) { $atalhos = New-Object -ComObject WScript.Shell }
                $atalho = $atalhos.CreateShortcut($arquivo.FullName)
                if ($atalho.TargetPath) {
                    $alvo = $atalho.TargetPath
                    $comando = ('"{0}" {1}' -f $atalho.TargetPath, $atalho.Arguments).Trim()
                }
            } catch {
                Write-Verbose $_.Exception.Message
            }
        }
        ConvertTo-ItemInicio $raiz $escopo 'StartupFolder' $arquivo.Name $usuario $comando $alvo
    }
}

function Get-Lista {
    $itens = New-Object System.Collections.Generic.List[object]
    foreach ($item in Get-ItensRun $maquina 'HKLM' $null @('Run', 'Run32')) { $itens.Add($item) }
    foreach ($item in Get-ItensPasta $maquina 'HKLM' $null ([Environment]::GetFolderPath('CommonStartup'))) { $itens.Add($item) }
    $nomes = New-Object System.Collections.Generic.List[string]
    foreach ($sid in $usuarios.GetSubKeyNames()) {
        if ($sid -notmatch '^S-1-5-21-[\d-]+$') { continue }
        $raiz = $usuarios.OpenSubKey($sid)
        if ($null -eq $raiz) { continue }
        $usuario = Get-NomeUsuario $sid
        $nomes.Add($usuario)
        foreach ($item in Get-ItensRun $raiz $sid $usuario @('Run')) { $itens.Add($item) }
        foreach ($item in Get-ItensPasta $raiz $sid $usuario (Get-PastaUsuario $sid)) { $itens.Add($item) }
    }
    return [pscustomobject]@{ items = @($itens.ToArray()); users = @($nomes.ToArray()) }
}

function Write-Lista {
    $json = ConvertTo-Json -InputObject (Get-Lista) -Depth 4 -Compress
    Write-Output ('JSONB64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
}

try {
    $acao = $env:CYBEREYES_INICIO_ACAO
    if (-not $acao) {
        Write-Lista
        Write-Output 'RESULTADO: OK - lista da inicialização'
        exit 0
    }

    $escopo = [string]$env:CYBEREYES_INICIO_ESCOPO
    $local = [string]$env:CYBEREYES_INICIO_LOCAL
    $nome = ''
    try { $nome = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$env:CYBEREYES_INICIO_NOME_B64)) } catch { $nome = '' }
    if ($acao -notin @('habilitar', 'desabilitar') -or $escopo -notmatch '^(HKLM|S-1-5-21-[\d-]+)$' -or
        $local -notin @('Run', 'Run32', 'StartupFolder') -or -not $nome -or ($local -eq 'Run32' -and $escopo -ne 'HKLM')) {
        Write-Output 'RESULTADO: ERRO - parâmetros inválidos'
        exit 3
    }
    $raiz = Get-Raiz $escopo
    if ($null -eq $raiz) {
        Write-Output 'RESULTADO: ERRO - o usuário não está com sessão aberta'
        exit 3
    }

    # Só aprova o que existe: a entrada tem de estar na chave Run ou na pasta Inicializar.
    $existe = $false
    if ($local -eq 'StartupFolder') {
        $pasta = if ($escopo -eq 'HKLM') { [Environment]::GetFolderPath('CommonStartup') } else { Get-PastaUsuario $escopo }
        $existe = $pasta -and $nome.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -lt 0 -and (Test-Path -LiteralPath (Join-Path $pasta $nome) -PathType Leaf)
    } else {
        $chave = $raiz.OpenSubKey($caminhosRun[$local])
        $existe = $null -ne $chave -and $chave.GetValueNames() -contains $nome
    }
    if (-not $existe) {
        Write-Output 'RESULTADO: ERRO - entrada não encontrada na inicialização'
        exit 3
    }

    $aprovado = $raiz.CreateSubKey("$aprovadoBase\$local")
    if ($acao -eq 'desabilitar') {
        $bytes = [byte[]](@(3, 0, 0, 0) + [BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()))
    } else {
        $bytes = [byte[]](2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    }
    $aprovado.SetValue($nome, $bytes, [Microsoft.Win32.RegistryValueKind]::Binary)
    $aprovado.Close()

    Write-Lista
    Write-Output ('RESULTADO: OK - {0} {1}' -f $nome, $(if ($acao -eq 'desabilitar') { 'desabilitado' } else { 'habilitado' }))
    exit 0
} catch {
    Write-Output ('RESULTADO: ERRO - {0}' -f $_.Exception.Message)
    exit 1
}
