# Run this as Administrator!
Write-Host "Enabling Windows Subsystem for Linux..."
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart

Write-Host "Enabling Virtual Machine Platform..."
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

Write-Host ""
Write-Host "✅ Windows features enabled!"
Write-Host "⚠️  IMPORTANT: You must restart your computer now"
Write-Host ""
Read-Host "Press Enter to restart now"
Restart-Computer
