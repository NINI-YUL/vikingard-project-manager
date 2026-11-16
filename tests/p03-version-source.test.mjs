import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkItem, enrollVersion, syncVersion, mapTeambitionTask, createTeambitionSourceReader, validateSnapshot } from '../app/version-source.mjs';
import { readJson } from '../app/config.mjs';
import { poolFor, migrate } from '../app/database.mjs';
import { bootstrap, changePerson } from '../app/security.mjs';
import { randomBytes } from 'node:crypto';

test('P03 work item normalization marks unknown and missing structure', () => {
  const item = normalizeWorkItem({sourceTaskId:'task-1',title:'需求',parentSourceTaskId:'missing',structureIssues:['unknown_category']},new Set(['task-1']));
  assert.equal(item.availability,'incomplete');
  assert.equal(item.parentMissing,true);
  assert.deepEqual(item.structureIssues,['parent_missing','unknown_category']);
});

test('P03 work item normalization keeps incomplete source visible', () => {
  const item = normalizeWorkItem({sourceTaskId:'task-2',parentSourceTaskId:'task-2'});
  assert.equal(item.availability,'incomplete');
  assert.equal(item.title,'未识别标题');
  assert.deepEqual(item.structureIssues,['missing_title','self_parent']);
});

test('P03 work item normalization marks empty semantic fields unknown', () => {
  const item = normalizeWorkItem({sourceTaskId:'task-3',title:'待识别'});
  assert.equal(item.availability,'unknown');
});

test('P03 PostgreSQL: enrollment, sync and source failure preserve existing facts', {skip: !process.env.VIKINGPM_TEST_CONFIG}, async () => {
  const database = readJson(process.env.VIKINGPM_TEST_CONFIG);
  assert.equal(database.database,'vikingpm_p01p02_test');assert.equal(database.user,'vikingpm_migrator');assert.equal(database.host,'127.0.0.1');
  const schema = 'p03_' + randomBytes(8).toString('hex');
  const setup = poolFor(database);
  await setup.query('CREATE SCHEMA ' + schema);
  const pool = poolFor({...database, options: '-c search_path=' + schema});
  try {
    await migrate(pool);
    await bootstrap(pool,{confirmed:true,corpId:'corp-test',reason:'隔离测试',people:[{displayName:'owner',unionId:'owner',role:'owner'},{displayName:'admin',unionId:'admin',role:'admin'}]},'corp-test');
    const people=Object.fromEntries((await pool.query('SELECT p.id,i.union_id FROM people p JOIN identity_mappings i ON p.id=i.person_id')).rows.map(p=>[p.union_id,p.id]));
    const options={actorId:people.admin,reason:'只读同步测试'};
    const version = await enrollVersion(pool, {corpId:'corp-test', projectId:'tb-project', projectName:'测试项目', versionId:'tb-version', versionName:'受控版本',ownerId:people.owner,reason:'受控纳入'},people.owner);
    const first = await syncVersion(pool, version.id, async () => ({items:[{sourceTaskId:'task-1',title:'需求',typeName:'需求',parentSourceTaskId:'missing'}]}),options);
    assert.deepEqual(first, {status:'succeeded', importedCount:1,issueCount:1});
    const before = await pool.query('SELECT title,availability,structure_issues FROM work_items');
    const failed = await syncVersion(pool, version.id, async () => { throw new Error('provider detail'); },options);
    assert.deepEqual(failed, {status:'failed', errorCode:'SOURCE_READ_FAILED', importedCount:0});
    assert.deepEqual((await pool.query('SELECT title,availability,structure_issues FROM work_items')).rows, before.rows);
    assert.equal((await pool.query("SELECT last_error_code FROM source_sync_states WHERE managed_version_id=$1", [version.id])).rows[0].last_error_code, 'SOURCE_READ_FAILED');
    const counts=async()=> (await pool.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n;
    for(const items of [[{sourceTaskId:'same'},{sourceTaskId:'same'}],[{title:'no id'}],[{sourceTaskId:'a',parentSourceTaskId:'b'},{sourceTaskId:'b',parentSourceTaskId:'a'}]]) {
      const result=await syncVersion(pool,version.id,async()=>({items}),options);
      assert.equal(result.errorCode,'SOURCE_STRUCTURE_INVALID');assert.equal(await counts(),1);
    }
    const original=version.sync_start_at;
    await pool.query('UPDATE managed_versions SET owner_id=NULL WHERE id=$1',[version.id]);
    const again=await enrollVersion(pool,{corpId:'corp-test',projectId:'tb-project',projectName:'测试项目',versionId:'tb-version',versionName:'受控版本',ownerId:people.owner,reason:'重复纳入'},people.owner);
    assert.equal(again.sync_start_at.toISOString(),original.toISOString());assert.equal(again.owner_id,people.owner);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM tracking_periods')).rows[0].n,1);
    let ready,finish;
    const started=new Promise(resolve=>ready=resolve),wait=new Promise(resolve=>finish=resolve);
    const firstSync=syncVersion(pool,version.id,async()=>{ready();await wait;return {items:[{sourceTaskId:'late',title:'revoked'}]};},options);
    const denied=assert.rejects(firstSync,{status:403});
    await started;
    try {
      await assert.rejects(syncVersion(pool,version.id,async()=>({items:[]}),options),{status:409});
      await changePerson(pool,people.owner,people.admin,{role:'none',reason:'同步读取中撤权'},'access');
    } finally {finish();}
    await denied;assert.equal(await counts(),1);

  } finally {
    await pool.end();
    assert.match(schema,/^p03_[a-f0-9]{16}$/);
    await setup.query('DROP SCHEMA ' + schema + ' CASCADE');
    await setup.end();
  }
});


test('P03 Teambition reader paginates, filters exact sprint and preserves source IDs', async () => {
  const calls = [];
  const read = createTeambitionSourceReader({
    projectId:'project-1', versionId:'version-1', fieldMap:{category:'cf-category',function:'cf-function',typeNames:{'type-1':'需求','type-3':'任务'}},
    listTasks: async args => {
      calls.push(args);
      return calls.length === 1 ? {result:[
        {projectId:'project-1',isArchived:false,id:'task-1',uniqueId:1001,content:'纳入任务',sprintId:'version-1',sfcId:'type-1',sfcName:'需求',tfsId:'status-1',tfsName:'待处理',customfields:[{cfId:'cf-category',value:[{title:'分类A'}]},{cfId:'cf-function',value:[{title:'职能A'}]}]}
      ],nextPageToken:'next'} : {result:[

        {projectId:'project-1',isArchived:false,id:'task-3',uniqueId:1003,content:'缺失类型名称',sprintId:'version-1',sfcId:'type-3',tfsId:'status-3',customfields:[]}
      ],nextPageToken:''};
    }
  });
  const snapshot = await read();
  assert.equal(calls.length,2);
  assert.equal(calls[1].pageToken,'next');
  assert.deepEqual(snapshot.items.map(item => item.sourceTaskId),['task-1','task-3']);
  assert.equal(snapshot.items[0].category,'分类A');
  assert.deepEqual(snapshot.items[1].structureIssues,['unknown_status']);
  assert.equal(snapshot.items[1].typeName,'任务');
});

test('P03 Teambition task mapping keeps unknown fields explicit', () => {
  const item = mapTeambitionTask({id:'task-4',uniqueId:1004,content:'任务',sprintId:'version-1',customfields:null});
  assert.equal(item.sourceTaskId,'task-4');
  assert.equal(item.visibleKey,'1004');
  assert.deepEqual(item.structureIssues,['unknown_task_type','unknown_status','customfields_missing']);
});


test('P03 structured function overrides title; only core subtasks require function', () => {
  const fields = {function:'function-field', typeNames:{core:'子需求',task:'任务'}};
  const missing = normalizeWorkItem(mapTeambitionTask({id:'missing',content:'【客户端】测试',sfcId:'core',tfsName:'待处理',customfields:[]},fields));
  assert.equal(missing.functionName,null);
  assert.equal(missing.availability,'incomplete');
  assert.deepEqual(missing.structureIssues,['missing_function']);
  const source = {id:'filled',content:'【KGUI】测试',sfcId:'core',tfsName:'待处理',customfields:[{cfId:'function-field',value:[{title:'策划'}]}]};
  const filled = normalizeWorkItem(mapTeambitionTask(source,fields));
  assert.equal(filled.functionName,'策划');
  assert.deepEqual(filled.rawSource,source);
  assert.deepEqual(filled.structureIssues,[]);
  const optional = normalizeWorkItem(mapTeambitionTask({id:'optional',content:'优化任务',sfcId:'task',tfsName:'待处理',customfields:[]},fields));
  assert.deepEqual(optional.structureIssues,[]);
});

test('P03 unknown type makes configuration issue visible despite known status', () => {
  const item = normalizeWorkItem(mapTeambitionTask({id:'unknown',content:'未知类型',sfcId:'unknown',tfsName:'待处理',customfields:[]}));
  assert.equal(item.availability,'incomplete');
  assert.deepEqual(item.structureIssues,['unknown_task_type']);
});


test('P03 reader rejects wrong project/version, archived tasks, duplicate tasks and nonadvancing pages',async()=>{
  const good={id:'id',projectId:'p',sprintId:'s',isArchived:false};
  for(const task of [{...good,projectId:'other'},{...good,sprintId:'other'},{...good,isArchived:true},{...good,id:null}]) {
    await assert.rejects(createTeambitionSourceReader({projectId:'p',versionId:'s',listTasks:async()=>({result:[task]})})());
  }
  let calls=0;
  await assert.rejects(createTeambitionSourceReader({projectId:'p',versionId:'s',listTasks:async()=>({result:[good],nextPageToken:String(++calls)})})());
  await assert.rejects(createTeambitionSourceReader({projectId:'p',versionId:'s',listTasks:async()=>({result:[],nextPageToken:'same'})})());
});

test('P03 graph supports missing parent but rejects cycles and invalid timestamps',()=>{
  assert.equal(validateSnapshot({items:[{sourceTaskId:'a',parentSourceTaskId:'missing'}]})[0].parentMissing,true);
  assert.throws(()=>validateSnapshot({items:[{sourceTaskId:'a',parentSourceTaskId:'b'},{sourceTaskId:'b',parentSourceTaskId:'c'},{sourceTaskId:'c',parentSourceTaskId:'a'}]}));
  assert.throws(()=>validateSnapshot({items:[{sourceTaskId:'a',sourceUpdatedAt:'invalid'}]}));
});

test('P03 opaque pagination cursor may repeat while distinct tasks continue to arrive',async()=>{
  let n=0;
  const read=createTeambitionSourceReader({projectId:'p',versionId:'s',listTasks:async()=>{n++;return {result:[{id:'task-'+n,projectId:'p',sprintId:'s',isArchived:false}],nextPageToken:n<3?'opaque':''};}});
  assert.equal((await read()).items.length,3);
});
