/* 中国 C 端双休企业清单 · 页面渲染
   数据来自 docs/data.json（由 tools/build-page.ps1 从 data/companies.csv 生成）。
   改数据请改 CSV 并重跑脚本，不要改这里。 */

'use strict';

var STATUS_ORDER = ['double', 'partial', 'jd', 'shift', 'hybrid', 'four5', 'unknown'];

var STATUS_META = {
  double:  { label: '双休',         tone: 'green'  },
  partial: { label: '部分双休',     tone: 'amber'  },
  jd:      { label: '岗位级双休',   tone: 'blue'   },
  hybrid:  { label: '混合办公',     tone: 'slate'  },
  four5:   { label: '四天半工作制', tone: 'teal'   },
  shift:   { label: '排班制',       tone: 'purple' },
  unknown: { label: '不明',         tone: 'gray'   }
};

var state = {
  active: null,   // null = 全部
  query: ''
};

var DATA = null;

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusLabel(c) {
  var m = STATUS_META[c.status];
  return (m ? m.label : c.statusLabel) || '不明';
}

function tone(c) {
  var m = STATUS_META[c.status];
  return m ? m.tone : 'gray';
}

function rank(c) {
  var i = STATUS_ORDER.indexOf(c.status);
  return i === -1 ? STATUS_ORDER.length : i;
}

function matched(c) {
  if (state.active && c.status !== state.active) return false;
  if (!state.query) return true;
  var q = state.query.toLowerCase();
  var hay = [c.name, c.product, c.category, c.detail, statusLabel(c), c.industryLabel]
    .join(' ').toLowerCase();
  return hay.indexOf(q) !== -1;
}

function renderStats() {
  var all = DATA.companies;
  var html = '<span class="stat"><b>' + all.length + '</b> 家已收录企业</span>';
  STATUS_ORDER.forEach(function (key) {
    var n = all.filter(function (c) { return c.status === key; }).length;
    if (!n) return;
    var m = STATUS_META[key];
    html += '<span class="stat"><span class="dot tone-' + m.tone + '"></span>' +
            esc(m.label) + ' <b>' + n + '</b></span>';
  });
  document.getElementById('stats').innerHTML = html;
}

function renderChips() {
  var all = DATA.companies;
  var html = '';
  html += '<button class="chip" type="button" data-status="" aria-pressed="' +
          (state.active === null ? 'true' : 'false') + '">全部 ' + all.length + '</button>';
  STATUS_ORDER.forEach(function (key) {
    var n = all.filter(function (c) { return c.status === key; }).length;
    if (!n) return;
    html += '<button class="chip" type="button" data-status="' + key + '" aria-pressed="' +
            (state.active === key ? 'true' : 'false') + '">' +
            esc(STATUS_META[key].label) + ' ' + n + '</button>';
  });
  var chips = document.getElementById('chips');
  chips.innerHTML = html;
  Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (btn) {
    btn.addEventListener('click', function () {
      var v = btn.getAttribute('data-status');
      state.active = v ? v : null;
      renderChips();
      renderList();
    });
  });
}

function rowHtml(c) {
  var t = tone(c);
  var foot = [];
  foot.push('<span class="ev ' + esc(c.evidence) + '">证据 ' + esc(c.evidence) + '</span>');
  if (c.asOf) foot.push('<span>时间点：' + esc(c.asOf) + '</span>');
  if (c.url) foot.push('<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">证据来源 ↗</a>');

  return '<div class="row">' +
    '<div class="brand">' +
      '<strong>' + esc(c.name) + '</strong>' +
      '<span class="badge tone-' + t + '">' + esc(statusLabel(c)) + '</span>' +
      '<p class="cat">' + esc(c.category) + '</p>' +
      '<p class="product">' + esc(c.product) + '</p>' +
    '</div>' +
    '<div>' +
      '<p class="detail">' + esc(c.detail) + '</p>' +
      '<p class="foot">' + foot.join('') + '</p>' +
    '</div>' +
  '</div>';
}

function renderList() {
  var visible = DATA.companies.filter(matched);
  var html = '';

  DATA.industries.forEach(function (ind) {
    var items = visible.filter(function (c) { return c.industry === ind.key; });
    if (!items.length) return;
    items.sort(function (a, b) {
      var d = rank(a) - rank(b);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    html += '<section class="industry">';
    html += '<header><span class="n">' + items.length + ' 家</span>' +
            '<h2>' + esc(ind.label) + '</h2>' +
            '<p class="desc">' + esc(ind.desc) + '</p></header>';
    html += '<div class="rows">' + items.map(rowHtml).join('') + '</div>';
    html += '</section>';
  });

  document.getElementById('list').innerHTML = html;
  document.getElementById('empty').hidden = visible.length !== 0;
  document.getElementById('count').textContent =
    '显示 ' + visible.length + ' / ' + DATA.companies.length + ' 家' +
    (state.active ? '（筛选：' + STATUS_META[state.active].label + '）' : '');
}

function boot() {
  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      DATA = data;
      document.getElementById('asof').textContent = data.generatedAt || '—';
      renderStats();
      renderChips();
      renderList();

      var q = document.getElementById('q');
      q.addEventListener('input', function () {
        state.query = q.value.trim();
        renderList();
      });
    })
    .catch(function (err) {
      document.getElementById('count').textContent =
        '数据加载失败（' + err.message + '）。若你是本地直接打开 HTML，请用本地服务器访问。';
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
