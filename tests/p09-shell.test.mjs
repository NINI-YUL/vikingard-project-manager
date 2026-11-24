import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHash, summarizeManagement, actionHash, selectedFunctions, scopeActionContexts, syncTargetVersions } from '../app/public/shell.js';

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
  for (const label of ['活跃版本列表与版本详情', '核心需求进展与风险', '当前管理信号', '最近变化', '风险需求聚合将在 P09 后续阶段接入', '核心交付时间线与其他直属工作单', '工单时间线', '其他直属工作单']) {
    assert.match(script, new RegExp(label));
  }
  const styles = await read('app/public/shell.css');
  assert.match(styles, /\.version-workspace/);
  assert.match(styles, /\.version-rail-item\.active/);
  assert.match(styles, /\.version-detail-layout/);
  assert.match(styles, /\.requirement-overview/);
  assert.match(styles, /\.requirement-timeline-row/);
});

test('action filters isolate versions, professional tasks and multiple functions without mutating facts', () => {
  const contexts = [
    { version: { id: 'v1' }, management: { items: [
      { id: 'root', kind: 'requirement', issues: ['状态未映射'] },
      { id: 'ui', kind: 'professional', functionName: 'UI界面' },
      { id: 'icon', kind: 'professional', functionName: 'UI图标' },
      { id: 'server', kind: 'professional', functionName: '服务端' },
      { id: 'other', kind: 'auxiliary', functionName: 'UI界面' }
    ] } },
    { version: { id: 'v2' }, management: { items: [{ id: 'other-version', kind: 'professional', functionName: 'UI界面' }] } }
  ];
  assert.deepEqual(scopeActionContexts(contexts, 'v1', ['UI界面', 'UI图标'])[0].management.items.map(item => item.id), ['ui', 'icon']);
  assert.equal(scopeActionContexts(contexts, 'v1', ['UI界面'], true)[0].management.items.length, 5);
  assert.equal(scopeActionContexts(contexts, null)[0].management.items.length, 3);
  assert.equal(scopeActionContexts(contexts, 'missing').length, 0);
  assert.equal(contexts[0].management.items.length, 5);
  const failed = scopeActionContexts([{ version: { id: 'v1' }, management: null, error: new Error('offline') }], 'v1');
  assert.equal(failed[0].error.message, 'offline');
  assert.equal(failed[0].management, null);
});

test('version changes and tab switches keep URL function scope recoverable after refresh', () => {
  const hash = actionHash('v2', ['UI界面', 'UI图标'], 'data');
  assert.equal(parseHash(hash).versionId, 'v2');
  assert.equal(parseHash(hash).tab, 'data');
  assert.deepEqual(selectedFunctions(hash), ['UI界面', 'UI图标']);
  assert.equal(actionHash(), '#/action');
  assert.deepEqual(selectedFunctions('#/action?function=UI界面&function=UI界面'), ['UI界面']);
});

test('browser and server use one confirmed function catalog', async () => {
  const server = await import('../app/function-catalog.mjs');
  const script = await read('app/public/shell.js');
  assert.ok(script.includes("from '../function-catalog.mjs'"));
  assert.ok(server.functions.includes('UI界面'));
  assert.ok(server.functions.includes('UI图标'));
  const index = await read('app/public/index.html');
  assert.equal((index.match(/class="nav-icon"/g) ?? []).length, 8);
  assert.match(index, /id="tb-sync"[^>]*>获取最新TB<\/button>/);
  assert.doesNotMatch(index, />打开配置库<\/a>/);
});

test('manual TB refresh targets selected version or all active versions', () => {
  const versions = [{ id: 'v1' }, { id: 'v2' }];
  assert.deepEqual(syncTargetVersions(versions), versions);
  assert.deepEqual(syncTargetVersions(versions, 'v2'), [{ id: 'v2' }]);
  assert.deepEqual(syncTargetVersions(versions, 'missing'), []);
});
