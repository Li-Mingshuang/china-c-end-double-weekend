/* 渲染冒烟测试：在 Node 里用最小 DOM 桩真实跑一遍 docs/app.js。
   覆盖：环形图 / 词云 / 热力矩阵 / 筛选 / 搜索 / 排序 / 数字滚动 / 事件委托 / CSS 契约。

   用法：node tools/smoke-test.js
   退出码非 0 表示失败（可直接用于 CI）。 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataPath = path.join(root, 'docs', 'data.json');
const appPath = path.join(root, 'docs', 'app.js');
const cssPath = path.join(root, 'docs', 'style.css');
const htmlPath = path.join(root, 'docs', 'index.html');

const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else {
    failures.push(name);
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''));
  }
}
function section(t) { console.log('\n[' + t + ']'); }

// ---------- 最小 DOM 桩 ----------
function makeEl(tag) {
  return {
    tag: tag || 'div',
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    _handlers: {},
    _attrs: {},
    addEventListener(type, fn) { this._handlers[type] = fn; },
    querySelectorAll() { return []; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = v; }
  };
}

const els = {};
const doc = {
  readyState: 'complete',
  documentElement: {
    _cls: new Set(),
    classList: {
      add(c) { doc.documentElement._cls.add(c); },
      contains(c) { return doc.documentElement._cls.has(c); }
    }
  },
  getElementById(id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  querySelectorAll() { return []; },
  addEventListener() {}
};

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const css = fs.readFileSync(cssPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

// 让 #stats 能"找到"数字节点，用来测数字滚动
const statNodes = [
  Object.assign(makeEl('b'), { _attrs: { 'data-count': String(data.companies.length) } })
];
els['stats'] = makeEl('div');
els['stats'].querySelectorAll = function (sel) { return sel === '[data-count]' ? statNodes : []; };

// 让 #cloud-sort 能"找到"三个排序按钮
const csort = ['score', 'industry', 'shuffle'].map(function (v) {
  const e = makeEl('button');
  e._attrs['data-csort'] = v;
  return e;
});
els['cloud-sort'] = makeEl('div');
els['cloud-sort'].querySelectorAll = function (sel) { return sel === '[data-csort]' ? csort : []; };

global.document = doc;
global.matchMedia = function () { return { matches: false }; };

const frames = [];
global.requestAnimationFrame = function (cb) { frames.push(cb); return frames.length; };
function drainFrames(steps) {
  let ts = 0;
  for (let i = 0; i < (steps || 40); i++) {
    if (!frames.length) break;
    const batch = frames.splice(0, frames.length);
    ts += 60;
    batch.forEach((cb) => cb(ts));
  }
}

global.fetch = function () {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
};

function target(attrs) {
  return {
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    parentNode: null
  };
}
function click(el, attrs) {
  const h = el && el._handlers && el._handlers.click;
  if (typeof h !== 'function') return false;
  h({ target: target(attrs) });
  return true;
}

// ---------- 运行 ----------
const code = fs.readFileSync(appPath, 'utf8');
let bootError = null;

(async function main() {
  console.log('data.json: industries=' + data.industries.length + ' companies=' + data.companies.length);

  try { (0, eval)(code); } catch (e) { bootError = e; }
  check('app.js 加载无异常', !bootError, bootError && bootError.message);

  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));

  const statsHtml = els.stats.innerHTML || '';
  const listHtml = els.list.innerHTML || '';
  const count = () => els.count.textContent || '';
  // 注意负向断言：不要匹配到容器 <div class="rows">
  const rowsIn = (h) => (h.match(/class="row(?!s)/g) || []).length;
  const wordsIn = (h) => (h.match(/class="word[^"]*"/g) || []).length;

  section('基础渲染');
  check('stats 渲染总数', /已收录企业/.test(statsHtml));
  check('asof 已填充', els.asof.textContent === data.generatedAt, els.asof.textContent);
  check('chips 含「全部」', /全部/.test(els.chips.innerHTML));
  check('产业区块数 = ' + data.industries.length,
        (listHtml.match(/class="industry"/g) || []).length === data.industries.length);
  check('公司行数 = ' + data.companies.length,
        rowsIn(listHtml) === data.companies.length, '实际 ' + rowsIn(listHtml));
  check('count 含总数', count().indexOf(String(data.companies.length)) !== -1, count());

  section('数字滚动');
  check('注册了 requestAnimationFrame 帧', frames.length > 0);
  drainFrames(40);
  check('数字滚动到终值', statNodes[0].textContent === String(data.companies.length),
        statNodes[0].textContent);

  section('环形图');
  const donutHtml = els.donut.innerHTML || '';
  const statusesPresent = new Set(data.companies.map((c) => c.status));
  check('渲染出 SVG', donutHtml.indexOf('<svg') !== -1);
  check('扇区数 = 出现的状态数(' + statusesPresent.size + ')',
        (donutHtml.match(/class="seg tone-/g) || []).length === statusesPresent.size,
        '实际 ' + (donutHtml.match(/class="seg tone-/g) || []).length);
  check('中心显示总数', new RegExp('>' + data.companies.length + '<').test(donutHtml));
  check('每个扇区可点（data-status）', donutHtml.indexOf('data-status="double"') !== -1);
  check('扇区有 title 提示', donutHtml.indexOf('<title>') !== -1);
  check('图例条目数 = 状态数', (els['donut-legend'].innerHTML.match(/class="lg"/g) || []).length === statusesPresent.size);

  section('词云');
  const cloudHtml = els.cloud.innerHTML || '';
  check('词条数 = 公司数(' + data.companies.length + ')',
        wordsIn(cloudHtml) === data.companies.length, '实际 ' + wordsIn(cloudHtml));
  check('含内联 font-size', cloudHtml.indexOf('font-size:') !== -1);
  check('含颜色类 wt-*', /wt-(green|amber|blue|purple|gray|teal|slate)/.test(cloudHtml));
  check('含证据透明度类 wev-*', /wev-[ABC]/.test(cloudHtml));
  check('含 data-name 与 title', cloudHtml.indexOf('data-name="快手"') !== -1 && cloudHtml.indexOf('title="快手') !== -1);
  const sizes = [...cloudHtml.matchAll(/font-size:([\d.]+)px/g)].map((m) => Number(m[1]));
  check('字号有区分度（min<' + Math.max(...sizes) + '）',
        Math.min(...sizes) < Math.max(...sizes), 'min=' + Math.min(...sizes) + ' max=' + Math.max(...sizes));
  const uniqSizes = new Set(sizes).size;
  check('字号至少 3 档（实际 ' + uniqSizes + '）', uniqSizes >= 3);
  check('每家公司都在词云里',
        data.companies.every((c) => cloudHtml.indexOf('data-name="' + c.name + '"') !== -1));
  check('初始无 dim（未筛选）', cloudHtml.indexOf(' dim"') === -1);

  section('热力矩阵');
  const mxHtml = els.matrix.innerHTML || '';
  check('矩阵渲染出 --cols 变量', /--cols:\d+/.test(mxHtml));
  check('行数 = 产业数 + 表头',
        (mxHtml.match(/class="mx-row/g) || []).length === data.industries.length + 1,
        '实际 ' + (mxHtml.match(/class="mx-row/g) || []).length);
  check('格子数 = 产业数 × 状态数', (mxHtml.match(/class="mx-cell/g) || []).length >= data.industries.length * statusesPresent.size);
  check('零值格为 disabled', mxHtml.indexOf('disabled') !== -1);
  check('产业名可点（data-query）', mxHtml.indexOf('data-query="你开的车"') !== -1);

  section('交互：筛选');
  check('chips 绑定了 click 委托', typeof els.chips._handlers.click === 'function');
  click(els.chips, { 'data-status': 'double' });
  const nDouble = data.companies.filter((c) => c.status === 'double').length;
  check('点「双休」后只剩 ' + nDouble + ' 家', count().indexOf('显示 ' + nDouble + ' /') === 0, count());
  check('筛选后词云有 dim 高亮', (els.cloud.innerHTML || '').indexOf(' dim"') !== -1);
  check('筛选后矩阵仍在', (els.matrix.innerHTML || '').indexOf('mx-cell') !== -1);

  click(els.chips, { 'data-status': '*' });
  check('点「全部」恢复 ' + data.companies.length + ' 家', count().indexOf('显示 ' + data.companies.length + ' /') === 0, count());

  click(els.donut, { 'data-status': 'shift' });
  const nShift = data.companies.filter((c) => c.status === 'shift').length;
  check('点环形图扇区筛选排班制 = ' + nShift, count().indexOf('显示 ' + nShift + ' /') === 0, count());

  click(els.matrix, { 'data-status': 'jd' });
  const nJd = data.companies.filter((c) => c.status === 'jd').length;
  check('点矩阵格子筛选岗位级 = ' + nJd, count().indexOf('显示 ' + nJd + ' /') === 0, count());

  click(els['donut-legend'], { 'data-status': 'partial' });
  const nPartial = data.companies.filter((c) => c.status === 'partial').length;
  check('点图例筛选部分双休 = ' + nPartial, count().indexOf('显示 ' + nPartial + ' /') === 0, count());

  section('交互：词云点词 / 矩阵点产业');
  click(els.chips, { 'data-status': '*' });
  click(els.cloud, { 'data-name': '快手' });
  check('点词云词后搜索框被填充', els.q.value === '快手', els.q.value);
  check('点词云词后只显示该公司（精确锁定）', count().indexOf('显示 1 /') === 0, count());
  check('count 标明「只看」', count().indexOf('只看：快手') !== -1, count());
  check('目标行带 flash 动画类', (els.list.innerHTML || '').indexOf('class="row flash"') !== -1);

  els.q.value = '快手';
  els.q._handlers.input();
  const fuzzyN = Number((/显示 (\d+) \//.exec(count()) || [0, 0])[1]);
  check('手输「快手」回到全文模糊搜索（命中 ≥1 家）', fuzzyN >= 1, count());

  els.q.value = '';
  click(els.matrix, { 'data-query': '你开的车' });
  const nCar = data.companies.filter((c) => c.industryLabel === '你开的车').length;
  check('点矩阵产业名筛选到 ' + nCar + ' 家', count().indexOf('显示 ' + nCar + ' /') === 0, count());

  section('交互：搜索与排序');
  els.q.value = '';
  els.q._handlers.input();
  check('清空搜索恢复全部', count().indexOf('显示 ' + data.companies.length + ' /') === 0, count());

  els.q.value = '奶茶';
  els.q._handlers.input();
  const filtered = els.list.innerHTML || '';
  check('搜「奶茶」命中古茗', filtered.indexOf('古茗') !== -1);
  const m = /显示 (\d+) \/ (\d+) 家/.exec(count());
  check('搜「奶茶」可见数 < 总数', !!m && Number(m[1]) < Number(m[2]) && Number(m[1]) > 0, count());

  els.q.value = '不可能存在的词XYZ';
  els.q._handlers.input();
  check('无结果显示空状态', els.empty.hidden === false);
  els.q.value = '';
  els.q._handlers.input();
  check('恢复后空状态隐藏', els.empty.hidden === true);

  check('排序控件绑定了 change', typeof els.sort._handlers.change === 'function');
  ['score', 'status', 'name', 'asof'].forEach(function (mode) {
    els.sort.value = mode;
    els.sort._handlers.change();
    check('排序 ' + mode + ' 后行数仍为 ' + data.companies.length,
          rowsIn(els.list.innerHTML) === data.companies.length);
  });
  els.sort.value = 'name';
  els.sort._handlers.change();
  const firstRow = /class="row[^"]*" data-name="([^"]+)"/.exec(els.list.innerHTML);
  check('按名称排序时首行有 data-name', !!firstRow, els.list.innerHTML.slice(0, 80));

  section('交互：词云排序');
  check('词云排序按钮已同步 aria-pressed',
        csort.filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1);
  check('点了产业排序', click(els['cloud-sort'], { 'data-csort': 'industry' }));
  check('排序后词云仍是 ' + data.companies.length + ' 条', wordsIn(els.cloud.innerHTML) === data.companies.length);
  click(els['cloud-sort'], { 'data-csort': 'shuffle' });
  check('洗牌后词云仍是 ' + data.companies.length + ' 条', wordsIn(els.cloud.innerHTML) === data.companies.length);

  section('内容完整性');
  ['A', 'B', 'C'].forEach(function (lv) {
    const n = data.companies.filter((c) => c.evidence === lv).length;
    if (n > 0) check('证据等级 ' + lv + ' 徽章出现（' + n + ' 条）', listHtml.indexOf('>证据 ' + lv + '<') !== -1);
  });
  const withUrl = data.companies.filter((c) => c.url).length;
  const linkCount = (listHtml.match(/证据来源/g) || []).length;
  check('来源链接数 = ' + withUrl, linkCount === withUrl, '实际 ' + linkCount);
  check('HTML 无 undefined', listHtml.indexOf('undefined') === -1);
  check('HTML 无 NaN', listHtml.indexOf('NaN') === -1);

  section('渐进增强');
  check('已加 js-anim 类', doc.documentElement.classList.contains('js-anim'));

  section('CSS / HTML 契约');
  const need = [
    '.reveal', '.js-anim', '.viz-grid', '.card', '.donut', '.seg', '.donut-legend', '.lg',
    '.mini-chip', '.cloud', '.word', '.word.wt-green', '.word.wev-B', '.word.dim',
    '.matrix-scroll', '.mx', '.mx-row', '.mx-label', '.mx-cell', '.mx-cell.hot', '.mx-cell.zero',
    '.timeline', '.badge.tone-green', '.ev.A', '.row.flash', '.chip', '.hint', '.controls-row'
  ];
  const missingCss = need.filter(function (s) {
    const esc2 = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !(new RegExp(esc2 + '(?![\\w-])').test(css));
  });
  check('CSS 覆盖全部 ' + need.length + ' 个必需选择器', missingCss.length === 0, missingCss.join(', '));

  const ids = ['stats', 'donut', 'donut-legend', 'cloud', 'cloud-sort', 'matrix', 'chips', 'list', 'count', 'empty', 'q', 'sort', 'asof', 'viz'];
  const missingIds = ids.filter((id) => html.indexOf('id="' + id + '"') === -1);
  check('index.html 提供全部 ' + ids.length + ' 个容器 id', missingIds.length === 0, missingIds.join(', '));

  console.log('');
  if (failures.length) {
    console.log('FAILED: ' + failures.length + ' 项');
    console.log(failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('ALL PASS');
})();
