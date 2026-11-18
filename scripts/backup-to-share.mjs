import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, statSync, constants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { poolFor } from '../app/database.mjs';

const destination = String.raw`\\fs.dianchu.cc\DC\产品中心\产品四部\维京\11.pm备份`;
const tools = 'F:/VikingPM/runtime/pgsql/bin/';
const staging = 'F:/VikingPM/backup-staging/';
export function checksum(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
function run(tool, args, password) {
  return new Promise((resolve, reject) => {
    const child = spawn(tools + tool + '.exe', args, { windowsHide: true, env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '10' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let warnings = false;
    child.stderr.on('data', () => { warnings = true; });
    child.on('error', () => reject(new Error('数据库工具未执行')));
    child.on('close', code => code === 0 && !warnings ? resolve() : reject(new Error('数据库工具未完成或存在警告')));
  });
}
export async function fingerprint(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('不支持的表标识');
    if (['login_sessions', 'oauth_requests'].includes(tablename)) continue;
    const rows = (await client.query(`SELECT to_jsonb(t) AS value FROM public."${tablename}" t`)).rows;
    const canonical = rows.map(row => JSON.stringify(row.value)).sort();
    result[tablename] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') };
  }
  return result;
}
async function backup() {
  let admin, source, restored, snapshotClient;
  let stage = '准备';
  const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + randomBytes(3).toString('hex');
  const restoreDb = 'vikingpm_restore_' + id.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const base = 'vikingpm-' + id;
  const local = join(staging, base + '.dump');
  try {
    const password = readFileSync('F:/VikingPM/security/postgres-admin.password', 'utf8').trim();
    const connection = { host: '127.0.0.1', port: 55432, user: 'vikingpm_admin', password };
    admin = poolFor({ ...connection, database: 'postgres' });
    await admin.query('SELECT 1');
    mkdirSync(destination, { recursive: true });
    source = poolFor({ ...connection, database: 'vikingpm' });
    snapshotClient = await source.connect();
    await snapshotClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await snapshotClient.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const expected = await fingerprint(snapshotClient);
    const common = ['--host=127.0.0.1', '--port=55432', '--username=vikingpm_admin', '--no-password'];
    stage = '本机备份';
    await run('pg_dump', [...common, '--dbname=vikingpm', '--format=custom', '--no-owner', '--exclude-table-data=public.login_sessions', '--exclude-table-data=public.oauth_requests', '--snapshot=' + snapshot, '--file=' + local], password);
    await snapshotClient.query('COMMIT'); snapshotClient.release(); snapshotClient = null;
    stage = '隔离恢复';
    if (!/^vikingpm_restore_[a-z0-9_]+$/.test(restoreDb)) throw 0;
    await admin.query(`CREATE DATABASE "${restoreDb}" OWNER vikingpm_migrator`);
    await admin.query(`REVOKE ALL ON DATABASE "${restoreDb}" FROM PUBLIC`);
    await run('pg_restore', [...common, '--dbname=' + restoreDb, '--role=vikingpm_migrator', '--no-owner', '--single-transaction', '--exit-on-error', local], password);
    restored = poolFor({ ...connection, database: restoreDb });
    const actual = await fingerprint(restored);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('恢复数据比对不一致');
    const transient = (await restored.query('SELECT (SELECT count(*)::int FROM login_sessions) sessions,(SELECT count(*)::int FROM oauth_requests) requests')).rows[0];
    if (transient.sessions || transient.requests) throw new Error('恢复库不应保留登录状态');
    stage = '共享盘复制';
    const localHash = checksum(local);
    const partial = join(destination, base + '.dump.partial');
    const remote = join(destination, base + '.dump');
    copyFileSync(local, partial, constants.COPYFILE_EXCL);
    if (checksum(partial) !== localHash) throw new Error('共享盘备份校验不一致');
    renameSync(partial, remote);
    const report = { createdAt: new Date().toISOString(), sourceDatabase: 'vikingpm', format: 'pg_dump custom', backupFile: base + '.dump', bytes: statSync(local).size, sha256: localHash, restoreVerified: true, restoreDatabase: restoreDb, exactSnapshotRowsMatched: true, tablesVerified: Object.keys(actual).length, loginSessionsExcluded: true, oauthRequestsExcluded: true, databaseRolesAndCredentialsIncluded: false, scheduledInvocation: process.env.VIKINGPM_SCHEDULED_BACKUP === '1', localFile: local, sharedFile: remote };
    writeFileSync(join(staging, base + '.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    writeFileSync(join(destination, base + '.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    // Remove only this invocation's fresh restore sandbox after both backup copies were verified.
    stage = '清理本次恢复测试库';
    await restored.end(); restored = null;
    await admin.query(`DROP DATABASE "${restoreDb}"`);
    report.restoreDatabaseRetained = false;
    writeFileSync(join(staging, base + '.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(destination, base + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch {
    console.error('备份未完成，阶段：' + stage + '；保留既有备份，不覆盖或删除业务库，不输出原始异常');
    process.exitCode = 1;
  } finally {
    if (snapshotClient) { await snapshotClient.query('ROLLBACK').catch(() => {}); snapshotClient.release(); }
    await Promise.allSettled([admin?.end(), source?.end(), restored?.end()]);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await backup();
