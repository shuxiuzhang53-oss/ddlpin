// 本地 HTTP API(仅 127.0.0.1)。MCP、便签、CLI 都通过它读写。附带 SSE 推送变更。
import http from 'node:http';
import * as db from './db.js';
import { countdownText } from './notify.js';

// 把 due 输入(ISO 字符串 / 毫秒数 / 纯日期)统一成 epoch ms。
export function parseDue(due, cfg) {
  if (due == null || due === '') return null;
  if (typeof due === 'number') return due;
  const s = String(due).trim();
  // 纯日期 YYYY-MM-DD → 套用默认时刻
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00');
    d.setHours(cfg.defaultDueHour ?? 18, 0, 0, 0);
    return d.getTime();
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error('无法解析 due:「' + due + '」,请传 ISO 8601 或毫秒');
  return ms;
}

const sseClients = new Set();
export function broadcastChange() {
  for (const res of sseClients) {
    try { res.write(`event: change\ndata: {}\n\n`); } catch {}
  }
}

const withCountdown = (t) => t && { ...t, countdown: countdownText(t.due_at) };

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

export function startServer(cfg) {
  db.openDb();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const id = () => decodeURIComponent(p.split('/')[2] || '');
    try {
      if (p === '/health') return json(res, 200, { ok: true, ts: Date.now() });

      if (p === '/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('event: hello\ndata: {}\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (p === '/tasks' && req.method === 'GET') {
        const rows = db.listTasks({ filter: url.searchParams.get('filter') || 'open', project: url.searchParams.get('project') || undefined });
        return json(res, 200, rows.map(withCountdown));
      }
      if (p === '/due-soon' && req.method === 'GET') {
        const rows = db.listTasks({ filter: 'today' });
        const overdue = rows.filter(t => t.due_at && t.due_at < Date.now());
        return json(res, 200, { today: rows.map(withCountdown), overdueCount: overdue.length });
      }
      if (p === '/tasks' && req.method === 'POST') {
        const b = await readBody(req);
        const project = b.project || projectFromCwd(b.cwd);
        const t = db.createTask({ ...b, project, due_at: parseDue(b.due ?? b.due_at, cfg) });
        broadcastChange();
        return json(res, 201, withCountdown(t));
      }
      if (/^\/tasks\/[^/]+$/.test(p) && req.method === 'GET') {
        const t = db.getTask(db.resolveId(id())); return t ? json(res, 200, withCountdown(t)) : json(res, 404, { error: 'not found' });
      }
      if (/^\/tasks\/[^/]+$/.test(p) && req.method === 'PATCH') {
        const b = await readBody(req); const rid = db.resolveId(id());
        if (!rid) return json(res, 404, { error: 'not found' });
        const patch = {}; for (const k of ['title', 'priority', 'project', 'notes', 'estimate_min']) if (k in b) patch[k] = b[k];
        if ('due' in b || 'due_at' in b) patch.due_at = parseDue(b.due ?? b.due_at, cfg);
        const t = db.updateTask(rid, patch); broadcastChange(); return json(res, 200, withCountdown(t));
      }
      if (/^\/tasks\/[^/]+\/complete$/.test(p) && req.method === 'POST') {
        const rid = db.resolveId(id()); if (!rid) return json(res, 404, { error: 'not found' });
        const t = db.completeTask(rid); broadcastChange(); return json(res, 200, withCountdown(t));
      }
      if (/^\/tasks\/[^/]+\/drop$/.test(p) && req.method === 'POST') {
        const rid = db.resolveId(id()); if (!rid) return json(res, 404, { error: 'not found' });
        const t = db.dropTask(rid); broadcastChange(); return json(res, 200, withCountdown(t));
      }
      if (/^\/tasks\/[^/]+\/snooze$/.test(p) && req.method === 'POST') {
        const b = await readBody(req); const rid = db.resolveId(id()); if (!rid) return json(res, 404, { error: 'not found' });
        const until = b.until ? parseDue(b.until, cfg) : Date.now() + (b.minutes ?? 60) * 60_000;
        const t = db.snoozeTask(rid, until); broadcastChange(); return json(res, 200, withCountdown(t));
      }
      return json(res, 404, { error: 'no route', path: p });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  });
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`[taskd] HTTP 已就绪 http://127.0.0.1:${cfg.port}`);
  });
  return server;
}

function projectFromCwd(cwd) {
  if (!cwd) return null;
  try {
    // 取 git 根或目录名做项目标签
    const parts = String(cwd).split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch { return null; }
}
