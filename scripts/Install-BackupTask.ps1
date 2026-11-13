param([switch]$RunNow)
$ErrorActionPreference = 'Stop'
try {
$TaskName = 'VikingPM-Daily-Backup'
$TaskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ((Get-TimeZone).Id -ne 'China Standard Time') { throw '本机时区不是北京时间，未登记任务。' }
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing -and $Existing.Description -notlike 'VikingPM database backup;*') { throw '同名任务不属于本项目，未覆盖。' }
$Executable = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$Runner = Join-Path $TaskRoot 'scripts\Run-ScheduledBackup.ps1'
$Action = New-ScheduledTaskAction -Execute $Executable -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Runner + '"') -WorkingDirectory $TaskRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At '21:00'
$Trigger.StartBoundary = (Get-Date -Hour 21 -Minute 0 -Second 0).ToString('yyyy-MM-ddTHH:mm:ss') + '+08:00'
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
# Interactive token retains the current user's existing SMB access without saving a Windows password.
$Principal = New-ScheduledTaskPrincipal -UserId $Identity -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$null = Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description 'VikingPM database backup; daily 21:00 Asia/Shanghai; verified restore and NAS copy; current user must be logged in' -Force -ErrorAction Stop
if ($RunNow) { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop }
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object NextRunTime, LastRunTime, LastTaskResult
@{ state = 'installed'; installedAt = [DateTimeOffset]::Now.ToString('o'); schedule = '21:00 Asia/Shanghai' } | ConvertTo-Json | Set-Content -LiteralPath 'F:\VikingPM\logs\backup-task-setup.json' -Encoding UTF8
} catch {
    @{ state = 'failed'; message = '计划任务注册失败，请使用管理员权限运行安装脚本；未确认定时任务生效。' } | ConvertTo-Json | Set-Content -LiteralPath 'F:\VikingPM\logs\backup-task-setup.json' -Encoding UTF8
    Write-Output '计划任务注册失败；未确认生效。'
    exit 1
}