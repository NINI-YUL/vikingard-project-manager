import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkItem, enrollVersion, syncVersion, mapTeambitionTask, createTeambitionSourceReader } from '../app/version-source.mjs';
import { readJson } from '../app/config.mjs';
import { poolFor, migrate } from '../app/database.mjs';
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
  const schema = 'p03_' + randomBytes(8).toString('hex');
  const setup = poolFor(database);
  await setup.query('CREATE SCHEMA ' + schema);
  const pool = poolFor({...database, options: '-c search_path=' + schema});
  try {
    await migrate(pool);
    const version = await enrollVersion(pool, {corpId:'corp-test', projectId:'tb-project', projectName:'测试项目', versionId:'tb-version', versionName:'受控版本'});
    const first = await syncVersion(pool, version.id, async () => ({items:[{sourceTaskId:'task-1',title:'需求',typeName:'需求',parentSourceTaskId:'missing'}]}));
    assert.deepEqual(first, {status:'succeeded', importedCount:1});
    const before = await pool.query('SELECT title,availability,structure_issues FROM work_items');
    const failed = await syncVersion(pool, version.id, async () => { throw new Error('provider detail'); });
    assert.deepEqual(failed, {status:'failed', errorCode:'SOURCE_READ_FAILED', importedCount:0});
    assert.deepEqual((await pool.query('SELECT title,availability,structure_issues FROM work_items')).rows, before.rows);
    assert.equal((await pool.query("SELECT last_error_code FROM source_sync_states WHERE managed_version_id=$1", [version.id])).rows[0].last_error_code, 'SOURCE_READ_FAILED');
  } finally {
    await pool.end();
    await setup.query('DROP SCHEMA ' + schema + ' CASCADE');
    await setup.end();
  }
});


test('P03 Teambition reader paginates, filters exact sprint and preserves source IDs', async () => {
  const calls = [];
  const read = createTeambitionSourceReader({
    projectId:'project-1', versionId:'version-1', fieldMap:{category:'cf-category',function:'cf-function',typeNames:{'type-3':'任务'}},
    listTasks: async args => {
      calls.push(args);
      return calls.length === 1 ? {result:[
        {id:'task-1',uniqueId:1001,content:'纳入任务',sprintId:'version-1',sfcId:'type-1',sfcName:'需求',tfsId:'status-1',tfsName:'待处理',customfields:[{cfId:'cf-category',value:[{title:'分类A'}]},{cfId:'cf-function',value:[{title:'职能A'}]}]}
      ],nextPageToken:'next'} : {result:[
        {id:'task-2',uniqueId:1002,content:'其他版本',sprintId:'version-2',customfields:[]},
        {id:'task-3',uniqueId:1003,content:'缺失类型名称',sprintId:'version-1',sfcId:'type-3',tfsId:'status-3',customfields:[]}
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
  assert.deepEqual(item.structureIssues,['customfields_missing']);
});


test('P03 structured function overrides title; only core subtasks require function', () => {
  const fields = {function:'function-field', typeNames:{core:'子需求',task:'任务'}};
  const missing = normalizeWorkItem(mapTeambitionTask({id:'missing',content:'【客户端】测试',sfcId:'core',customfields:[]},fields));
  assert.equal(missing.functionName,null);
  assert.equal(missing.availability,'incomplete');
  assert.deepEqual(missing.structureIssues,['missing_function']);
  const source = {id:'filled',content:'【KGUI】测试',sfcId:'core',customfields:[{cfId:'function-field',value:[{title:'策划'}]}]};
  const filled = normalizeWorkItem(mapTeambitionTask(source,fields));
  assert.equal(filled.functionName,'策划');
  assert.deepEqual(filled.rawSource,source);
  assert.deepEqual(filled.structureIssues,[]);
  const optional = normalizeWorkItem(mapTeambitionTask({id:'optional',content:'优化任务',sfcId:'task',customfields:[]},fields));
  assert.deepEqual(optional.structureIssues,[]);
});

test('P03 unknown type makes configuration issue visible despite known status', () => {
  const item = normalizeWorkItem(mapTeambitionTask({id:'unknown',content:'未知类型',sfcId:'unknown',tfsName:'待处理',customfields:[]}));
  assert.equal(item.availability,'incomplete');
  assert.deepEqual(item.structureIssues,['unknown_task_type']);
});
