import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { loadConfig, readJson } from '../app/config.mjs';
import { poolFor, migrate } from '../app/database.mjs';
import { bootstrap } from '../app/security.mjs';
const directory = 'F:/VikingPM/security/';
const appPath = directory+'application.json', migrationPath = directory+'migration.json';
const command = process.argv[2];
let pool; let stage = 'prepare';
try {
  if (command === 'provision') {
    // Fixed local administrator password path; never accept credential contents as a command argument.
    const password = readFileSync(directory+'postgres-admin.password','utf8').trim();
    pool = poolFor({host:'127.0.0.1',port:55432,user:'vikingpm_admin',database:'postgres',password});
    stage = 'connect-admin';
    await pool.query('SELECT 1');
    stage = 'external-config';
    const appExists = existsSync(appPath), migrationExists = existsSync(migrationPath);
    if (appExists !== migrationExists) throw new Error();
    let app, migration;
    if (!appExists) {
      const objects = await pool.query("SELECT datname AS name FROM pg_database WHERE datname='vikingpm' UNION ALL SELECT rolname FROM pg_roles WHERE rolname IN ('vikingpm_app','vikingpm_migrator')");
      if (objects.rowCount) throw new Error();
      const database = {host:'127.0.0.1',port:55432,database:'vikingpm'};
      app = {host:'127.0.0.1',port:4310,origin:'http://127.0.0.1:4310',loginEnabled:false,dingtalk:{corpId:'',envPath:process.env.LOCALAPPDATA+'/VikingPM/dingtalk.env'},database:{...database,user:'vikingpm_app',password:randomBytes(36).toString('base64url')}};
      migration = {...database,user:'vikingpm_migrator',password:randomBytes(36).toString('base64url')};
      writeFileSync(migrationPath,JSON.stringify(migration,null,2),{flag:'wx'});
      writeFileSync(appPath,JSON.stringify(app,null,2),{flag:'wx'});
    } else { app = loadConfig(appPath); migration = readJson(migrationPath); }
    if (migration.user !== 'vikingpm_migrator' || migration.database !== 'vikingpm' || migration.host !== '127.0.0.1' || migration.port !== 55432 || !/^[A-Za-z0-9_-]{48}$/.test(migration.password) || !/^[A-Za-z0-9_-]{48}$/.test(app.database.password)) throw new Error();
    stage = 'roles';
    // Password-bearing role DDL must not appear even in PostgreSQL error-statement logs.
    await pool.query("SET log_statement='none'; SET log_min_error_statement='panic'; SET log_min_messages='panic'; SET log_parameter_max_length_on_error=0");
    for (const connection of [migration,app.database]) {
      const exists = (await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[connection.user])).rowCount;
      if (!exists) {
        // Both identifiers are fixed above; generated passwords are restricted to base64url.
        await pool.query(`CREATE ROLE ${connection.user} LOGIN PASSWORD '${connection.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
      }
    }
    stage = 'database';
    if (!(await pool.query("SELECT 1 FROM pg_database WHERE datname='vikingpm'")).rowCount) await pool.query('CREATE DATABASE vikingpm OWNER vikingpm_migrator');
    await pool.query('REVOKE ALL ON DATABASE vikingpm FROM PUBLIC');
    await pool.query('GRANT CONNECT ON DATABASE vikingpm TO vikingpm_app');
    await pool.end(); pool = poolFor(migration);
    await pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await pool.query('GRANT USAGE ON SCHEMA public TO vikingpm_app');
    stage = 'migrate';
    const count = await migrate(pool);
    await pool.query('GRANT SELECT,INSERT,UPDATE ON people,identity_mappings,access_grants,security_state TO vikingpm_app');
    await pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON login_sessions,oauth_requests TO vikingpm_app');
    await pool.query('GRANT SELECT,INSERT ON audit_events TO vikingpm_app');
    await pool.query('GRANT USAGE ON SEQUENCE audit_events_id_seq TO vikingpm_app');
    await pool.query('GRANT SELECT ON schema_migrations TO vikingpm_app');
    console.log(`业务库已准备；新增迁移 ${count}；登录未自动启用`);
  } else if (command === 'migrate') {
    const config = readJson(migrationPath);
    if (config.database !== 'vikingpm' || config.user !== 'vikingpm_migrator' || config.host !== '127.0.0.1' || config.port !== 55432) throw new Error();
    pool = poolFor(config); stage = 'migrate';
    const count = await migrate(pool); console.log(`迁移完成；新增 ${count}`);
  } else if (command === 'bootstrap') {
    const config = loadConfig();
    if (config.loginEnabled || !config.dingtalk.corpId) throw new Error();
    pool = poolFor(config.database);
    await bootstrap(pool,readJson(process.argv[3]),config.dingtalk.corpId);
    console.log('已按核对名单完成一次性初始化；登录仍关闭');
  } else throw new Error();
} catch (error) { console.error('阶段：'+stage+'；状态码：'+(/^[0-9A-Z]{5}$/.test(error.code ?? '') ? error.code : 'LOCAL') ); console.error('操作未完成；请检查数据库状态、外部配置、迁移记录及已核对的初始化名单。未执行数据重置。'); process.exitCode=1; }
finally { await pool?.end().catch(()=>{}); }
