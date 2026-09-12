/* 中国 C 端双休企业清单 · 页面渲染
   数据来自 docs/data.json（由 tools/build-page.ps1 从 data/companies.csv 生成）。
   改数据请改 CSV 并重跑脚本，不要改这里。

   设计约束：
   - 纯原生 JS + SVG + CSS，不依赖任何外部库（GitHub Pages 上零构建）。
   - 所有列表用 innerHTML 字符串渲染 + 事件委托，避免 51×N 个监听器。
   - 动画一律「渐进增强」：JS 不可用 / prefers-reduced-motion / 无 rAF 时，静态内容照常可读。
*/

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

/* 可信度评分：状态权重 + 证据权重（透明规则，见页脚说明） */
var STATUS_W = { double: 5, partial: 4, jd: 3, hybrid: 3, four5: 3, shift: 2, unknown: 1 };
var EV_W = { A: 3, B: 2, C: 1 };
var SCORE_MIN = 2, SCORE_MAX = 8;

var state = {
  active: null,
  query: '',
  sort: 'score',
  cloudSort: 'score',
  highlight: null,
  pin: null        // 点词云时锁定到某一家：此时只显示该公司，不受全文搜索误命中影响
};

var DATA = null;
var els = {};

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function meta(c) { return STATUS_META[c.status] || { label: c.statusLabel || '不明', tone: 'gray' }; }
function statusLabel(c) { return meta(c).label; }
function tone(c) { return meta(c).tone; }

function rank(c) {
  var i = STATUS_ORDER.indexOf(c.status);
  return i === -1 ? STATUS_ORDER.length : i;
}

function score(c) {
  var s = STATUS_W[c.status] === undefined ? 1 : STATUS_W[c.status];
  var e = EV_W[c.evidence] === undefined ? 1 : EV_W[c.evidence];
  return s + e;
}

function wordSize(c) {
  var ratio = (score(c) - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
  return Math.round((13.5 + ratio * 21) * 10) / 10;   // 13.5px ~ 34.5px
}

function reduceMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}

/* ---------- 过滤与排序 ---------- */

function matched(c) {
  if (state.pin) return c.name === state.pin;   // 锁定单家公司时，精确匹配，避免全文误命中
  if (state.active && c.status !== state.active) return false;
  if (!state.query) return true;
  var q = state.query.toLowerCase();
  return [c.name, c.product, c.category, c.detail, statusLabel(c), c.industryLabel]
    .join(' ').toLowerCase().indexOf(q) !== -1;
}

function visibleCompanies() { return DATA.companies.filter(matched); }

function sortItems(list, mode) {
  var out = list.slice();
  out.sort(function (a, b) {
    if (mode === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
    if (mode === 'status') {
      var d = rank(a) - rank(b);
      return d !== 0 ? d : (score(b) - score(a)) || a.name.localeCompare(b.name, 'zh-Hans-CN');
    }
    if (mode === 'asof') {
      var s = String(b.asOf || '').localeCompare(String(a.asOf || ''));
      return s !== 0 ? s : a.name.localeCompare(b.name, 'zh-Hans-CN');
    }
    return (score(b) - score(a)) || (rank(a) - rank(b)) || a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  return out;
}

/* ---------- 统计条 ---------- */

function renderStats() {
  var all = DATA.companies;
  var html = '<span class="stat"><b data-count="' + all.length + '">' + all.length + '</b> 家已收录企业</span>';
  STATUS_ORDER.forEach(function (key) {
    var n = all.filter(function (c) { return c.status === key; }).length;
    if (!n) return;
    html += '<span class="stat"><span class="dot tone-' + STATUS_META[key].tone + '"></span>' +
            esc(STATUS_META[key].label) + ' <b data-count="' + n + '">' + n + '</b></span>';
  });
  els.stats.innerHTML = html;
  countUpAll(els.stats);
}

function countUpAll(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  if (reduceMotion() || typeof requestAnimationFrame !== 'function') return;
  var nodes = root.querySelectorAll('[data-count]');
  Array.prototype.forEach.call(nodes, function (el) {
    var target = Number(el.getAttribute('data-count'));
    if (!isFinite(target) || target <= 0) return;
    var start = null;
    var dur = 700;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = String(target);
    }
    el.textContent = '0';
    requestAnimationFrame(step);
  });
}

/* ---------- 环形图 ---------- */

function renderDonut() {
  var all = DATA.companies;
  var rows = STATUS_ORDER
    .map(function (key) {
      return { key: key, meta: STATUS_META[key], n: all.filter(function (c) { return c.status === key; }).length };
    })
    .filter(function (r) { return r.n > 0; });

  var total = all.length;
  var R = 78, SW = 26, C = 2 * Math.PI * R, cx = 110, cy = 110;
  var offset = 0;
  var segs = '';

  rows.forEach(function (r) {
    var frac = r.n / total;
    var len = frac * C;
    var gap = Math.max(C - len, 0);
    segs += '<circle class="seg tone-' + r.meta.tone + '" data-status="' + r.key + '"' +
            ' cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke-width="' + SW + '"' +
            ' stroke-dasharray="' + len.toFixed(2) + ' ' + gap.toFixed(2) + '"' +
            ' stroke-dashoffset="' + (-offset).toFixed(2) + '">' +
            '<title>' + esc(r.meta.label) + '：' + r.n + ' 家（' + (frac * 100).toFixed(1) + '%）</title>' +
            '</circle>';
    offset += len;
  });

  els.donut.innerHTML =
    '<svg viewBox="0 0 220 220" role="img" aria-label="状态分布环形图">' +
      '<g transform="rotate(-90 110 110)">' +
        '<circle cx="110" cy="110" r="78" fill="none" stroke-width="26" class="seg-bg"></circle>' +
        segs +
      '</g>' +
      '<text class="donut-num" x="110" y="106" text-anchor="middle">' + total + '</text>' +
      '<text class="donut-cap" x="110" y="128" text-anchor="middle">家企业</text>' +
    '</svg>';

  els.donutLegend.innerHTML = rows.map(function (r) {
    return '<li><button type="button" class="lg" data-status="' + r.key + '">' +
      '<span class="dot tone-' + r.meta.tone + '"></span>' +
      '<span class="lg-label">' + esc(r.meta.label) + '</span>' +
      '<span class="lg-n">' + r.n + '</span>' +
      '<span class="lg-p">' + (r.n / total * 100).toFixed(0) + '%</span>' +
      '</button></li>';
  }).join('');
}

/* ---------- 词云 ---------- */

function cloudItems() {
  var list = DATA.companies.slice();
  if (state.cloudSort === 'industry') {
    var order = {};
    DATA.industries.forEach(function (ind, i) { order[ind.key] = i; });
    list.sort(function (a, b) {
      var d = (order[a.industry] || 0) - (order[b.industry] || 0);
      return d !== 0 ? d : (score(b) - score(a)) || a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  } else if (state.cloudSort === 'shuffle') {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
  } else {
    list.sort(function (a, b) {
      return (score(b) - score(a)) || a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }
  return list;
}

function renderCloud() {
  var list = cloudItems();
  els.cloud.innerHTML = list.map(function (c) {
    var m = meta(c);
    var tip = c.name + ' · ' + m.label + ' · 证据 ' + c.evidence +
              (c.asOf ? ' · ' + c.asOf : '') + ' · ' + c.category;
    var dim = !matched(c) ? ' dim' : '';
    return '<button type="button" class="word wt-' + m.tone + ' wev-' + esc(c.evidence) + dim + '"' +
           ' data-name="' + esc(c.name) + '" title="' + esc(tip) + '"' +
           ' style="font-size:' + wordSize(c) + 'px">' + esc(c.name) + '</button>';
  }).join('');
}

function renderCloudSortChips() {
  var box = $('cloud-sort');
  if (!box || typeof box.querySelectorAll !== 'function') return;
  Array.prototype.forEach.call(box.querySelectorAll('[data-csort]'), function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-csort') === state.cloudSort));
  });
}

/* ---------- 产业 × 状态 热力矩阵 ---------- */

function renderMatrix() {
  var cols = STATUS_ORDER.filter(function (k) {
    return DATA.companies.some(function (c) { return c.status === k; });
  });

  var head = '<div class="mx-row mx-head"><div class="mx-label">产业 \\ 状态</div>' +
    cols.map(function (k) {
      return '<button type="button" class="mx-cell mx-col" data-status="' + k + '">' +
             esc(STATUS_META[k].label) + '</button>';
    }).join('') + '</div>';

  var body = DATA.industries.map(function (ind) {
    var cells = cols.map(function (k) {
      var n = DATA.companies.filter(function (c) {
        return c.industry === ind.key && c.status === k;
      }).length;
      var hot = n >= 3 ? ' hot' : (n > 0 ? ' warm' : ' zero');
      return '<button type="button" class="mx-cell tone-' + STATUS_META[k].tone + hot + '"' +
             ' data-status="' + k + '"' + (n ? '' : ' disabled') + '>' + (n || '·') + '</button>';
    }).join('');
    return '<div class="mx-row"><button type="button" class="mx-label" data-query="' +
           esc(ind.label) + '">' + esc(ind.label) + '</button>' + cells + '</div>';
  }).join('');

  els.matrix.innerHTML = '<div class="mx" style="--cols:' + cols.length + '">' + head + body + '</div>';
}

/* ---------- 筛选按钮 ---------- */

function renderChips() {
  var all = DATA.companies;
  var html = '<button class="chip" type="button" data-status="*" aria-pressed="' +
             (state.active === null ? 'true' : 'false') + '">全部 ' + all.length + '</button>';
  STATUS_ORDER.forEach(function (key) {
    var n = all.filter(function (c) { return c.status === key; }).length;
    if (!n) return;
    html += '<button class="chip" type="button" data-status="' + key + '" aria-pressed="' +
            (state.active === key ? 'true' : 'false') + '">' +
            esc(STATUS_META[key].label) + ' ' + n + '</button>';
  });
  els.chips.innerHTML = html;
}

/* ---------- 卡片清单 ---------- */

function rowHtml(c) {
  var m = meta(c);
  var cls = 'row' + (c.name === state.highlight ? ' flash' : '');
  var foot = ['<span class="ev ' + esc(c.evidence) + '">证据 ' + esc(c.evidence) + '</span>'];
  if (c.asOf) foot.push('<span>时间点：' + esc(c.asOf) + '</span>');
  if (c.url) foot.push('<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">证据来源 ↗</a>');

  return '<div class="' + cls + '" data-name="' + esc(c.name) + '">' +
    '<div class="brand">' +
      '<strong>' + esc(c.name) + '</strong>' +
      '<span class="badge tone-' + m.tone + '">' + esc(m.label) + '</span>' +
      '<p class="cat">' + esc(c.category) + '</p>' +
      '<p class="product">' + esc(c.product) + '</p>' +
    '</div>' +
    '<div>' +
      '<p class="detail">' + esc(c.detail) + '</p>' +
      '<p class="foot">' + foot.join('') + '</p>' +
    '</div>' +
  '</div>';
}

function countText(shown) {
  var t = '显示 ' + shown + ' / ' + DATA.companies.length + ' 家';
  if (state.pin) return t + '（只看：' + state.pin + '）';
  if (state.active) return t + '（筛选：' + STATUS_META[state.active].label + '）';
  return t;
}

function renderList() {
  var visible = visibleCompanies();
  var html = '';

  DATA.industries.forEach(function (ind) {
    var items = sortItems(visible.filter(function (c) { return c.industry === ind.key; }), state.sort);
    if (!items.length) return;
    html += '<section class="industry" id="ind-' + esc(ind.key) + '">';
    html += '<header><span class="n">' + items.length + ' 家</span>' +
            '<h2>' + esc(ind.label) + '</h2>' +
            '<p class="desc">' + esc(ind.desc) + '</p></header>';
    html += '<div class="rows">' + items.map(rowHtml).join('') + '</div>';
    html += '</section>';
  });

  els.list.innerHTML = html;
  els.empty.hidden = visible.length !== 0;
  els.count.textContent = countText(visible.length);
}

/* ---------- 统一重绘 ---------- */

function renderAll() {
  renderChips();
  renderList();
  renderCloud();
  renderMatrix();
}

/* ---------- 交互 ---------- */

function findAttr(node, attr) {
  var n = node;
  var guard = 0;
  while (n && n.getAttribute && guard++ < 12) {
    var v = n.getAttribute(attr);
    if (v !== null && v !== undefined && v !== '') return v;
    n = n.parentNode;
  }
  return null;
}

function setStatus(key) {
  state.active = (!key || key === '*') ? null : key;
  state.highlight = null;
  state.pin = null;
  renderAll();
}

function scrollToList() {
  var l = els.vizAnchor || els.list;
  if (l && typeof l.scrollIntoView === 'function' && !reduceMotion()) {
    try { l.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 忽略 */ }
  }
}

function onDelegatedClick(parent, handler) {
  if (!parent || typeof parent.addEventListener !== 'function') return;
  parent.addEventListener('click', function (e) {
    handler(e.target, e);
  });
}

function bind() {
  onDelegatedClick(els.chips, function (target) {
    var v = findAttr(target, 'data-status');
    if (v === null) return;
    setStatus(v);
  });

  onDelegatedClick(els.donut, function (target) {
    var v = findAttr(target, 'data-status');
    if (v === null) return;
    setStatus(v);
    scrollToList();
  });

  onDelegatedClick(els.donutLegend, function (target) {
    var v = findAttr(target, 'data-status');
    if (v === null) return;
    setStatus(v);
    scrollToList();
  });

  onDelegatedClick(els.matrix, function (target) {
    var q = findAttr(target, 'data-query');
    if (q !== null) {
      if (els.q) els.q.value = q;
      state.query = q;
      state.highlight = null;
      state.pin = null;
      renderAll();
      scrollToList();
      return;
    }
    var v = findAttr(target, 'data-status');
    if (v === null) return;
    setStatus(v);
    scrollToList();
  });

  onDelegatedClick(els.cloud, function (target) {
    var name = findAttr(target, 'data-name');
    if (name === null) return;
    if (els.q) els.q.value = name;
    state.query = name;
    state.active = null;
    state.pin = name;          // 只显示这一家，避免其他公司详情里提到同名品牌造成误命中
    state.highlight = name;
    renderAll();
    scrollToList();
  });

  var cs = $('cloud-sort');
  onDelegatedClick(cs, function (target) {
    var v = findAttr(target, 'data-csort');
    if (v === null) return;
    state.cloudSort = v;
    renderCloudSortChips();
    renderCloud();
  });

  if (els.q && typeof els.q.addEventListener === 'function') {
    els.q.addEventListener('input', function () {
      state.query = (els.q.value || '').trim();
      state.highlight = null;
      state.pin = null;        // 用户手输 = 回到全文模糊搜索
      renderList();
      renderCloud();
    });
  }

  if (els.sortEl && typeof els.sortEl.addEventListener === 'function') {
    els.sortEl.addEventListener('change', function () {
      state.sort = els.sortEl.value || 'score';
      renderList();
    });
  }

  if (els.cloud && typeof els.cloud.addEventListener === 'function') {
    els.cloud.addEventListener('mouseover', function () { /* 预留：悬停高亮 */ });
  }
}

/* ---------- 入场动画（渐进增强） ---------- */

function setupReveal() {
  var root = document.documentElement;
  if (!root || !root.classList) return;
  if (reduceMotion()) return;
  root.classList.add('js-anim');
  var nodes = document.querySelectorAll ? document.querySelectorAll('.reveal') : [];
  if (!nodes || !nodes.length) return;

  if (typeof IntersectionObserver !== 'function') {
    Array.prototype.forEach.call(nodes, function (n) { n.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
}

/* ---------- 启动 ---------- */

function boot() {
  els = {
    stats: $('stats'),
    donut: $('donut'),
    donutLegend: $('donut-legend'),
    cloud: $('cloud'),
    cloudSort: $('cloud-sort'),
    matrix: $('matrix'),
    chips: $('chips'),
    list: $('list'),
    count: $('count'),
    empty: $('empty'),
    q: $('q'),
    sortEl: $('sort'),
    asof: $('asof'),
    vizAnchor: $('viz')
  };
  if (!els.stats || !els.list) return;

  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      DATA = data;
      if (els.asof) els.asof.textContent = data.generatedAt || '—';
      renderStats();
      renderDonut();
      renderCloudSortChips();
      renderAll();
      bind();
      setupReveal();
    })
    .catch(function (err) {
      if (els.count) {
        els.count.textContent =
          '数据加载失败（' + err.message + '）。若你是本地直接打开 HTML，请用本地服务器访问。';
      }
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
