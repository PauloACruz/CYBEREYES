#Requires -Version 5.1
<#
    Teste do win-eyes-restaurar-binario.cmd num Windows de verdade (CI windows-latest, como administrador): roda o comando como
    o agente roda (cmd /D /S /C "chcp 65001 >NUL & <comando>") na pasta real do EYES em %ProgramFiles%, nos tres casos: eyes.exe
    no lugar, eyes.exe ausente com o .old e sem nenhum dos dois. Usa a pasta real porque o Windows recalcula %ProgramFiles% em
    cada processo novo (uma pasta temporaria passada pelo ambiente nao chega ao cmd). Recusa rodar numa maquina com o EYES
    instalado. Sai com 1 na primeira diferença.
#>
$ErrorActionPreference = 'Stop'
$comando = (Get-Content -Raw (Join-Path $PSScriptRoot '..\..\src\Cybereyes.Api\Rmm\Actions\Scripts\win-eyes-restaurar-binario.cmd')).Trim()
$raiz = Join-Path $env:ProgramFiles 'Cybereyes'
$pasta = Join-Path $raiz 'EYES'
$exe = Join-Path $pasta 'eyes.exe'
$old = "$exe.old"
if (Test-Path $raiz) { throw "$raiz ja existe: este teste nao roda numa maquina com o EYES instalado" }

function Assert-Igual($esperado, $obtido, [string]$descricao) {
    if ($esperado -ne $obtido) { throw "$descricao`: esperado '$esperado', obtido '$obtido'" }
    Write-Output "ok - $descricao"
}

function Invoke-Restaurar {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $psi.Arguments = '/D /S /C "chcp 65001 >NUL & ' + $comando + '"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $processo = [Diagnostics.Process]::Start($psi)
    $saida = $processo.StandardOutput.ReadToEnd().Trim()
    $processo.WaitForExit()
    $saida
}

try {
    New-Item -ItemType Directory -Path $pasta -Force | Out-Null
    Set-Content -Path $exe -Value 'novo' -NoNewline
    Set-Content -Path $old -Value 'antigo' -NoNewline

    Assert-Igual 'eyes.exe ja estava no lugar' (Invoke-Restaurar) 'eyes.exe no lugar: nada muda'
    Assert-Igual 'novo' (Get-Content -Raw $exe) 'eyes.exe continua o mesmo'

    Remove-Item $exe
    Assert-Igual 'eyes.exe recolocado a partir do .old' (Invoke-Restaurar) 'sem eyes.exe: recoloca a partir do .old'
    Assert-Igual 'antigo' (Get-Content -Raw $exe) 'eyes.exe e a copia do .old'
    Assert-Igual $true (Test-Path $old) 'o .old continua (pode ser a imagem em execucao)'

    Remove-Item $exe, $old
    Assert-Igual 'eyes.exe ausente e sem .old' (Invoke-Restaurar) 'sem eyes.exe e sem .old: so avisa'
} finally {
    Remove-Item -Recurse -Force $raiz -ErrorAction SilentlyContinue
}
exit 0
