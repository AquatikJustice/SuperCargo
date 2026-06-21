# Registers the two scheduled tasks. NOTHING runs until YOU run this script -
# it is intentionally not invoked anywhere. Turn the pipeline on when you're ready
# (after SUPABASE_SECRET_KEY is set and a Python venv exists). Re-run to update.
#
#   powershell -ExecutionPolicy Bypass -File scripts\train\auto\register-tasks.ps1
#
# Tasks run as the current user, only while you're logged on (your PC is always
# on + logged in, so that's fine - no stored password needed). Tweak the times /
# --min-new threshold below to taste.

$ErrorActionPreference = 'Stop'
$auto  = $PSScriptRoot
$drain = Join-Path $auto 'drain.cmd'
$train = Join-Path $auto 'train.cmd'
$user  = "$env:USERDOMAIN\$env:USERNAME"

# Daily: drain Supabase into the local corpus + clear the bucket (04:00).
$drainAction  = New-ScheduledTaskAction -Execute $drain
$drainTrigger = New-ScheduledTaskTrigger -Daily -At 4:00am
Register-ScheduledTask -TaskName 'SuperCargo OCR Drain' -Action $drainAction -Trigger $drainTrigger `
  -User $user -RunLevel Limited -Force `
  -Description 'Daily: drain uploaded OCR samples into the local corpus and clear the Supabase bucket.'

# Weekly: retrain only if >=200 new samples have accrued (Sunday 05:00). Exports
# ONNX into models/<timestamp>/ for review - does NOT deploy anything.
$trainAction  = New-ScheduledTaskAction -Execute $train -Argument '--min-new 200'
$trainTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 5:00am
Register-ScheduledTask -TaskName 'SuperCargo OCR Train' -Action $trainAction -Trigger $trainTrigger `
  -User $user -RunLevel Limited -Force `
  -Description 'Weekly: retrain the CRNN when enough new samples have accrued; exports ONNX only.'

Write-Host 'Registered "SuperCargo OCR Drain" (daily 04:00) and "SuperCargo OCR Train" (Sun 05:00, >=200 new).'
Write-Host 'Review:  Get-ScheduledTask -TaskName "SuperCargo OCR*"'
Write-Host 'Remove:  scripts\train\auto\unregister-tasks.ps1'
