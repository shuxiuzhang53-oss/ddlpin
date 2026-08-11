// 通知:macOS 系统通知 + ntfy 手机推送。到点/逾期由 scheduler 调用。
import { execFile } from 'node:child_process';

function osaNotify(title, message, { sound = true } = {}) {
  // 用 osascript 弹系统通知(无需任何依赖)。文本里的引号做转义。
  const esc = (s) => String(s).replace(/["\\]/g, '\\$&');
  const script = `display notification "${esc(message)}" with title "${esc(title)}"` +
    (sound ? ' sound name "Ping"' : '');
  execFile('osascript', ['-e', script], (err) => {
    if (err) console.error('[notify] osascript 失败:', err.message);
  });
}

async function ntfyPush(cfg, { title, message, priority = 'default', tags = [] }) {
  const { server, topic } = cfg.ntfy || {};
  if (!topic) return; // 没配 topic = 不推手机
  try {
    await fetch(`${server.replace(/\/$/, '')}/${topic}`, {
      method: 'POST',
      headers: {
        'Title': encodeURIComponent(title),          // 中文标题需转义,ntfy 支持 RFC2047/百分号
        'Priority': priority,                          // min|low|default|high|max
        'Tags': tags.join(','),
        'Markdown': 'yes',
      },
      body: message,
    });
  } catch (e) {
    console.error('[notify] ntfy 推送失败:', e.message);
  }
}

// 距离/倒计时文案
export function countdownText(dueAt, now = Date.now()) {
  if (dueAt == null) return '无截止';
  let ms = dueAt - now, sign = ms < 0 ? '已逾期 ' : '还有 ';
  ms = Math.abs(ms);
  const m = Math.round(ms / 60000);
  if (m < 60) return sign + m + ' 分钟';
  const h = Math.floor(m / 60);
  if (h < 24) return sign + h + ' 小时' + (m % 60 ? ` ${m % 60} 分` : '');
  const d = Math.floor(h / 24);
  return sign + d + ' 天' + (h % 24 ? ` ${h % 24} 小时` : '');
}

export async function notifyTask(cfg, task, label) {
  const overdue = task.due_at && task.due_at < Date.now();
  const title = (overdue ? '⏰ 逾期:' : '🔔 ') + task.title;
  const message = `${label} · ${countdownText(task.due_at)}${task.project ? ` · @${task.project}` : ''}`;
  if (cfg.desktopNotify) osaNotify(title, message, { sound: overdue });
  await ntfyPush(cfg, {
    title, message,
    priority: overdue ? 'high' : 'default',
    tags: overdue ? ['rotating_light'] : ['bell'],
  });
}

export async function notifyDigest(cfg, tasks) {
  const title = `☀️ 今日 ${tasks.length} 项待办`;
  const lines = tasks.slice(0, 8).map(t => `• ${t.title} — ${countdownText(t.due_at)}`);
  const message = lines.join('\n') || '今天没有到期任务 🎉';
  if (cfg.desktopNotify) osaNotify(title, message.replace(/\n/g, '; '), { sound: false });
  await ntfyPush(cfg, { title, message, priority: 'default', tags: ['sunny'] });
}
