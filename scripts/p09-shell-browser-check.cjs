const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.VIKINGPM_BROWSER_OUTPUT || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vikingpm-p09-'));
fs.mkdirSync(output, { recursive: true });
const versionIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
const versions = versionIds.map((id, index) => ({
  id, displayName: '浏览器测试版本 ' + (index + 1), ownerName: '测试负责人', ownerConfirmed: true,
  projectName: '隔离测试项目', syncStatus: 'succeeded', lastSuccessAt: '2026-11-23T02:00:00Z', syncStartAt: '2026-11-20T02:00:00Z'
}));

// Fixtures are local: this check never reads a real login session or sends external writes.
function fact(id, kind, functionName, due) {
  return {
    id, sourceTaskId: id, parentSourceTaskId: kind === 'requirement' ? null : 'root', title: id,
    typeName: kind === 'requirement' ? '需求' : kind === 'professional' ? '子需求' : '辅助子单',
    kind, functionName, rawStatus: '开发中', semantic: 'developing', issues: [], due, timing: { development: {}, test: {} },
    requirementTitle: '测试核心需求', executorName: '测试执行者',
    plannedStartAt: '2026-11-20T10:00:00+08:00', planWorkingDays: due?.overdue ? 1 : 5,
    plannedDueAt: due?.overdue ? '2026-11-20T10:00:00+08:00' : '2026-11-26T10:00:00+08:00'
  };
}
const facts = [
  fact('root', 'requirement', null, { overdue: true, workingDays: 5 }),
  fact('ui', 'professional', 'UI界面', { overdue: true, workingDays: 1 }),
  fact('icon', 'professional', 'UI图标', { overdue: false, dueSoon: true, workingDaysUntil: 3, deadlineDate: '2026-11-26', today: '2026-11-23' }),
  fact('aux', 'auxiliary', 'UI界面', { overdue: true, workingDays: 5 })
];
facts[0].issues = ['结构待核对'];
function management(index) {
  const requirement = {
    id: 'root', title: '测试核心需求',
    stages: {
      foundation: { calculable: true, complete: false, missingFunctions: ['客户端'] },
      detail: { calculable: true, complete: false, missingFunctions: ['UI图标'] },
      test: { calculable: false, complete: false, missingFunctions: [] }
    }
  };
  return {
    versionId: versionIds[index],
    items: index ? [fact('server', 'professional', '服务端', { overdue: true, workingDays: 2 })] : facts,
    requirements: index ? [] : [requirement],
    progress: {
      coreRequirementCount: 1, foundation: { total: 1, completed: 0, percent: 0 },
      detail: { total: 1, completed: 0, percent: 0 }, test: { total: 1, completed: 0, percent: 0 },
      optimization: { total: 0, stateComplete: 0 }
    },
    optimizations: [], concurrency: { threshold: 3, attention: [], excluded: 0 }, sourceSnapshotAt: '2026-11-23T02:00:00Z', calculatedAt: '2026-11-23T02:05:00Z', revision: 1
  };
}
const tasks = Array.from({ length: 101 }, (_, index) => ({
  sourceTaskId: 'task-' + index, title: '测试任务 ' + index, visibleKey: 'TEST-' + index,
  typeName: '子需求', functionName: 'UI界面', sourcePresence: 'current', structureIssues: [], rawStatus: '开发中'
}));
const files = {
  '/': 'index.html', '/acceptance': 'acceptance.html', '/shell.js': 'shell.js',
  '/shell.css': 'shell.css', '/management-ui.js': 'management-ui.js', '/function-catalog.mjs': '../function-catalog.mjs'
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let server, browser;

(async () => {
  try {
    server = http.createServer((request, response) => {
      const file = new URL(request.url, 'http://localhost').pathname;
      if (!files[file]) return response.writeHead(404).end();
      response.setHeader('Content-Type', /\.(js|mjs)$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(fs.readFileSync(path.join(root, 'app/public', files[file])));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url());
      let data;
      if (url.pathname === '/api/me') data = { id: 'test', displayName: '测试用户', role: 'viewer' };
      else if (url.pathname === '/api/versions') data = versions;
      else if (url.pathname === '/api/management') data = {
        revision: 1, functions: ['UI界面', 'UI图标', '客户端'], semantics: { not_started: '未开始', developing: '开发中' },
        markers: ['development_start'], defaults: { foundation: ['UI界面', '客户端'], detail: ['UI图标'], schedules: [{ day: 2, time: '10:00' }], concurrency: 3 },
        rules: [], calendar: {}, mappings: [], projects: [{ id: 'project', name: '测试项目', statuses: [{ id: 'developing', name: '开发中', workflowId: 'flow', workflowName: '开发流程', usedCount: 1 }] }],
        versions: versions.map(version => ({ id: version.id, name: version.displayName, lifecycle: 'enrolled' })), requirements: []
      };
      else if (url.pathname.startsWith('/api/management/versions/')) data = management(versionIds.indexOf(url.pathname.split('/').at(-1)));
      else if (url.pathname.includes('/history')) data = { items: [], nextOffset: null };
      else if (url.pathname.includes('/tasks')) {
        const offset = Number(url.searchParams.get('offset') || 0);
        data = { items: tasks.slice(offset, offset + 100), total: tasks.length, nextOffset: offset === 0 ? 100 : null };
      } else throw new Error('Unexpected API path: ' + url.pathname);
      await route.fulfill({ json: data });
    });
    await page.route('**/healthz', route => route.fulfill({ json: { loginEnabled: true } }));
    const metric = index => page.locator('.metric-card').nth(index).locator('.metric-value');

    await page.goto(origin);
    await page.locator('.action-grid').waitFor();
    assert.equal(await page.locator('#tb-sync').isVisible(), false);
    assert.equal(await metric(3).innerText(), '2');
    assert.equal(await metric(4).innerText(), '1');
    await page.screenshot({ path: path.join(output, 'p09-aligned-desktop.png'), fullPage: true });
    await page.selectOption('#version-select', versionIds[0]);
    await page.waitForFunction(() => document.querySelectorAll('.metric-value')[3].textContent === '1');
    assert.match(page.url(), /action\?version=/);
    await page.locator('#function-summary').click();
    await page.getByLabel('UI图标', { exact: true }).check();
    await page.waitForFunction(() => document.querySelectorAll('.metric-value')[3].textContent === '0');
    assert.equal(await metric(4).innerText(), '1');
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.metric-value')[3]?.textContent === '0');
    assert.equal(await page.getByLabel('UI图标', { exact: true }).isChecked(), true);
    await page.getByRole('link', { name: '数据待处理', exact: true }).click();
    await page.getByRole('region', { name: '数据待处理汇总' }).waitFor();
    assert.equal(await page.locator('#function-filter').isVisible(), false);
    assert.match(await page.locator('#view').innerText(), /结构待核对/);
    await page.getByRole('link', { name: '风险与到期', exact: true }).click();
    await page.locator('.action-grid').waitFor();
    assert.equal(await metric(3).innerText(), '0');

    await page.getByRole('link', { name: '版本', exact: true }).click();
    await page.locator('.version-workspace').waitFor();
    assert.equal(await page.locator('.version-rail-item').count(), 2);
    assert.equal(await page.locator('.version-rail-item.active').innerText(), '浏览器测试版本 1\n1 个核心需求');
    assert.match(await page.locator('.version-detail-pane').innerText(), /风险需求\s*待接入/);
    assert.match(await page.locator('.version-detail-pane').innerText(), /当前管理信号/);
    assert.match(await page.locator('.version-detail-pane').innerText(), /最近变化/);
    await page.screenshot({ path: path.join(output, 'p09-version-desktop.png'), fullPage: true });
    await page.getByRole('region', { name: '任务快照', exact: true }).waitFor();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.waitForFunction(() => location.hash.includes('offset=100') && document.querySelector('.count-line')?.textContent.includes('本页 1 张'));
    await page.getByRole('region', { name: '任务快照', exact: true }).locator('tbody tr').first().click();
    await page.locator('.task-panel').waitFor();
    assert.equal(await page.locator('.panel-title').innerText(), '测试任务 100');
    await page.reload();
    await page.locator('.task-panel').waitFor();
    assert.equal(await page.locator('.panel-title').innerText(), '测试任务 100');
    assert.match(page.url(), /offset=100&task=task-100/);
    await page.getByRole('link', { name: '需求', exact: true }).click();
    await page.locator('.requirement-overview').waitFor();
    assert.match(await page.locator('.requirement-overview').innerText(), /测试核心需求/);
    assert.equal(await page.locator('.requirement-timeline-row').count(), 2);
    assert.equal(await page.locator('.requirement-work-card').count(), 1);
    await page.screenshot({ path: path.join(output, 'p09-requirement-desktop.png'), fullPage: true });

    await page.goto(origin + '/#/action');
    await page.locator('.action-grid').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/#/versions/' + versionIds[0]);
    await page.locator('.version-workspace').waitFor();
    await page.screenshot({ path: path.join(output, 'p09-version-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto(origin + '/#/requirements?version=' + versionIds[0] + '&requirement=root');
    await page.locator('.requirement-overview').waitFor();
    await page.screenshot({ path: path.join(output, 'p09-requirement-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto(origin + '/#/action');
    await page.locator('.action-grid').waitFor();
    await page.screenshot({ path: path.join(output, 'p09-aligned-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    let delayedRequests = 0;
    await page.route('**/api/management/versions/*', async route => {
      delayedRequests++;
      await wait(350);
      await route.fulfill({ json: management(versionIds.indexOf(new URL(route.request().url()).pathname.split('/').at(-1))) });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/?scenario=late');
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.getByRole('link', { name: '配置库', exact: true }).click();
    await page.locator('.config-layout').waitFor();
    await wait(600);
    assert.ok(delayedRequests >= 2);
    assert.equal(await page.locator('.config-layout').count(), 1, 'Late action response must not overwrite config route');
    await page.getByRole('button', { name: '状态语义', exact: true }).click();
    await page.getByRole('region', { name: '状态映射', exact: true }).waitFor();
    assert.equal(await page.getByLabel('开发中的管理语义').isDisabled(), true);
    await page.getByRole('button', { name: '人员与通知', exact: true }).click();
    assert.match(await page.locator('.config-content').innerText(), /当前身份：测试用户/);

    await page.route('**/api/management/versions/*', async route => {
      const index = versionIds.indexOf(new URL(route.request().url()).pathname.split('/').at(-1));
      await route.fulfill(index ? { status: 503, json: { error: '测试来源不可用' } } : { json: management(0) });
    });
    await page.goto(origin + '/?scenario=failure#/action');
    await page.locator('.action-grid').waitFor();
    assert.equal(await metric(3).innerText(), '未知');
    assert.match(await page.locator('#view').innerText(), /仅列出读取成功的工单/);
    await page.route('**/api/management/versions/*', async route => {
      const data = management(0);
      const url = new URL(route.request().url());
      data.items = url.pathname.endsWith(versionIds[0]) ? [fact('known-overdue', 'professional', 'UI界面', { overdue: true, workingDays: 1 }), fact('unknown-plan', 'professional', 'UI界面', null)] : [];
      await route.fulfill({ json: data });
    });
    await page.goto(origin + '/?scenario=missing-plan#/action');
    await page.locator('.action-grid').waitFor();
    assert.equal(await metric(3).innerText(), '未知');
    assert.match(await page.locator('#view').innerText(), /已知逾期 1 张；另 1 张到期未知/);
    assert.match(await page.locator('#view').innerText(), /无法判断到期/);
    await page.route('**/api/me', route => route.fulfill({ status: 401, json: { error: '登录已过期' } }));
    await page.reload();
    await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#app').isVisible(), false);
    await page.route('**/api/me', route => route.fulfill({ json: { id: 'owner', displayName: '测试所有者', role: 'owner', csrf: 'fake-csrf' } }));
    await page.route('**/api/access', route => route.fulfill({ json: [{ id: 'owner', displayName: '测试所有者', role: 'owner', active: true, mappingEnabled: true, confirmed: true }] }));
    await page.route('**/api/audit', route => route.fulfill({ json: [{ id: '1', action: 'management.calendar', reason: '隔离验证', occurred_at: '2026-11-23T02:00:00Z', before_value: null, after_value: { working: true } }] }));
    const syncCalls = [];
    await page.route('**/api/versions/*/sync', async route => {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      assert.equal(route.request().postDataJSON().reason, '顶部按钮手动获取最新 TB 工单状态');
      syncCalls.push(new URL(route.request().url()).pathname.split('/').at(-2));
      await route.fulfill({ json: { status: 'succeeded', importedCount: 6, issueCount: 0 } });
    });
    let ownerReads = 0;
    await page.route('**/api/management/versions/*', async route => {
      ownerReads++;
      const index = versionIds.indexOf(new URL(route.request().url()).pathname.split('/').at(-1));
      await route.fulfill({ json: management(index) });
    });
    let saved = 0;
    await page.route('**/api/management/preview', async route => {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      const input = route.request().postDataJSON();
      assert.equal(input.kind, 'calendar');
      await route.fulfill({ json: { revision: 1, previewToken: 'fake-preview', affected: { versionCount: 2, taskCount: 101 }, before: {}, after: input.values } });
    });
    await page.route('**/api/management/save', async route => {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      const input = route.request().postDataJSON();
      assert.equal(input.previewToken, 'fake-preview');
      assert.equal(input.confirmed, true);
      assert.equal(input.expectedRevision, 1);
      saved++;
      await route.fulfill({ json: { saved: true, revision: 2 } });
    });
    await page.goto(origin + '/?scenario=config-owner#/action');
    await page.locator('.action-grid').waitFor();
    await page.getByRole('button', { name: '获取最新TB', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#tb-sync').disabled);
    assert.deepEqual(syncCalls, versionIds);
    assert.match(await page.locator('#message').innerText(), /2\/2 个版本同步成功/);
    await page.selectOption('#version-select', versionIds[0]);
    await page.getByRole('button', { name: '获取最新TB', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#tb-sync').disabled);
    assert.deepEqual(syncCalls, [...versionIds, versionIds[0]]);
    assert.match(await page.locator('#message').innerText(), /同步 6 张工单/);
    await page.getByRole('link', { name: '配置库', exact: true }).click();
    await page.locator('.config-layout').waitFor();
    await page.getByText('公司工作日历', { exact: true }).click();
    await page.locator('#mg-calendar-day').fill('2026-11-28');
    await page.locator('#mg-calendar-reason').fill('隔离浏览器验证');
    await page.locator('#mg-calendar-form button[type=submit]').click();
    await page.locator('#mg-review[open]').waitFor();
    await page.locator('#mg-save').click();
    await page.waitForFunction(() => document.querySelector('#mg-feedback').textContent.includes('保存成功'));
    assert.equal(saved, 1);
    await page.screenshot({ path: path.join(output, 'p09-config.png'), fullPage: true });
    const beforeActionReads = ownerReads;
    await page.getByRole('link', { name: '行动中心', exact: true }).click();
    await page.locator('.action-grid').waitFor();
    assert.equal(ownerReads, beforeActionReads + 2, 'Saved configuration invalidates computed management caches');
    await page.getByRole('link', { name: '配置库', exact: true }).click();
    await page.locator('.config-layout').waitFor();
    await page.getByRole('button', { name: '人员与通知', exact: true }).click();
    await page.getByRole('region', { name: '人员与权限', exact: true }).waitFor();
    await page.getByRole('link', { name: /^异常与审计/ }).click();
    await page.getByRole('region', { name: '最近系统审计', exact: true }).waitFor();
    assert.match(await page.locator('#view').innerText(), /隔离验证/);
    await page.screenshot({ path: path.join(output, 'p09-audit.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS P09 browser: desktop/mobile version and requirement workspaces, function scopes, data tab, pagination, task deep link, delayed navigation, failures, expired session, viewer restrictions, owner config preview/save and audit.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(resolve => server ? server.close(resolve) : resolve());
  }
})();
