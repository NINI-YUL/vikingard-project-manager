import { loadConfig } from './config.mjs';
import { poolFor } from './database.mjs';
import { createApplication } from './server.mjs';
let pool, server;
try {
  const config = loadConfig(); pool = poolFor(config.database);
  await pool.query('SELECT initialized FROM security_state WHERE id=1');
  server = createApplication(pool,config);
  server.on('error',() => { console.error('应用启动失败，请检查地址与配置'); pool.end().finally(() => process.exit(1)); });
  server.listen(config.port,config.host,() => console.log(`VikingPM P01–P02 已启动；登录${config.loginEnabled ? '已启用' : '未启用'}`));
  const stop = () => { server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1),10000).unref(); };
  process.on('SIGTERM',stop); process.on('SIGINT',stop);
} catch {
  console.error('应用启动失败，请检查外部配置、数据库及迁移状态');
  await pool?.end().catch(() => {}); process.exitCode = 1;
}
