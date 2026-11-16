import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkItem, enrollVersion, syncVersion } from '../app/version-source.mjs';
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
