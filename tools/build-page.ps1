<#
  从 data/companies.csv 生成：
    - docs/data.json         GitHub Pages 页面用的数据
    - data/by-industry.md    消费者视角的产业分层清单（Markdown）

  单一数据源是 data/companies.csv。改数据请只改 CSV，然后重跑本脚本：
    powershell -ExecutionPolicy Bypass -File tools\build-page.ps1

  注意：本机是 Windows PowerShell 5.1，写文件必须用 UTF8Encoding($false) 去掉 BOM，
  否则 JSON.parse / fetch 会失败。必须用 [IO.File]::WriteAllText。
#>

$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent $PSScriptRoot
$csvPath = Join-Path $root "data\companies.csv"
$jsonOut = Join-Path $root "docs\data.json"
$mdOut   = Join-Path $root "data\by-industry.md"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---- 产业映射（消费者视角）----
$industries = [ordered]@{
  content   = @{ label = "你刷的内容与社区"; desc = "刷短视频、看笔记、追番追剧"; names = @("快手","字节跳动","小红书","哔哩哔哩","乐视") }
  game      = @{ label = "你玩的游戏与社交"; desc = "微信、QQ、手游、端游"; names = @("腾讯","网易") }
  search    = @{ label = "你搜的搜索与工具"; desc = "搜索、网盘、AI 助手"; names = @("百度") }
  ecom      = @{ label = "你逛的电商"; desc = "下单买东西、买生鲜"; names = @("得物","唯品会","SHEIN","阿里巴巴","叮咚买菜") }
  local     = @{ label = "你点的外卖·出行·旅游"; desc = "点外卖、打车、订酒店机票"; names = @("美团","携程","哈啰出行") }
  jobs      = @{ label = "你找工作的平台"; desc = "投简历用的 App"; names = @("BOSS直聘") }
  device    = @{ label = "你用的手机·数码·硬件"; desc = "换手机、买充电器、买无人机"; names = @("vivo","联想集团","大疆","绿联科技","追觅科技") }
  appliance = @{ label = "你家里的家电"; desc = "空调、冰箱、扫地机、小家电"; names = @("格力电器","海尔","美的集团","小熊电器","四川长虹精密电子") }
  car       = @{ label = "你开的车"; desc = "买车、看车"; names = @("长城汽车","小鹏汽车","比亚迪") }
  beauty    = @{ label = "你用的美妆个护"; desc = "护肤品、彩妆"; names = @("贝泰妮","花西子") }
  store     = @{ label = "你逛的店·吃的饭"; desc = "逛商场、喝奶茶、下馆子、逛超市、逛免税店"; names = @("肯德基中国","瑞幸咖啡","海底捞","永辉超市","中国中免","麦当劳中国","古茗","蜜雪冰城","李宁","胖东来","名创优品","泡泡玛特") }
  show      = @{ label = "你看的演出"; desc = "演唱会、话剧、音乐节买票"; names = @("大麦网") }
  fin       = @{ label = "你用的金融 App"; desc = "支付、理财、保险"; names = @("蚂蚁集团") }
  edu       = @{ label = "你上的课"; desc = "报班、买课、网课"; names = @("好未来","猿辅导") }
  health    = @{ label = "你看的病"; desc = "体检、看眼科"; names = @("爱尔眼科","爱康国宾") }
  house     = @{ label = "你租房买房用的 App"; desc = "找房、看房"; names = @("安居客") }
}

# ---- CSV 状态 -> 页面状态 ----
function Get-StatusMeta([string]$raw) {
  switch ($raw) {
    "双休"           { return @{ key = "double";  label = "双休";        icon = "OK";  tone = "green" } }
    "部分双休"       { return @{ key = "partial"; label = "部分双休";    icon = "~";   tone = "amber" } }
    "岗位级双休"     { return @{ key = "jd";      label = "岗位级双休";  icon = "JD";  tone = "blue" } }
    "混合办公"       { return @{ key = "hybrid";  label = "混合办公";    icon = "HM";  tone = "slate" } }
    "四天半工作制"   { return @{ key = "four5";   label = "四天半工作制";icon = "4.5"; tone = "teal" } }
    "排班制"         { return @{ key = "shift";   label = "排班制";      icon = "SH";  tone = "purple" } }
    "大小周"         { return @{ key = "bigsmall";label = "大小周";      icon = "!";   tone = "red" } }
    "单休"           { return @{ key = "one";     label = "单休";        icon = "!";   tone = "red" } }
    default          { return @{ key = "unknown"; label = "不明";        icon = "?";   tone = "gray" } }
  }
}

# ---- 读取 CSV ----
if (-not (Test-Path $csvPath)) { throw "找不到 $csvPath" }
$rows = Import-Csv -Path $csvPath -Encoding UTF8
Write-Output ("读取 CSV 记录数: {0}" -f $rows.Count)

# ---- 建立 name -> row 索引，并做映射一致性检查 ----
$byName = @{}
foreach ($r in $rows) {
  $n = $r.name.Trim()
  if ($byName.ContainsKey($n)) { Write-Output ("WARN 重复公司名: {0}" -f $n) }
  $byName[$n] = $r
}

$mapped = New-Object System.Collections.Generic.List[string]
foreach ($k in $industries.Keys) { foreach ($n in $industries[$k].names) { $mapped.Add($n) } }

$missingInCsv = @($mapped | Where-Object { -not $byName.ContainsKey($_) })
$notMapped    = @($byName.Keys | Where-Object { $mapped -notcontains $_ })
if ($missingInCsv.Count -gt 0) { Write-Output ("WARN 映射里有但 CSV 没有: {0}" -f ($missingInCsv -join ", ")) }
if ($notMapped.Count -gt 0)    { Write-Output ("WARN CSV 里有但未映射到产业: {0}" -f ($notMapped -join ", ")) }

# ---- 组装 ----
$companies = New-Object System.Collections.Generic.List[object]
foreach ($k in $industries.Keys) {
  $ind = $industries[$k]
  foreach ($n in $ind.names) {
    if (-not $byName.ContainsKey($n)) { continue }
    $r = $byName[$n]
    $sm = Get-StatusMeta $r.weekend_status
    $companies.Add([ordered]@{
      name          = $n
      industry      = $k
      industryLabel = $ind.label
      category      = $r.category
      product       = $r.c_end_product
      statusRaw     = $r.weekend_status
      status        = $sm.key
      statusLabel   = $sm.label
      tone          = $sm.tone
      evidence      = $r.evidence_level
      detail        = $r.detail
      asOf          = $r.as_of
      url           = $r.source_url
    })
  }
}

$industryList = New-Object System.Collections.Generic.List[object]
foreach ($k in $industries.Keys) {
  $ind = $industries[$k]
  $cnt = @($companies | Where-Object { $_.industry -eq $k }).Count
  if ($cnt -eq 0) { continue }
  $industryList.Add([ordered]@{ key = $k; label = $ind.label; desc = $ind.desc; count = $cnt })
}

$payload = [ordered]@{
  generatedAt = (Get-Date -Format "yyyy-MM-dd")
  note        = "本页面数据由 data/companies.csv 自动生成，请勿手工编辑 docs/data.json"
  industries  = $industryList
  companies   = $companies
}

# ---- 写 data.json（无 BOM！）----
$jsonDir = Split-Path -Parent $jsonOut
if (-not (Test-Path $jsonDir)) { New-Item -ItemType Directory -Force -Path $jsonDir | Out-Null }
$json = $payload | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($jsonOut, $json, $utf8NoBom)
Write-Output ("已写出 {0} ({1} bytes)" -f $jsonOut, (Get-Item $jsonOut).Length)

# ---- 写 by-industry.md ----
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# 消费者视角：按产业看双休")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("> 换个问法：**你正在消费的这家公司，员工是不是双休？**")
[void]$sb.AppendLine(">")
[void]$sb.AppendLine('> 本文件由 `tools/build-page.ps1` 从 [`data/companies.csv`](companies.csv) 自动生成，**请勿手工编辑**。')
[void]$sb.AppendLine(">")
[void]$sb.AppendLine(("> 数据截止：**{0}**。状态说明：✅ 双休（全公司明确）｜🟡 部分双休 / 有例外｜🔵 仅岗位级 JD 证据｜🟠 排班制（一线岗位）｜⚪ 不明（证据不足）。" -f $payload.generatedAt))
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## 速查表")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| 产业（你作为消费者接触的场景） | 品牌 | 状态 |")
[void]$sb.AppendLine("|---|---|---|")
foreach ($ind in $industryList) {
  $items = $companies | Where-Object { $_.industry -eq $ind.key }
  $ok    = @($items | Where-Object { $_.status -eq "double"  } | ForEach-Object { $_.name })
  $mid   = @($items | Where-Object { $_.status -in @("partial","jd","hybrid","four5","bigsmall","one") } | ForEach-Object { $_.name })
  $shift = @($items | Where-Object { $_.status -eq "shift" } | ForEach-Object { $_.name })
  $unk   = @($items | Where-Object { $_.status -eq "unknown" } | ForEach-Object { $_.name })
  $cells = New-Object System.Collections.Generic.List[string]
  if ($ok.Count -gt 0)    { $cells.Add("✅ " + ($ok -join "、")) }
  if ($mid.Count -gt 0)   { $cells.Add("🟡 " + ($mid -join "、")) }
  if ($shift.Count -gt 0) { $cells.Add("🟠 " + ($shift -join "、")) }
  if ($unk.Count -gt 0)   { $cells.Add("⚪ " + ($unk -join "、")) }
  $brands = ($cells -join "<br>")
  [void]$sb.AppendLine(("| **{0}**<br><sub>{1}</sub> | {2} | {3} 家 |" -f $ind.label, $ind.desc, $brands, $ind.count))
}
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## 明细（含证据与时间点）")
[void]$sb.AppendLine("")
foreach ($ind in $industryList) {
  [void]$sb.AppendLine(("### {0}" -f $ind.label))
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine(("> {0}" -f $ind.desc))
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("| 品牌 | 产品 / 服务 | 状态 | 证据 | 说明 | 时间 | 来源 |")
  [void]$sb.AppendLine("|---|---|---|---|---|---|---|")
  foreach ($c in ($companies | Where-Object { $_.industry -eq $ind.key })) {
    $icon = switch ($c.status) {
      "double"  { "✅ 双休" }
      "partial" { "🟡 部分双休" }
      "jd"      { "🔵 岗位级双休" }
      "hybrid"  { "🔵 混合办公" }
      "four5"   { "🔵 四天半" }
      "shift"   { "🟠 排班制" }
      default   { "⚪ 不明" }
    }
    $d = $c.detail -replace "\|", "\|"
    [void]$sb.AppendLine(("| **{0}** | {1} | {2} | {3} | {4} | {5} | [链接]({6}) |" -f $c.name, $c.product, $icon, $c.evidence, $d, $c.asOf, $c.url))
  }
  [void]$sb.AppendLine("")
}
[void]$sb.AppendLine("---")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## 读这张表时的三个提醒")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("1. **⚠️ 不明 ≠ 不是双休。** 它只代表我们**没有找到**达标的公开来源。本仓库不发布证据不足的负面结论。")
[void]$sb.AppendLine("2. **⚠️ 同一个品牌，店面和你买的那个 App 可能是两套作息。** 门店、餐厅、配送、产线、客服、医院临床岗基本都是排班制；总部研发职能岗才可能是双休。")
[void]$sb.AppendLine("3. **⚠️ 买谁的东西是个人选择。** 本清单只做事实汇编，不号召任何抵制或消费行为。")
$mdOutDir = Split-Path -Parent $mdOut
if (-not (Test-Path $mdOutDir)) { New-Item -ItemType Directory -Force -Path $mdOutDir | Out-Null }
[IO.File]::WriteAllText($mdOut, $sb.ToString(), $utf8NoBom)
Write-Output ("已写出 {0} ({1} bytes)" -f $mdOut, (Get-Item $mdOut).Length)

Write-Output ("产业数: {0}  公司数: {1}" -f $industryList.Count, $companies.Count)
