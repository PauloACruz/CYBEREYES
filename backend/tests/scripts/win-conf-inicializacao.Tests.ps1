#Requires -Version 5.1
<#
    Teste do win-conf-inicializacao.ps1 num Windows de verdade (CI windows-latest, como administrador): cria entradas
    na inicialização da máquina e do usuário, lista, desabilita e habilita como o console faz e confere StartupApproved.
    Sai com 1 na primeira diferença.
#>
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\..\src\Cybereyes.Api\Rmm\Actions\Scripts\win-conf-inicializacao.ps1'
$aprovado = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
$nomeMaquina = 'Cybereyes Teste Ação'
$nome32 = 'CybereyesTeste32'
$nomeUsuario = 'CybereyesUsuario'
$arquivoPasta = 'cybereyes-teste.cmd'
$pastaComum = [Environment]::GetFolderPath('CommonStartup')
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Assert-Igual($esperado, $obtido, [string]$descricao) {
    if ($esperado -ne $obtido) { throw "$descricao`: esperado '$esperado', obtido '$obtido'" }
    Write-Output "ok - $descricao"
}

function Invoke-Inicio([hashtable]$variaveis) {
    foreach ($nome in 'CYBEREYES_INICIO_ACAO', 'CYBEREYES_INICIO_ESCOPO', 'CYBEREYES_INICIO_LOCAL', 'CYBEREYES_INICIO_NOME_B64') {
        Remove-Item "env:$nome" -ErrorAction SilentlyContinue
    }
    foreach ($nome in $variaveis.Keys) { Set-Item "env:$nome" $variaveis[$nome] }
    $saida = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script
    $codigo = $LASTEXITCODE
    $linha = $saida | Where-Object { $_ -like 'JSONB64:*' } | Select-Object -Last 1
    $lista = if ($linha) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($linha.Substring(8))) | ConvertFrom-Json } else { $null }
    [pscustomobject]@{ Codigo = $codigo; Saida = ($saida -join "`n"); Lista = $lista }
}

function Invoke-Alterar([string]$acao, [string]$escopo, [string]$local, [string]$nome) {
    Invoke-Inicio @{
        CYBEREYES_INICIO_ACAO     = $acao
        CYBEREYES_INICIO_ESCOPO   = $escopo
        CYBEREYES_INICIO_LOCAL    = $local
        CYBEREYES_INICIO_NOME_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($nome))
    }
}

function Find-Item($lista, [string]$escopo, [string]$local, [string]$nome) {
    $item = @($lista.items | Where-Object { $_.scope -eq $escopo -and $_.location -eq $local -and $_.name -eq $nome })
    if ($item.Count -ne 1) { throw "item $escopo/$local/$nome aparece $($item.Count) vez(es)" }
    return $item[0]
}

function Get-PrimeiroByte([Microsoft.Win32.RegistryKey]$raiz, [string]$local, [string]$nome) {
    $chave = $raiz.OpenSubKey("$aprovado\$local")
    $bytes = $null
    if ($chave) { $bytes = $chave.GetValue($nome) }
    if ($bytes -isnot [byte[]]) { return $null }
    return $bytes[0]
}

$maquina = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
$usuario = [Microsoft.Win32.RegistryKey]::OpenBaseKey('Users', 'Registry64').OpenSubKey($sid)

try {
    $maquina.CreateSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Run').SetValue($nomeMaquina, '"C:\Windows\System32\notepad.exe" /teste')
    $maquina.CreateSubKey('SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run').SetValue($nome32, 'C:\Windows\SysWOW64\notepad.exe')
    Set-Content -LiteralPath (Join-Path $pastaComum $arquivoPasta) -Value '@echo off'
    $usuarioRun = [Microsoft.Win32.RegistryKey]::OpenBaseKey('Users', 'Registry64').CreateSubKey("$sid\Software\Microsoft\Windows\CurrentVersion\Run")
    $usuarioRun.SetValue($nomeUsuario, 'C:\Windows\System32\calc.exe')

    $r = Invoke-Inicio @{}
    Assert-Igual 0 $r.Codigo 'lista sai com 0'
    $item = Find-Item $r.Lista 'HKLM' 'Run' $nomeMaquina
    Assert-Igual $true $item.enabled 'entrada nova da máquina habilitada (nome com acento preservado)'
    Assert-Igual 'C:\Windows\System32\notepad.exe' $item.file 'executável tirado do comando entre aspas'
    Assert-Igual 'Microsoft Corporation' $item.publisher 'publicador lido do executável'
    $null = Find-Item $r.Lista 'HKLM' 'Run32' $nome32
    $null = Find-Item $r.Lista 'HKLM' 'StartupFolder' $arquivoPasta
    $doUsuario = Find-Item $r.Lista $sid 'Run' $nomeUsuario
    Assert-Igual ([Security.Principal.WindowsIdentity]::GetCurrent().Name) $doUsuario.user 'usuário da entrada do HKEY_USERS'
    Assert-Igual $true ($r.Lista.users -contains $doUsuario.user) 'usuário com sessão listado'

    $r = Invoke-Alterar 'desabilitar' 'HKLM' 'Run' $nomeMaquina
    Assert-Igual 0 $r.Codigo 'desabilitar sai com 0'
    $item = Find-Item $r.Lista 'HKLM' 'Run' $nomeMaquina
    Assert-Igual $false $item.enabled 'entrada desabilitada na lista devolvida'
    Assert-Igual $true ([bool]$item.disabledAt) 'data da desativação preenchida'
    Assert-Igual 3 (Get-PrimeiroByte $maquina 'Run' $nomeMaquina) 'StartupApproved\Run com 03 (como o Gerenciador de Tarefas)'
    Assert-Igual '"C:\Windows\System32\notepad.exe" /teste' $maquina.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Run').GetValue($nomeMaquina) 'valor Run intacto'

    $r = Invoke-Alterar 'habilitar' 'HKLM' 'Run' $nomeMaquina
    Assert-Igual $true (Find-Item $r.Lista 'HKLM' 'Run' $nomeMaquina).enabled 'entrada habilitada de novo'
    Assert-Igual 2 (Get-PrimeiroByte $maquina 'Run' $nomeMaquina) 'StartupApproved\Run com 02'

    $r = Invoke-Alterar 'desabilitar' 'HKLM' 'StartupFolder' $arquivoPasta
    Assert-Igual $false (Find-Item $r.Lista 'HKLM' 'StartupFolder' $arquivoPasta).enabled 'arquivo da pasta Inicializar desabilitado'
    Assert-Igual 3 (Get-PrimeiroByte $maquina 'StartupFolder' $arquivoPasta) 'StartupApproved\StartupFolder com 03'

    $r = Invoke-Alterar 'desabilitar' 'HKLM' 'Run32' $nome32
    Assert-Igual 3 (Get-PrimeiroByte $maquina 'Run32' $nome32) 'StartupApproved\Run32 com 03'

    $r = Invoke-Alterar 'desabilitar' $sid 'Run' $nomeUsuario
    Assert-Igual $false (Find-Item $r.Lista $sid 'Run' $nomeUsuario).enabled 'entrada do usuário desabilitada'
    Assert-Igual 3 (Get-PrimeiroByte $usuario 'Run' $nomeUsuario) 'StartupApproved\Run do usuário com 03'

    Assert-Igual 3 (Invoke-Alterar 'desabilitar' 'HKLM' 'Run' 'NaoExiste').Codigo 'entrada inexistente sai com 3'
    Assert-Igual 3 (Invoke-Alterar 'desabilitar' 'HKCU' 'Run' $nomeUsuario).Codigo 'escopo inválido sai com 3'
    Assert-Igual 3 (Invoke-Alterar 'apagar' 'HKLM' 'Run' $nomeMaquina).Codigo 'ação inválida sai com 3'
    Assert-Igual 3 (Invoke-Alterar 'desabilitar' 'HKLM' 'StartupFolder' '..\..\x.cmd').Codigo 'nome com caminho sai com 3'
} finally {
    $maquina.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Run', $true).DeleteValue($nomeMaquina, $false)
    $maquina.OpenSubKey('SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', $true).DeleteValue($nome32, $false)
    Remove-Item -LiteralPath (Join-Path $pastaComum $arquivoPasta) -ErrorAction SilentlyContinue
    foreach ($local in 'Run', 'Run32', 'StartupFolder') {
        $chave = $maquina.OpenSubKey("$aprovado\$local", $true)
        if ($chave) { foreach ($nome in $nomeMaquina, $nome32, $arquivoPasta) { $chave.DeleteValue($nome, $false) } }
    }
    $raizUsuario = [Microsoft.Win32.RegistryKey]::OpenBaseKey('Users', 'Registry64').OpenSubKey($sid, $true)
    $raizUsuario.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $true).DeleteValue($nomeUsuario, $false)
    $chave = $raizUsuario.OpenSubKey("$aprovado\Run", $true)
    if ($chave) { $chave.DeleteValue($nomeUsuario, $false) }
}
