# 一键停止 Nightliner:按端口反查并结束 8080(后端)/ 5173(Vite)/ 3000(网易云 API)
foreach ($port in 8080, 5173, 3000) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    foreach ($procId in ($conn.OwningProcess | Sort-Object -Unique)) {
      $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
      Write-Host "停止 :$port (PID $procId, $name)"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  } else {
    Write-Host ":$port 没在跑"
  }
}
Write-Host ""
Write-Host "全部处理完毕。"
Start-Sleep -Seconds 3
