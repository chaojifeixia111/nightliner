# 一键启动 Nightliner:缺哪个起哪个,各占一个独立窗口,已在跑的跳过
$root = Split-Path $PSScriptRoot -Parent

function Test-Port($p) {
  [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

if (Test-Port 3000) {
  Write-Host "3000 网易云 API:已在跑,跳过"
} else {
  Write-Host "3000 网易云 API:启动中..."
  Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',"$root\scripts\start-ncm-api.ps1"
}

if (Test-Port 8080) {
  Write-Host "8080 Nightliner 后端:已在跑,跳过"
} else {
  Write-Host "8080 Nightliner 后端:启动中...(BGE 预热约 3 秒)"
  Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit','-Command','npm start'
}

Write-Host ""
Write-Host "听歌入口: http://127.0.0.1:8080  (开发热更新另起: npm --prefix pwa run dev → :5173)"
Start-Sleep -Seconds 3
