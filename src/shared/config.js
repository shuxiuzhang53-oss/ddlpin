// 路径、配置、常量 —— daemon / mcp / cli 共用。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const BASE_DIR = process.env.TASKBOARD_HOME || path.join(os.homedir(), '.taskboard');
export const DB_PATH = path.join(BASE_DIR, 'tasks.db');
export const BOARD_MD_PATH = path.join(BASE_DIR, 'board.md');
export const CONFIG_PATH = path.join(BASE_DIR, 'config.json');

const DEFAULT_CONFIG = {
  port: 4747,                 // daemon HTTP 监听端口(仅 127.0.0.1)
  defaultDueHour: 18,         // 只给日期没给时刻时,默认几点(“下班前”)
  nagIntervalMin: 30,         // 逾期后每隔多少分钟再催一次
  morningDigestHour: 9,       // 每日晨报时间
  desktopNotify: true,        // 走 macOS 系统通知
  ntfy: {
    server: 'https://ntfy.sh',
    topic: ''                 // 留空=不推手机;填一个只有你知道的随机字符串即可(手机 ntfy App 订阅同名)
  }
};

export function ensureBaseDir() {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

export function loadConfig() {
  ensureBaseDir();
  let cfg = { ...DEFAULT_CONFIG };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      cfg = { ...cfg, ...raw, ntfy: { ...DEFAULT_CONFIG.ntfy, ...(raw.ntfy || {}) } };
    } else {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    }
  } catch (e) {
    console.error('[config] 读取失败,用默认值:', e.message);
  }
  if (process.env.TASKBOARD_PORT) cfg.port = Number(process.env.TASKBOARD_PORT);
  return cfg;
}

export function daemonBaseUrl(cfg = loadConfig()) {
  return `http://127.0.0.1:${cfg.port}`;
}
