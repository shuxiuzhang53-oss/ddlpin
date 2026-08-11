#!/usr/bin/env node
// Taskboard MCP server(stdio,零依赖)。CC / Codex / mirasim 会话都通过它记任务。
// 它只是把工具调用转成对本地 daemon 的 HTTP 请求。stdout 只走协议,日志一律走 stderr。
import readline from 'node:readline';
import { loadConfig, daemonBaseUrl } from '../shared/config.js';

const cfg = loadConfig();
const BASE = daemonBaseUrl(cfg);
const log = (...a) => console.error('[taskboard-mcp]', ...a);

async function api(method, path, body) {
  let r;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`任务 daemon 未运行(${BASE})。请先启动:\n  node ${process.cwd()}/src/daemon/main.js\n原始错误:${e.message}`);
  }
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const fmtTask = (t) => `「${t.title}」${t.due_at ? ` 截止 ${new Date(t.due_at).toLocaleString('zh-CN', { hour12: false })}(${t.countdown})` : ' 无截止'}` +
  `${t.priority !== 'normal' ? ` · 优先级 ${t.priority}` : ''}${t.project ? ` · @${t.project}` : ''} · id ${t.id}`;

// ---- 工具定义 ----
const TOOLS = [
  {
    name: 'add_task',
    description:
      '把一条任务记到用户的个人任务看板。用户在任何对话里提到"要在某时间前做某事""截止…""记一下…"时调用。' +
      '重要:如果用户给的是相对时间(如"周五""明天下午3点""下周"),你必须结合当前日期先解析成绝对时间,再用 ISO 8601 传给 due。' +
      '调用成功后,请把归一化结果(尤其是解析出的绝对截止时间)复述给用户,便于其发现解析错误。' +
      '另外:当用户在对话中顺口提到一个带时间的承诺或待办,即使没明确说"记一下",也可以主动询问是否要记到看板。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题(简洁)' },
        due: { type: 'string', description: '截止时间,ISO 8601 绝对时间(如 2026-08-14T18:00:00)。相对时间请先自行换算。可空(无截止)。' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: '优先级,默认 normal' },
        estimate_min: { type: 'number', description: '预估工时(分钟),可选,用于"时间放不下"预警' },
        notes: { type: 'string', description: '备注,可选' },
        project: { type: 'string', description: '所属项目,可选;不填则由 daemon 按当前工作目录自动推断' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: '查看任务看板。filter: today(今天及之前到期)| overdue(已逾期)| open(所有未完成,默认)| all。可按 project 过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['today', 'overdue', 'open', 'all'] },
        project: { type: 'string' },
      },
    },
  },
  {
    name: 'complete_task',
    description: '把某任务标记为完成。id 可传完整 id 或开头几位。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'update_task',
    description: '修改任务:改标题/截止时间/优先级/备注。改期时 due 同样要传 ISO 8601 绝对时间。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        due: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'snooze_task',
    description: '把某任务的提醒推迟。传 minutes(多少分钟后再提醒)或 until(ISO 8601)。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, minutes: { type: 'number' }, until: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'drop_task',
    description: '放弃/删除某任务(标记为 dropped,不再提醒)。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'add_task': {
      const t = await api('POST', '/tasks', { ...args, cwd: process.cwd(), source: process.env.TASKBOARD_SOURCE || 'cc' });
      return `✅ 已记到看板:${fmtTask(t)}`;
    }
    case 'list_tasks': {
      const q = new URLSearchParams();
      if (args.filter) q.set('filter', args.filter);
      if (args.project) q.set('project', args.project);
      const rows = await api('GET', '/tasks?' + q.toString());
      if (!rows.length) return '看板上没有匹配的任务。';
      return rows.map((t, i) => `${i + 1}. ${fmtTask(t)}`).join('\n');
    }
    case 'complete_task': { const t = await api('POST', `/tasks/${encodeURIComponent(args.id)}/complete`); return `✅ 已完成:${fmtTask(t)}`; }
    case 'drop_task': { const t = await api('POST', `/tasks/${encodeURIComponent(args.id)}/drop`); return `🗑️ 已放弃:${t.title}`; }
    case 'update_task': {
      const patch = {}; for (const k of ['title', 'priority', 'notes']) if (k in args) patch[k] = args[k];
      if ('due' in args) patch.due = args.due;
      const t = await api('PATCH', `/tasks/${encodeURIComponent(args.id)}`, patch);
      return `✏️ 已更新:${fmtTask(t)}`;
    }
    case 'snooze_task': {
      const t = await api('POST', `/tasks/${encodeURIComponent(args.id)}/snooze`, { minutes: args.minutes, until: args.until });
      return `💤 已推迟提醒到 ${new Date(t.snooze_until).toLocaleString('zh-CN', { hour12: false })}:${t.title}`;
    }
    default: throw new Error('未知工具: ' + name);
  }
}

// ---- JSON-RPC over stdio ----
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'taskboard', version: '0.1.0' },
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // 无需回复
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call': {
        try {
          const text = await callTool(params?.name, params?.arguments || {});
          return reply(id, { content: [{ type: 'text', text }] });
        } catch (e) {
          // 工具级错误:大声报错(daemon 没开等),让 AI 转告用户
          return reply(id, { content: [{ type: 'text', text: '⚠️ ' + e.message }], isError: true });
        }
      }
      case 'resources/list':
        return reply(id, { resources: [{ uri: 'taskboard://due-soon', name: '今日与逾期任务', mimeType: 'application/json', description: '开会话时可读,便于主动提醒用户' }] });
      case 'resources/read': {
        if (params?.uri === 'taskboard://due-soon') {
          const data = await api('GET', '/due-soon');
          return reply(id, { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(data) }] });
        }
        return replyErr(id, -32602, '未知资源: ' + params?.uri);
      }
      default:
        if (!isNotification) return replyErr(id, -32601, 'method not found: ' + method);
    }
  } catch (e) {
    log('handle 出错:', e.message);
    if (!isNotification) replyErr(id, -32603, e.message);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { const s = line.trim(); if (!s) return; let msg; try { msg = JSON.parse(s); } catch { return log('非法 JSON:', s); } handle(msg); });
log(`就绪,后端 ${BASE}`);
