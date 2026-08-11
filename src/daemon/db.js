// 数据层:node:sqlite(Node 内置,无需编译)。真相源 = tasks.db,附带 board.md 人类可读镜像。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { DB_PATH, BOARD_MD_PATH, ensureBaseDir } from '../shared/config.js';

let db;

export function openDb() {
  if (db) return db;
  ensureBaseDir();
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      due_at        INTEGER,               -- epoch ms,可空(someday)
      priority      TEXT NOT NULL DEFAULT 'normal', -- low|normal|high|urgent
      project       TEXT,
      status        TEXT NOT NULL DEFAULT 'open',    -- open|done|dropped
      notes         TEXT,
      estimate_min  INTEGER,               -- 预估工时(分钟),给“放不下”预警用
      source        TEXT,                  -- cc|codex|mirasim|manual|sticky
      snooze_until  INTEGER,
      last_nag_at   INTEGER,               -- 上次逾期催促时间
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      completed_at  INTEGER,
      rolled_date   TEXT                   -- 已做过“次日滚动询问”的日期,避免重复问
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id        TEXT PRIMARY KEY,
      task_id   TEXT NOT NULL,
      remind_at INTEGER NOT NULL,
      label     TEXT NOT NULL,
      fired     INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE INDEX IF NOT EXISTS idx_rem_due ON reminders(fired, remind_at);
    CREATE INDEX IF NOT EXISTS idx_task_status ON tasks(status, due_at);
  `);
  return db;
}

const genId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- 提醒阶梯:根据 due 自动生成提醒点 ----
export function computeReminderStages(dueAt, now = Date.now()) {
  if (!dueAt) return [];
  const H = 3600_000, D = 24 * H;
  const stages = [];
  const push = (at, label) => { if (at > now && at < dueAt) stages.push({ at, label }); };
  if (dueAt - now > D) {
    push(dueAt - D, '还有1天');
    // 截止当天早上 9 点
    const d = new Date(dueAt); d.setHours(9, 0, 0, 0);
    push(d.getTime(), '今天到期');
  }
  push(dueAt - H, '还有1小时');
  push(dueAt - 10 * 60_000, '还有10分钟');
  stages.push({ at: dueAt, label: '到点了' });           // 到点一定提醒
  return stages;
}

function writeReminders(taskId, dueAt) {
  db.prepare('DELETE FROM reminders WHERE task_id = ? AND fired = 0').run(taskId);
  for (const s of computeReminderStages(dueAt)) {
    db.prepare('INSERT INTO reminders (id, task_id, remind_at, label, fired) VALUES (?,?,?,?,0)')
      .run(genId('r'), taskId, s.at, s.label);
  }
}

// ---- CRUD ----
export function createTask(input) {
  openDb();
  const now = Date.now();
  const t = {
    id: genId('t'),
    title: String(input.title || '').trim(),
    due_at: input.due_at ?? null,
    priority: input.priority || 'normal',
    project: input.project || null,
    status: 'open',
    notes: input.notes || null,
    estimate_min: input.estimate_min ?? null,
    source: input.source || 'manual',
    snooze_until: null, last_nag_at: null,
    created_at: now, updated_at: now, completed_at: null, rolled_date: null,
  };
  if (!t.title) throw new Error('title 不能为空');
  db.prepare(`INSERT INTO tasks
    (id,title,due_at,priority,project,status,notes,estimate_min,source,snooze_until,last_nag_at,created_at,updated_at,completed_at,rolled_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t.id, t.title, t.due_at, t.priority, t.project, t.status, t.notes, t.estimate_min, t.source,
         t.snooze_until, t.last_nag_at, t.created_at, t.updated_at, t.completed_at, t.rolled_date);
  writeReminders(t.id, t.due_at);
  syncBoardMd();
  return getTask(t.id);
}

export function getTask(id) {
  openDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) || null;
}

export function updateTask(id, patch) {
  openDb();
  const cur = getTask(id);
  if (!cur) throw new Error('任务不存在: ' + id);
  const fields = ['title', 'due_at', 'priority', 'project', 'notes', 'estimate_min', 'status',
                  'snooze_until', 'last_nag_at', 'completed_at', 'rolled_date'];
  const set = [], vals = [];
  for (const f of fields) {
    if (f in patch) { set.push(`${f} = ?`); vals.push(patch[f]); }
  }
  set.push('updated_at = ?'); vals.push(Date.now());
  vals.push(id);
  db.prepare(`UPDATE tasks SET ${set.join(', ')} WHERE id = ?`).run(...vals);
  if ('due_at' in patch) writeReminders(id, patch.due_at);
  syncBoardMd();
  return getTask(id);
}

export function completeTask(id) {
  const t = updateTask(id, { status: 'done', completed_at: Date.now() });
  openDb();
  db.prepare('DELETE FROM reminders WHERE task_id = ? AND fired = 0').run(id);
  syncBoardMd();
  return t;
}

export function dropTask(id) {
  return updateTask(id, { status: 'dropped' });
}

export function snoozeTask(id, untilMs) {
  return updateTask(id, { snooze_until: untilMs, last_nag_at: null });
}

// resolveById: 支持传短前缀(便签/CLI 里方便)
export function resolveId(idOrPrefix) {
  openDb();
  const exact = getTask(idOrPrefix);
  if (exact) return exact.id;
  const rows = db.prepare("SELECT id FROM tasks WHERE id LIKE ? AND status='open'").all(idOrPrefix + '%');
  if (rows.length === 1) return rows[0].id;
  return null;
}

// ---- 查询 ----
export function listTasks({ filter = 'open', project } = {}) {
  openDb();
  const now = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  let sql = 'SELECT * FROM tasks WHERE 1=1', vals = [];
  if (filter === 'today') { sql += " AND status='open' AND due_at IS NOT NULL AND due_at <= ?"; vals.push(endOfToday.getTime()); }
  else if (filter === 'overdue') { sql += " AND status='open' AND due_at IS NOT NULL AND due_at < ?"; vals.push(now); }
  else if (filter === 'open') { sql += " AND status='open'"; }
  else if (filter === 'all') { /* no-op */ }
  if (project) { sql += ' AND project = ?'; vals.push(project); }
  const rows = db.prepare(sql).all(...vals);
  return rows.sort((a, b) => urgencyScore(b, now) - urgencyScore(a, now));
}

// urgency:越紧急分越高。逾期最高,其次按剩余时间 + 优先级。
export function urgencyScore(t, now = Date.now()) {
  const prio = { urgent: 3, high: 2, normal: 1, low: 0 }[t.priority] ?? 1;
  if (t.status !== 'open') return -1e9 + t.updated_at / 1e9;
  if (t.due_at == null) return prio;                 // someday:只按优先级
  const mins = (t.due_at - now) / 60000;
  if (mins < 0) return 1e6 - mins + prio;            // 逾期越久越靠前
  return 1e5 / (mins + 10) + prio;                   // 越近越高
}

export function metaGet(k) { openDb(); return db.prepare('SELECT v FROM meta WHERE k=?').get(k)?.v ?? null; }
export function metaSet(k, v) { openDb(); db.prepare('INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=?').run(k, v, v); }

// ---- 提醒调度用 ----
export function dueReminders(now = Date.now()) {
  openDb();
  return db.prepare(`
    SELECT r.*, t.title, t.priority, t.due_at, t.project, t.snooze_until
    FROM reminders r JOIN tasks t ON t.id = r.task_id
    WHERE r.fired = 0 AND r.remind_at <= ? AND t.status = 'open'
      AND (t.snooze_until IS NULL OR t.snooze_until <= ?)`).all(now, now);
}
export function markReminderFired(id) { openDb(); db.prepare('UPDATE reminders SET fired=1 WHERE id=?').run(id); }

export function overdueToNag(now, nagIntervalMs) {
  openDb();
  return db.prepare(`
    SELECT * FROM tasks
    WHERE status='open' AND due_at IS NOT NULL AND due_at < ?
      AND (snooze_until IS NULL OR snooze_until <= ?)
      AND (last_nag_at IS NULL OR ? - last_nag_at >= ?)`).all(now, now, now, nagIntervalMs);
}
export function markNagged(id, now) { openDb(); db.prepare('UPDATE tasks SET last_nag_at=? WHERE id=?').run(now, id); }

// ---- board.md 人类可读镜像 ----
export function syncBoardMd() {
  try {
    openDb();
    const now = Date.now();
    const open = listTasks({ filter: 'open' });
    const done = db.prepare("SELECT * FROM tasks WHERE status='done' ORDER BY completed_at DESC LIMIT 20").all();
    const fmt = (ms) => ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—';
    const line = (t) => {
      const od = t.due_at && t.due_at < now ? ' ⏰逾期' : '';
      const p = t.priority !== 'normal' ? ` [${t.priority}]` : '';
      const proj = t.project ? ` @${t.project}` : '';
      return `- [ ] ${t.title}${p}${proj} — 截止 ${fmt(t.due_at)}${od}  \`${t.id}\``;
    };
    const md = [
      '# 任务看板', '',
      `> 自动生成,请勿手改此块(改任务用 AI/CLI/便签)。更新于 ${fmt(now)}`, '',
      `## 进行中 (${open.length})`, '',
      open.length ? open.map(line).join('\n') : '_空_', '',
      `## 最近完成`, '',
      done.length ? done.map(t => `- [x] ${t.title}  (${fmt(t.completed_at)})`).join('\n') : '_无_', '',
    ].join('\n');
    fs.writeFileSync(BOARD_MD_PATH, md);
  } catch (e) { console.error('[board.md] 写入失败:', e.message); }
}
