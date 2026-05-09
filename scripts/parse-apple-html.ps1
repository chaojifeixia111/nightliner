# scripts/parse-apple-html.ps1
# Usage: .\scripts\parse-apple-html.ps1 -InputHtml "C:\path\to\playlist.html" -OutputMd "user\apple-music-favorites-2024-2026.md"

param(
    [Parameter(Mandatory=$true)][string]$InputHtml,
    [Parameter(Mandatory=$true)][string]$OutputMd
)

if (-not (Test-Path $InputHtml)) {
    Write-Error "Input HTML not found: $InputHtml"
    exit 1
}

$html = Get-Content $InputHtml -Raw -Encoding UTF8

# 1. Try JSON-LD metadata; fall back to <title> + today's date
$jsonPattern = '<script id="schema:music-playlist" type="application/ld\+json">([\s\S]+?)</script>'
$jsonMatch = [regex]::Match($html, $jsonPattern)
if ($jsonMatch.Success) {
    $meta = $jsonMatch.Groups[1].Value | ConvertFrom-Json
    $numTracks = $meta.numTracks
    $datePublished = $meta.datePublished
    $playlistName = $meta.name
} else {
    Write-Warning "JSON-LD not found; falling back to <title> + today's date"
    $titleMatch = [regex]::Match($html, '<title>([^<]+)</title>')
    $playlistName = if ($titleMatch.Success) { ($titleMatch.Groups[1].Value -split ' - ')[0] } else { 'Favorite Songs' }
    $datePublished = (Get-Date -Format 'yyyy-MM-dd')
    $numTracks = 0  # determined from aria-label count below
}

# 2. Extract song-artist pairs from aria-labels
$pattern = 'aria-label="播放(.+?)的《(.+?)》"'
$allMatches = [regex]::Matches($html, $pattern)

$tracks = @()
$seen = @{}
foreach ($m in $allMatches) {
    $artist = $m.Groups[1].Value -replace '&amp;', '&' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&lt;', '<' -replace '&gt;', '>'
    $title = $m.Groups[2].Value -replace '&amp;', '&' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&lt;', '<' -replace '&gt;', '>'
    $key = "$title|$artist"
    if (-not $seen.ContainsKey($key)) {
        $tracks += [PSCustomObject]@{ Title = $title; Artist = $artist }
        $seen[$key] = $true
        if ($numTracks -gt 0 -and $tracks.Count -ge $numTracks) { break }
    }
}

if ($numTracks -eq 0) { $numTracks = $tracks.Count }
if ($tracks.Count -ne $numTracks) {
    Write-Warning "Extracted $($tracks.Count) tracks but expected $numTracks. Output anyway."
}

# 3. Build markdown
$md = "# Apple Music · $playlistName`n`n"
$md += "> **来源**: HTML 导出 + parse-apple-html.ps1`n"
$md += "> **导出日期**: $datePublished`n"
$md += "> **总歌数**: $numTracks 首`n"
$md += "> **解析得**: $($tracks.Count) 首`n`n"
$md += "---`n`n## 完整歌曲列表(按歌单顺序)`n`n"

for ($i = 0; $i -lt $tracks.Count; $i++) {
    $md += "{0,3}. {1} / {2}`n" -f ($i + 1), $tracks[$i].Title, $tracks[$i].Artist
}

$md += "`n---`n`n"
$md += "## 给 Opus 的 taste 分析提示(M-init 阶段使用)`n`n"
$md += "> 这 $numTracks 首是用户在 2024-2026 期间累积进 Apple Music ``$playlistName`` 歌单的歌。`n"
$md += "> 分析时:`n"
$md += "> 1. 识别**主轴口味**(出现频次最高的艺人/类型)`n"
$md += "> 2. 识别**怀旧维度**(歌单里大量 2003-2010 千禧华语 + 2014-2016 K-pop → 即使近期收藏的也含强怀旧成分)`n"
$md += "> 3. 识别**情绪光谱**:upbeat/dancing vs 抒情共鸣`n"
$md += "> 4. **明显排除项**:几乎没有 jazz / classical / metal / underground / 实验电子 / 后摇`n"
$md += "> 5. **跨语种共同点**:节奏感强 + 旋律记忆点高 + 副歌可哼唱`n"
$md += "> 6. 与网易云 945616754(2017-2023 主流偏好)的重叠/差异 → 推断当前听歌的连续性 vs 新探索方向`n"

$md | Out-File -FilePath $OutputMd -Encoding utf8 -NoNewline
"Wrote $($tracks.Count) tracks to $OutputMd"
