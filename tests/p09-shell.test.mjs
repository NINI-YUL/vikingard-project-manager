import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHash, summarizeManagement } from '../app/public/shell.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('P09 shell routes keep stable version and task objects', () => {
  assert.deepEqual(parseHash(''), { raw: '/action', offset: 0, taskId: null, versionId: null, requirementId: null, tab: null, name: 'action' });
  assert.equal(parseHash('#/versions').name, 'versions');
  const detail = parseHash('#/versions/11111111-1111-1111-1111-111111111111?offset=200&task=task-7');
  assert.equal(detail.name, 'versionDetail');
  assert.equal(detail.versionId, '11111111-1111-1111-1111-111111111111');
  assert.equal(detail.offset, 200);
  assert.equal(detail.taskId, 'task-7');
  const requirements = parseHash('#/requirements?version=v1&requirement=r1');
  assert.equal(requirements.name, 'requirements');
  assert.equal(requirements.versionId, 'v1');
  assert.equal(requirements.requirementId, 'r1');
  assert.equal(parseHash('#/unknown').name, 'notFound');
});

test('P09 shell summary separates overdue, due soon and data issues', () => {
  const summary = summarizeManagement({ items: [
    { due: { overdue: true, workingDays: 2 }, issues: ['状态未映射', '职能待配置'] },
    { due: { overdue: false, dueSoon: true }, issues: [] },
    { due: null, issues: ['计划时间缺失'] },
    { timing: { development: { unknown: true }, test: { unknown: false } } }
  ] });
  assert.deepEqual(summary, {
    overdue: 1,
    dueSoon: 1,
    issueTasks: 2,
    issueCount: 3,
    developmentUnknown: 1,
    testUnknown: 0
  });
});

test('formal shell exposes confirmed navigation and preserves acceptance entry', async () => {
  const index = await read('app/public/index.html');
  for (const label of ['行动中心', '版本', '需求', '人员', '异常与审计', '人力参与度', '配置库', '历史查询', '功能验收']) {
    assert.match(index, new RegExp(label));
  }
  assert.match(index, /\/shell\.js/);
  assert.match(index, /\/shell\.css/);
  assert.doesNotMatch(index, /V1\.8\.0|演示数据|P01–P06/);

  const acceptance = await read('app/public/acceptance.html');
  assert.match(acceptance, /href="\/"/);
  assert.match(acceptance, /\/app\.js/);
  assert.match(acceptance, /功能验收/);

  const server = await read('app/server.mjs');
  for (const asset of ['/acceptance', '/shell.js', '/shell.css']) {
    assert.match(server, new RegExp(asset.replaceAll('/', '\\/')));
  }
});

test('formal shell reads real versions, management facts, tasks and history', async () => {
  const script = await read('app/public/shell.js');
  assert.match(script, /\/api\/versions/);
  assert.match(script, /\/api\/management\/versions\//);
  assert.match(script, /\/tasks\?offset=/);
  assert.match(script, /\/history\?kind=/);
  assert.match(script, /登录已过期/);
  assert.match(script, /读取失败/);
  assert.match(script, /不把缺失数据填成正常/);
});
