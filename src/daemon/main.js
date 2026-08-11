#!/usr/bin/env node
// daemon 入口:起 HTTP server + 提醒调度器。
import { loadConfig } from '../shared/config.js';
import { openDb, syncBoardMd } from './db.js';
import { startServer, broadcastChange } from './server.js';
import { startScheduler } from './scheduler.js';

const cfg = loadConfig();
openDb();
syncBoardMd();
const server = startServer(cfg);
const stopScheduler = startScheduler(cfg, broadcastChange);

console.log(`[taskd] 启动完成。数据目录见 ~/.taskboard。ntfy topic: ${cfg.ntfy?.topic || '(未配置,暂不推手机)'}`);

const shutdown = () => { stopScheduler(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
