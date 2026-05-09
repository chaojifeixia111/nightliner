# scripts/start-ncm-api.ps1
# 启动网易云 API 服务,默认端口 3000
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
NeteaseCloudMusicApi
