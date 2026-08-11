// 提醒调度器:每 30 秒扫一次,负责到点提醒、逾期死缠、每日晨报。
import { dueReminders, markReminderFired, overdueToNag, markNagged, getTask,
         metaGet, metaSet, listTasks } from './db.js';
import { notifyTask, notifyDigest } from './notify.js';

const TICK_MS = 30_000;

export function startScheduler(cfg, onChange = () => {}) {
  const tick = async () => {
    const now = Date.now();
    try {
      // 1) 到点提醒(阶梯里的每个点)
      for (const r of dueReminders(now)) {
        const task = getTask(r.task_id);
        if (!task || task.status !== 'open') continue;
        await notifyTask(cfg, task, r.label);
        markReminderFired(r.id);
        onChange();
      }
      // 2) 逾期死缠:每 nagIntervalMin 再催一次,直到完成/改期/贪睡
      const nagMs = (cfg.nagIntervalMin || 30) * 60_000;
      for (const t of overdueToNag(now, nagMs)) {
        await notifyTask(cfg, t, '仍未完成');
        markNagged(t.id, now);
        onChange();
      }
      // 3) 每日晨报(本地 morningDigestHour 点后,当天只发一次)
      await maybeMorningDigest(cfg, now);
    } catch (e) {
      console.error('[scheduler] tick 出错:', e.message);
    }
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}

async function maybeMorningDigest(cfg, now) {
  const d = new Date(now);
  const today = d.toISOString().slice(0, 10);
  if (d.getHours() < (cfg.morningDigestHour ?? 9)) return;
  if (metaGet('last_digest_date') === today) return;
  const tasks = listTasks({ filter: 'today' });
  await notifyDigest(cfg, tasks);
  metaSet('last_digest_date', today);
}
