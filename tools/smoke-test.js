/* 渲染冒烟测试：在 Node 里用最小 DOM 桩跑一遍 docs/app.js，验证页面渲染逻辑不报错、
   并且每条数据都真的被渲染出来。

   用法：node tools/smoke-test.js
   退出码非 0 表示失败（可直接用于 CI）。 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataPath = path.join(root, 'docs', 'data.json');
const appPath = path.join(root, 'docs', 'app.js');

const failures = [];
function check(name, cond, extra) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures.push(name);
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''));
  }
}

// ---- 最小 DOM 桩 ----
function makeEl(tag) {
  return {
    tag: tag || 'div',
    innerHTML: '',
    textContent: '',
    hidden: false,
    value: '',
    _handlers: {},
    addEventListener(type, fn) { this._handlers[type] = fn; },
    querySelectorAll() { return []; },
    getAttribute() { return null; }
  };
}

const els = {};
const doc = {
  readyState: 'complete',
  getElementById(id) { if (!els[id]) els[id] = makeEl(); return els[id]; },
  addEventListener() {}
};

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
global.document = doc;
global.fetch = function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
};

const code = fs.readFileSync(appPath, 'utf8');

(async function main() {
  console.log('data.json: industries=' + data.industries.length + ' companies=' + data.companies.length);

  // 间接 eval：让 app.js 的顶层函数挂到全局
  (0, eval)(code);

  // 等 boot() 里的 fetch promise 链跑完
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

  const statsHtml = els.stats.innerHTML || '';
  const chipsHtml = els.chips.innerHTML || '';
  const listHtml = els.list.innerHTML || '';
  const countText = els.count.textContent || '';

  console.log('\n[渲染结果]');
  check('stats 渲染出总数', /已收录企业/.test(statsHtml), statsHtml.slice(0, 80));
  check('chips 渲染出「全部」', /全部/.test(chipsHtml));
  check('生成「双休」筛选项', /双休/.test(chipsHtml));
  check('count 文本含全部公司数', countText.indexOf(String(data.companies.length)) !== -1, countText);
  check('asof 已填充日期', els.asof.textContent === data.generatedAt, els.asof.textContent);

  const blocks = (listHtml.match(/class="industry"/g) || []).length;
  check('产业区块数 = ' + data.industries.length, blocks === data.industries.length, '实际 ' + blocks);

  const rows = (listHtml.match(/class="row"/g) || []).length;
  check('公司行数 = ' + data.companies.length, rows === data.companies.length, '实际 ' + rows);

  console.log('\n[逐条覆盖]');
  const missing = data.companies.filter((c) => listHtml.indexOf(c.name) === -1);
  check('每家公司都出现在 HTML 里', missing.length === 0,
        missing.map((m) => m.name).join(', '));

  const noBadge = data.companies.filter((c) => !c.statusLabel || !c.tone);
  check('每条都有状态标签与配色', noBadge.length === 0,
        noBadge.map((m) => m.name).join(', '));

  check('HTML 里没有 undefined', listHtml.indexOf('undefined') === -1);
  check('HTML 里没有 NaN', listHtml.indexOf('NaN') === -1);

  // 证据等级徽章
  ['A', 'B', 'C'].forEach(function (lv) {
    const n = data.companies.filter((c) => c.evidence === lv).length;
    if (n > 0) {
      check('证据等级 ' + lv + ' 徽章出现（' + n + ' 条）',
            listHtml.indexOf('>证据 ' + lv + '<') !== -1);
    }
  });

  // 来源链接
  const withUrl = data.companies.filter((c) => c.url).length;
  check('来源链接数 = ' + withUrl,
        (listHtml.match(/证据来源/g) || []).length === withUrl,
        '实际 ' + (listHtml.match(/证据来源/g) || []).length);

  console.log('\n[搜索过滤]');
  const qEl = els.q;
  check('搜索框注册了 input 处理', typeof qEl._handlers.input === 'function');
  if (typeof qEl._handlers.input === 'function') {
    qEl.value = '奶茶';
    qEl._handlers.input();
    const filtered = els.list.innerHTML || '';
    const cnt = els.count.textContent || '';
    const m = /显示 (\d+) \/ (\d+) 家/.exec(cnt);
    check('搜「奶茶」命中古茗', filtered.indexOf('古茗') !== -1);
    check('搜「奶茶」后可见数 < 总数',
          !!m && Number(m[1]) < Number(m[2]) && Number(m[1]) > 0, cnt);
    check('搜「奶茶」后无 "undefined"', filtered.indexOf('undefined') === -1);

    qEl.value = '这个词不可能存在XYZ';
    qEl._handlers.input();
    check('无结果时显示空状态', els.empty.hidden === false);
    check('无结果显示 0 家', (els.count.textContent || '').indexOf('0') !== -1, els.count.textContent);

    qEl.value = '';
    qEl._handlers.input();
    check('清空搜索后恢复全部', (els.count.textContent || '').indexOf(String(data.companies.length)) !== -1);
  }

  console.log('');
  if (failures.length) {
    console.log('FAILED: ' + failures.length + ' 项');
    console.log(failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('ALL PASS');
})();
