<#
  布局回归检查（可选，需要本机安装 Chrome）：
  用真实浏览器在多个视口宽度下打开 docs/index.html，测量是否出现横向溢出。

  做法：把 index.html 放进一个固定宽度的 iframe（绕开 Windows 窗口最小宽度限制），
  在 iframe 内测量 documentElement.scrollWidth 与 innerWidth，并列出越界元素
  （排除位于 overflow:auto/scroll 容器内的元素——热力矩阵就是有意设计成可横向滚动的）。
  同时确认关键组件真的渲染出来了。

  用法：
      powershell -ExecutionPolicy Bypass -File tools\layout-probe.ps1
      powershell -ExecutionPolicy Bypass -File tools\layout-probe.ps1 -Widths 320,360,768,1240

  退出码 0 = 全部通过；1 = 有视口出现文档级横向溢出或组件未渲染。

  注意：本文件必须保存为 UTF-8 带 BOM，否则 Windows PowerShell 5.1 会按 ANSI 解析中文而报错。
#>
param(
  [int[]]$Widths = @(320, 360, 768, 1240)
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$chromeCands = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $chromeCands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  Write-Output "SKIP: 未找到 Chrome / Edge，跳过布局检查（这是可选检查）"
  exit 0
}

# 预期组件数量（用来确认不是渲染失败导致的"无溢出"）
$expected = @{ donutSegs = 6; cloudWords = 51; matrixCells = 102; cards = 16; rows = 51 }

$harness = @'
<!doctype html><html><head><meta charset="utf-8"><title>layout probe</title></head>
<body style="margin:0">
<pre id="probe-out">PENDING</pre>
<div id="stage"></div>
<script>
var WIDTHS = __WIDTHS__;
var results = [];
function next(i){
  if (i >= WIDTHS.length){
    document.getElementById('probe-out').textContent = 'PROBE_JSON:' + JSON.stringify(results);
    return;
  }
  var w = WIDTHS[i];
  var f = document.createElement('iframe');
  f.style.cssText = 'width:' + w + 'px;height:1500px;border:0';
  f.src = 'index.html';
  f.onload = function(){
    setTimeout(function(){
      var r = { cssWidth: w };
      try {
        var d = f.contentDocument, win = f.contentWindow;
        r.innerWidth = win.innerWidth;
        r.scrollWidth = d.documentElement.scrollWidth;
        r.overflow = d.documentElement.scrollWidth > win.innerWidth + 1;
        var bad = [];
        d.querySelectorAll('*').forEach(function(el){
          var b = el.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) return;
          if (b.right > win.innerWidth + 1 || b.left < -1){
            var sc = false, p = el.parentElement;
            while (p && !sc){ try { if (/auto|scroll/.test(win.getComputedStyle(p).overflowX)) sc = true; } catch(e){} p = p.parentElement; }
            if (!sc){
              var cn = ''; try { cn = el.className ? el.className.toString() : ''; } catch(e){}
              bad.push(el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') + (cn ? '.'+cn.slice(0,30) : '') + '|R' + Math.round(b.right));
            }
          }
        });
        r.offenders = bad.slice(0, 6);
        r.offenderCount = bad.length;
        r.donutSegs  = d.querySelectorAll('#donut .seg').length;
        r.cloudWords = d.querySelectorAll('#cloud .word').length;
        r.matrixCells= d.querySelectorAll('#matrix .mx-cell').length;
        r.cards      = d.querySelectorAll('#list .industry').length;
        r.rows       = d.querySelectorAll('#list .row').length;
      } catch(e){ r.error = e.message; }
      results.push(r);
      f.remove();
      next(i + 1);
    }, 1500);
  };
  document.getElementById('stage').appendChild(f);
}
next(0);
</script></body></html>
'@

$harness = $harness.Replace('__WIDTHS__', (ConvertTo-Json $Widths -Compress))
$probeFile = Join-Path $root "docs\_layout-probe.html"
$fail = 0

try {
  [IO.File]::WriteAllText($probeFile, $harness, $utf8NoBom)
  $url = "file:///" + ($probeFile -replace '\\', '/')
  $win = ([int]($Widths | Measure-Object -Maximum).Maximum) + 120
  $dom = (& $chrome --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files `
      --window-size="$win,1600" --virtual-time-budget=15000 --dump-dom $url 2>$null | Out-String)

  $m = [regex]::Match($dom, 'PROBE_JSON:(\[.*?\])</pre>', 'Singleline')
  if (-not $m.Success) {
    Write-Output "FAIL: 未能取得探针输出（DOM $($dom.Length) 字符）"
    exit 1
  }

  foreach ($r in ($m.Groups[1].Value | ConvertFrom-Json)) {
    Write-Output ("--- 视口 {0}px (innerWidth={1}) ---" -f $r.cssWidth, $r.innerWidth)
    if ($r.error) { Write-Output ("  FAIL 测量异常: " + $r.error); $fail++; continue }

    if ($r.overflow) {
      Write-Output ("  FAIL 文档级横向溢出: scrollWidth={0} > innerWidth={1}" -f $r.scrollWidth, $r.innerWidth)
      $fail++
    } else {
      Write-Output ("  ok   无横向溢出 (scrollWidth={0})" -f $r.scrollWidth)
    }
    if ($r.offenderCount -gt 0) {
      Write-Output ("  FAIL 有 {0} 个元素越界（不在可滚动容器内）:" -f $r.offenderCount)
      $r.offenders | ForEach-Object { Write-Output ("        " + $_) }
      $fail++
    } else {
      Write-Output "  ok   无元素越界"
    }
    foreach ($k in $expected.Keys) {
      $got = $r.$k
      if ($got -ne $expected[$k]) {
        Write-Output ("  FAIL {0} 期望 {1}，实际 {2}" -f $k, $expected[$k], $got)
        $fail++
      }
    }
    if ($r.donutSegs -eq $expected.donutSegs -and $r.cloudWords -eq $expected.cloudWords -and
        $r.matrixCells -eq $expected.matrixCells -and $r.cards -eq $expected.cards -and $r.rows -eq $expected.rows) {
      Write-Output ("  ok   组件齐全: 环形图{0}扇区 / 词云{1}词 / 矩阵{2}格 / {3}产业卡 / {4}行" -f `
        $r.donutSegs, $r.cloudWords, $r.matrixCells, $r.cards, $r.rows)
    }
  }
}
finally {
  if (Test-Path $probeFile) { Remove-Item $probeFile -Force }
}

Write-Output ""
if ($fail -gt 0) { Write-Output "布局检查 FAILED（$fail 项）"; exit 1 }
Write-Output "布局检查 ALL PASS"
exit 0
