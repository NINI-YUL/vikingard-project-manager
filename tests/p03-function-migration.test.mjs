import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readJson} from '../app/config.mjs';
import {poolFor,migrate,digest} from '../app/database.mjs';

test('P03 catalog upgrade preserves legacy source data and configuration',{skip:!process.env.VIKINGPM_TEST_CONFIG},async()=>{
 const db=readJson(process.env.VIKINGPM_TEST_CONFIG);assert.equal(db.database,'vikingpm_p01p02_test');assert.equal(db.user,'vikingpm_migrator');assert.equal(db.host,'127.0.0.1');
 const schema='p03_upgrade_'+randomBytes(8).toString('hex'),setup=poolFor(db);await setup.query('CREATE SCHEMA '+schema);const pool=poolFor({...db,options:'-c search_path='+schema});
 try{
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of ['001-identity-access.sql','002-p-version-source.sql','003-source-binding.sql','004-persistent-sync.sql','005-management-rules.sql']){
   const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');await pool.query(sql);await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,digest(sql)]);
  }
  const project=randomUUID(),version=randomUUID();await pool.query('INSERT INTO source_projects(id,corp_id,teambition_project_id,display_name) VALUES($1,$2,$3,$4)',[project,'fake','project','隔离项目']);await pool.query('INSERT INTO managed_versions(id,source_project_id,source_version_id,display_name) VALUES($1,$2,$3,$4)',[version,project,'version','隔离版本']);
  const names=['UI','策划','UI界面','UI图标','KGUI',null];
  for(const [index,name] of names.entries())await pool.query('INSERT INTO work_items(id,managed_version_id,source_task_id,title,function_name,structure_issues,raw_source) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),version,String(index),'不按标题归类',name,'["existing_issue"]',JSON.stringify({function:name})]);
  await pool.query('INSERT INTO management_rules(scope,scope_key,values) VALUES($1,$2,$3)',['system','system',JSON.stringify({foundation:['UI']})]);
  const before=(await pool.query('SELECT id,function_name,raw_source FROM work_items ORDER BY source_task_id')).rows;
  assert.equal(await migrate(pool),4);assert.equal(await migrate(pool),0);
  const after=(await pool.query('SELECT id,function_name,raw_source,function_resolution,structure_issues FROM work_items ORDER BY source_task_id')).rows;
  assert.deepEqual(after.map(({id,function_name,raw_source})=>({id,function_name,raw_source})),before);
  assert.deepEqual(after.map(i=>i.function_resolution),['legacy_unresolved','unrecognized','confirmed','confirmed','confirmed','missing']);
  assert.ok(after.every(i=>i.structure_issues.includes('existing_issue')));assert.ok(after[0].structure_issues.includes('legacy_function_unresolved'));assert.ok(after[1].structure_issues.includes('unknown_function_value'));
  assert.deepEqual((await pool.query('SELECT values FROM management_rules')).rows[0].values,{foundation:['UI']});
  await assert.rejects(pool.query("UPDATE work_items SET function_resolution='invalid'"));
 }finally{await pool.end();assert.match(schema,/^p03_upgrade_[a-f0-9]{16}$/);await setup.query('DROP SCHEMA '+schema+' CASCADE');await setup.end();}
});

