import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApplication } from '../app/server.mjs';
import { parseHash, summarizeManagement, actionHash, selectedFunctions, scopeActionContexts, syncTargetVersions, formatTaskNumber, requirementCalendar, sortTimelineItems, actualTimelineSpan, timelineActualText } from '../app/public/shell.js';

import { timing } from '../app/management-engine.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('task numbers use the source project prefix without guessing or duplicating it', () => {
  assert.equal(formatTaskNumber('107541', 'Viking'), 'Viking-107541');
  assert.equal(formatTaskNumber(107541, 'Viking-'), 'Viking-107541');
  assert.equal(formatTaskNumber('Viking-107541', 'Viking'), 'Viking-107541');
  assert.equal(formatTaskNumber('OTHER-42', 'Viking'), 'OTHER-42');
  assert.equal(formatTaskNumber('107541', null), '107541（前缀待核对）');
  assert.equal(formatTaskNumber(null, 'Viking'), '无编号');
});

test('requirement timeline sorts configured due dates, then starts, with missing dates last', () => {
  const items = [
    { id: 'same-late-start', plannedDueAt: '2026-11-26', plannedStartAt: '2026-11-22' },
    { id: 'missing-dates' },
    { id: 'earlier-due', plannedDueAt: '2026-11-25', plannedStartAt: '2026-11-24' },
    { id: 'same-early-start', plannedDueAt: '2026-11-26', plannedStartAt: '2026-11-20' },
    { id: 'same-due-missing-start', plannedDueAt: '2026-11-26' }
  ];
  assert.deepEqual(sortTimelineItems(items).map(item => item.id), [
    'earlier-due', 'same-early-start', 'same-late-start', 'same-due-missing-start', 'missing-dates'
  ]);
});

test('actual timeline selects the stage and extends the latest open round through today without filling source times', () => {
  const first = { start: '2026-11-19T10:00:00+08:00', end: '2026-11-20T18:00:00+08:00' };
  const reopened = { start: '2026-11-25T10:00:00+08:00', end: null };
  const item = { semantic: 'developing', typeName: '子需求', timing: { development: { unknown: false, workingDays: 4.5, rounds: [first, reopened] } } };
  const before = structuredClone(item);
  const span = actualTimelineSpan(item, '2026-11-27');
  assert.equal(span.startKey, '2026-11-19');
  assert.equal(span.endKey, '2026-11-27');
  assert.equal(span.end, null);
  assert.equal(span.ended, false);
  assert.equal(span.completed, false);
  assert.equal(timelineActualText(span), '实：11.19 -  · 已进行 4.5 工作日');
  assert.deepEqual(item, before);

  item.typeName = '测试任务';
  item.semantic = 'delivered';
  item.timing.test = { unknown: false, rounds: [{ start: '2026-11-26T16:30:00Z', end: '2026-11-27T17:00:00+08:00' }] };
  const testSpan = actualTimelineSpan(item, '2026-11-27');
  assert.equal(testSpan.startKey, '2026-11-27');
  assert.equal(testSpan.endKey, '2026-11-27');
  assert.equal(testSpan.completed, true);
  assert.equal(timelineActualText(testSpan), '实：11.27 - 11.27 · 已完成');
});

test('actual timeline keeps missing, future and invalid actual times separate from not started', () => {
  const make = (semantic, rounds, unknown = false) => ({ semantic, plannedStartAt: '2026-11-01', plannedDueAt: '2026-11-30', timing: { development: { rounds, unknown } } });
  const span = item => actualTimelineSpan(item, '2026-11-27');
  assert.equal(timelineActualText(span(make('not_started', [], true))), '实：未开始');
  assert.equal(timelineActualText(span(make('developing', []))), '实：实际时间不可判断');
  assert.equal(span(make('developing', [{ start: '2026-11-28', end: null }])).state, 'not_started');
  for (const rounds of [
    [{ start: null, end: '2026-11-20' }],
    [{ start: 'invalid', end: null }],
    [{ start: '2026-11-20', end: 'invalid' }],
    [{ start: '2026-11-20', end: '2026-11-19' }],
    [{ start: '2026-11-20', end: '2026-11-28' }],
    [{ start: '2026-11-20', end: '2026-11-21' }, { start: null, end: '2026-11-24' }]
  ]) assert.equal(span(make('developing', rounds)).state, 'unknown');
  assert.equal(span(make('developing', [{ start: '2026-11-20', end: null }], true)).state, 'unknown');
  const terminal = span(make('delivered', [{ start: '2026-11-20', end: null }]));
  assert.equal(terminal.completed, false);
  assert.equal(terminal.end, null);
  assert.match(timelineActualText(terminal), /结束时间缺失/);
});

test('actual timeline reuses source-derived timer totals including pauses and completed rounds', () => {
  const maps = {
    dev: { semantic: 'developing', markers: ['development_start'] },
    pause: { semantic: 'paused', markers: [] },
    done: { semantic: 'delivered', markers: ['development_end'] }
  };
  const development = timing([
    { at: '2026-11-23T09:00:00+08:00', statusId: 'dev' },
    { at: '2026-11-23T12:00:00+08:00', statusId: 'pause' },
    { at: '2026-11-24T09:00:00+08:00', statusId: 'dev' },
    { at: '2026-11-24T12:00:00+08:00', statusId: 'done' }
  ], maps, { syncStartAt: '2026-11-01', now: new Date('2026-11-27') }).development;
  const result = actualTimelineSpan({ semantic: 'delivered', timing: { development } }, '2026-11-27');
  assert.equal(result.startKey, '2026-11-23');
  assert.equal(result.endKey, '2026-11-24');
  assert.equal(result.workingDays, development.workingDays);
  assert.equal(result.completed, true);
});

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
  assert.match(styles, /\.version-detail-main/);
  assert.match(styles, /\.requirement-picker/);
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


test('local V2 fonts are served without login or database access and CSP permits only same-origin fonts', async t => {
  const config = { origin: 'http://127.0.0.1:0', loginEnabled: false };
  const server = createApplication({ query() { assert.fail('Static fonts must not query the database'); } }, config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const weight of [400, 500, 600, 700]) {
    const response = await fetch(config.origin + '/assets/jakarta-' + weight + '.ttf');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'font/ttf');
    assert.match(response.headers.get('content-security-policy'), /font-src 'self';/);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none';/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, await readFile(new URL('../app/public/assets/jakarta-' + weight + '.ttf', import.meta.url)));
  }
});


test('requirement calendar uses Beijing days and respects configured holidays and special workdays', () => {
  const days = requirementCalendar('2026-11-20T16:30:00Z', '2026-11-23T00:00:00Z', {
    '2026-11-21': { working: true }, '2026-11-23': { working: false }
  });
  assert.deepEqual(days.map(day => [day.key, day.working, day.special]), [
    ['2026-11-21', true, true], ['2026-11-22', false, false], ['2026-11-23', false, false]
  ]);
  assert.equal(requirementCalendar('2026-11-20T00:00:00Z', '2026-11-20T01:00:00Z').length, 1);
  for (const pair of [[null, null], ['bad', 'bad'], ['2026-11-23', '2026-11-20'], ['2000-01-01', '2026-01-01']]) assert.deepEqual(requirementCalendar(...pair), []);
});

test('configuration and acceptance share one management form template and keep legacy entry working', async t => {
  const config = { origin: 'http://127.0.0.1:0', loginEnabled: false };
  const server = createApplication({ query() { assert.fail('Static form must not read data'); } }, config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const shared = await fetch(config.origin + '/management-forms.html');
  assert.equal(shared.status, 200);
  const template = await shared.text();
  for (const endpoint of ['/acceptance', '/acceptance.html']) {
    const response = await fetch(config.origin + endpoint);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(template.trim()));
    assert.equal((html.match(/id="management-rules"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<!-- management-forms -->/);
  }
});

test('configuration save errors stay visible in the top review dialog', async () => {
  const template = await read('app/public/management-forms.html');
  const ui = await read('app/public/management-ui.js');
  const styles = await read('app/public/shell.css');
  assert.match(template, /id="mg-review-error"[^>]*role="alert"/);
  assert.match(ui, /reviewError/);
  assert.match(ui, /error\.status===503/);
  assert.match(styles, /#mg-review-error/);
});
