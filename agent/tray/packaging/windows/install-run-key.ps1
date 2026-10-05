# Registra o EYES na chave Run de HKLM (executar como administrador).
param([string]$Exe = "C:\Program Files\Cybereyes\EYES\eyes-tray.exe")
$key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $key -Name "EyesTray" -Value "`"$Exe`" --hidden"
