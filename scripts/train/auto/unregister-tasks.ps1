# Removes the two scheduled tasks. Safe to run even if they were never registered.
#   powershell -ExecutionPolicy Bypass -File scripts\train\auto\unregister-tasks.ps1
$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName 'SuperCargo OCR Drain' -Confirm:$false
Unregister-ScheduledTask -TaskName 'SuperCargo OCR Train' -Confirm:$false
Write-Host 'Removed "SuperCargo OCR Drain" and "SuperCargo OCR Train" (if they existed).'
