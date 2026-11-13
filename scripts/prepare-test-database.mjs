import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { readJson } from '../app/config.mjs';
import { poolFor } from '../app/database.mjs';
let pool;
try {
  const directory='F:/VikingPM/security/';
  pool=poolFor({host:'127.0.0.1',port:55432,database:'postgres',user:'vikingpm_admin',password:readFileSync(directory+'postgres-admin.password','utf8').trim()});
  if (!(await pool.query("SELECT 1 FROM pg_database WHERE datname='vikingpm_p01p02_test'")).rowCount) await pool.query('CREATE DATABASE vikingpm_p01p02_test OWNER vikingpm_migrator');
  await pool.query('REVOKE ALL ON DATABASE vikingpm_p01p02_test FROM PUBLIC');
  const config=readJson(directory+'migration.json');
  const path=directory+'integration-test.json';
  if(!existsSync(path))writeFileSync(path,JSON.stringify({...config,database:'vikingpm_p01p02_test'},null,2),{flag:'wx'});
  console.log('P01–P02 专用隔离测试库已准备；未重置任何数据库');
}catch{console.error('隔离测试库准备失败；未执行数据库重置');process.exitCode=1;}
finally{await pool?.end().catch(()=>{});}
