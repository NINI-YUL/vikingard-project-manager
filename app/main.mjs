import { loadConfig } from './config.mjs';
import { poolFor } from './database.mjs';
import { createTeambitionSource } from './teambition-source.mjs';
import {createPoller} from './sync-poller.mjs';
import { createApplication } from './server.mjs';
let pool, server, worker;
try {
  const config = loadConfig(); pool = poolFor(config.database);
  await pool.query('SELECT initialized FROM security_state WHERE id=1');
  await pool.query('SELECT 1 FROM source_bindings LIMIT 0');
  await pool.query('SELECT next_due_at FROM source_sync_states LIMIT 0');
  const source=config.teambition ? createTeambitionSource(config.teambition) : undefined;
  worker=config.loginEnabled && config.teambition?.pollingEnabled ? createPoller(pool,source,{corpId:config.dingtalk.corpId,projectId:config.teambition.projectId,versionIds:config.teambition.versionIds,intervalSeconds:config.teambition.pollIntervalSeconds??900,onError:()=>console.error('后台同步暂未完成；保留上次成功数据并等待重试')}) : undefined;
  server = createApplication(pool,config,{source});
  server.on('error',() => { console.error('应用启动失败，请检查地址与配置'); pool.end().finally(() => process.exit(1)); });
  server.listen(config.port,config.host,() => {console.log(`VikingPM P04 已启动；登录${config.loginEnabled ? '已启用' : '未启用'}`);worker?.start();});
  const stop = () => { void worker?.stop();server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1),10000).unref(); };
  process.on('SIGTERM',stop); process.on('SIGINT',stop);
} catch {
  console.error('应用启动失败，请检查外部配置、数据库及迁移状态');
  await pool?.end().catch(() => {}); process.exitCode = 1;
}
