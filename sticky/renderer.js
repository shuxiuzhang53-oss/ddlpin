// 便签渲染层:拉取任务、实时倒计时、完成/贪睡、添加、迷你形态、SSE 实时刷新。
const PORT = window.__PORT__ || 4747;
const BASE = `http://127.0.0.1:${PORT}`;
const $ = (s) => document.querySelector(s);
let tasks = [];

function colorFor(t, now) {
  if (t.due_at == null) return 'var(--gray)';
  const m = (t.due_at - now) / 60000;
  if (m < 0) return 'var(--red)';
  if (m < 60) return 'var(--orange)';
  if (m < 24 * 60) return 'var(--amber)';
  return 'var(--green)';
}
function countdown(due, now) {
  if (due == null) return '无截止';
  let ms = due - now; const od = ms < 0; ms = Math.abs(ms);
  const m = Math.round(ms / 60000);
  let s;
  if (m < 60) s = m + '分';
  else if (m < 1440) s = Math.floor(m / 60) + '时' + (m % 60 ? (m % 60) + '分' : '');
  else s = Math.floor(m / 1440) + '天' + (Math.floor(m / 60) % 24 ? (Math.floor(m / 60) % 24) + '时' : '');
  return (od ? '逾期 ' : '') + s;
}

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.ok ? r.json() : null;
}

async function refresh() {
  try { tasks = await api('GET', '/tasks?filter=open') || []; }
  catch { tasks = null; }
  render();
}

function render() {
  const now = Date.now();
  $('#count').textContent = tasks ? `${tasks.length}` : '离线';
  const list = $('#list');
  if (tasks === null) { list.innerHTML = `<div class="empty">连不上 daemon<br><small>确认 taskd 在运行</small></div>`; return; }
  if (!tasks.length) { list.innerHTML = `<div class="empty">清空啦 🎉</div>`; }
  else {
    list.innerHTML = tasks.map((t) => {
      const od = t.due_at != null && t.due_at < now;
      return `<div class="item ${od ? 'od' : ''}" data-id="${t.id}" data-due="${t.due_at ?? ''}">
        <span class="bar" style="background:${colorFor(t, now)}"></span>
        <div class="body">
          <div class="t">${esc(t.title)}</div>
          <div class="meta">
            <span class="cd ${od ? 'overdue' : ''}">${countdown(t.due_at, now)}</span>
            ${t.project ? `<span class="proj">@${esc(t.project)}</span>` : ''}
          </div>
        </div>
        <div class="acts">
          <button data-act="done" title="完成">✓</button>
          <button data-act="snooze" title="贪睡1小时">💤</button>
        </div>
      </div>`;
    }).join('');
  }
  renderPill(now);
  autoResize();
}

function renderPill(now) {
  const t = tasks && tasks[0];
  const pill = $('#pill');
  if (!t) { pill.querySelector('.pt').textContent = tasks ? '没有任务 🎉' : '离线';
    pill.querySelector('.dot').style.background = 'var(--gray)'; pill.querySelector('.pc').textContent = ''; return; }
  const od = t.due_at != null && t.due_at < now;
  pill.querySelector('.dot').style.background = colorFor(t, now);
  pill.querySelector('.pt').textContent = t.title;
  const pc = pill.querySelector('.pc'); pc.textContent = countdown(t.due_at, now); pc.classList.toggle('overdue', od);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 每秒只刷新倒计时文字(不重建 DOM),避免闪烁
function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll('#list .item').forEach((el) => {
    const due = el.dataset.due ? Number(el.dataset.due) : null;
    const cd = el.querySelector('.cd'); if (!cd) return;
    const od = due != null && due < now;
    cd.textContent = countdown(due, now);
    cd.classList.toggle('overdue', od); el.classList.toggle('od', od);
    el.querySelector('.bar').style.background = colorFor({ due_at: due }, now);
  });
  if (document.body.classList.contains('mini')) renderPill(now);
}

// 迷你/展开时把窗口高度贴合内容
function autoResize() {
  const mini = document.body.classList.contains('mini');
  const h = mini ? 46 : Math.min(560, 92 + (tasks?.length || 1) * 54);
  window.sticky?.resizeTo({ height: h });
}

// ---- 事件 ----
$('#list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const id = e.target.closest('.item').dataset.id;
  if (btn.dataset.act === 'done') await api('POST', `/tasks/${id}/complete`);
  else if (btn.dataset.act === 'snooze') await api('POST', `/tasks/${id}/snooze`, { minutes: 60 });
  refresh();
});
$('#inp').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const v = e.target.value.trim(); if (!v) return;
  e.target.value = '';
  await api('POST', '/tasks', { title: v, source: 'sticky' });
  refresh();
});
$('#btnAdd').addEventListener('click', () => { document.body.classList.remove('mini'); $('#inp').focus(); autoResize(); });
$('#btnMini').addEventListener('click', () => {
  document.body.classList.toggle('mini');
  localStorage.setItem('mini', document.body.classList.contains('mini') ? '1' : '0');
  autoResize();
});
$('#pill').addEventListener('click', () => { document.body.classList.remove('mini'); localStorage.setItem('mini', '0'); autoResize(); });
$('#btnQuit').addEventListener('click', () => window.sticky?.hide());

// SSE:daemon 有变更就刷新
function connectSSE() {
  try {
    const es = new EventSource(BASE + '/events');
    es.addEventListener('change', refresh);
    es.onerror = () => { es.close(); setTimeout(connectSSE, 3000); };
  } catch { setTimeout(connectSSE, 3000); }
}

if (localStorage.getItem('mini') === '1') document.body.classList.add('mini');
refresh();
connectSSE();
setInterval(tickCountdowns, 1000);
setInterval(refresh, 60000); // 兜底轮询
