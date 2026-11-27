const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.VIKINGPM_BROWSER_OUTPUT || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vikingpm-p09-'));
fs.mkdirSync(output, { recursive: true });
const versionIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
const versions = versionIds.map((id, index) => ({
  id, displayName: '浏览器测试版本 ' + (index + 1), ownerName: '测试负责人', ownerConfirmed: true,
  projectName: '隔离测试项目', uniqueIdPrefix: 'Viking', syncStatus: 'succeeded', lastSuccessAt: '2026-11-23T02:00:00Z', syncStartAt: '2026-11-20T02:00:00Z'
}));

// Fixtures are local: this check never reads a real login session or sends external writes.
function fact(id, kind, functionName, due) {
  return {
    id, sourceTaskId: id, parentSourceTaskId: kind === 'requirement' ? null : 'root', title: id,
    typeName: kind === 'requirement' ? '需求' : kind === 'professional' ? '子需求' : '辅助子单',
    sourcePresence: 'current', lastSyncedAt: '2026-11-27T02:48:33Z',
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
  fact('aux', 'auxiliary', 'UI界面', { overdue: true, workingDays: 5 }),
  fact('root-2', 'requirement', null, { overdue: false, workingDays: 5 }),
  fact('server-2', 'professional', '服务端', { overdue: false, workingDays: 5 })
];
facts[0].issues = ['结构待核对'];
facts[1].semantic = 'delivered';
facts[1].rawStatus = '已完成';
facts[1].timing.development = { unknown: false, workingDays: 3, rounds: [{ start: '2026-11-19T02:00:00Z', end: '2026-11-24T02:00:00Z', unknown: false }] };
facts[2].timing.development = { unknown: false, workingDays: 2, rounds: [{ start: '2026-11-25T02:00:00Z', end: null, unknown: false }] };
facts[1].risk={level:'normal',reason:'工单已结束',feedback:null};
facts[2].risk={level:'high',reason:'有效表单反馈：存在风险',feedback:{progressPercent:45,submittedAt:'2026-11-23T10:00:00+08:00',situation:'存在风险',note:'风险原因：接口延期\n预估延期时间：2天\n所需协助：接口联调'},plannedProgressPercent:72,lagPercentagePoints:27};
facts[2].executorPersonId='person-a';facts[2].executorSourceId='source-a';
facts[5].risk={level:'watch',reason:'反馈落后提交时的计划进度达到20个百分点',feedback:{progressPercent:40,submittedAt:'2026-11-23T10:00:00+08:00',situation:'进度正常',note:''},plannedProgressPercent:60,lagPercentagePoints:20};
facts[5].executorPersonId='person-b';facts[5].executorSourceId='source-b';
facts[0].key = '107541';
facts[4].title = '第二个核心需求';
facts[4].key = '107550';
facts[5].parentSourceTaskId = 'root-2';
facts[5].requirementTitle = '第二个核心需求';
function management(index) {
  const requirement = {
    id: 'root', title: '测试核心需求', risk:{level:'high',high:1,watch:0,unknown:0},
    stages: {
      foundation: { calculable: true, complete: false, completedCount: 0, totalCount: 2, incompleteFunctions: ['UI界面', '客户端'], missingFunctions: ['客户端'], blockedTaskCount: 2 },
      detail: { calculable: true, complete: false, completedCount: 0, totalCount: 3, incompleteFunctions: ['UI界面', '客户端', 'UI图标'], missingFunctions: ['UI图标'], blockedTaskCount: 3 },
      test: { calculable: false, complete: false, completedCount: 0, totalCount: 3, blockedTaskCount: 3, missingFunctions: [] }
    }
  };
  const secondRequirement = {
    id: 'root-2', title: '第二个核心需求', risk:{level:'watch',high:0,watch:1,unknown:0},
    stages: {
      foundation: { calculable: true, complete: true, completedCount: 1, totalCount: 1, incompleteFunctions: [], missingFunctions: [], blockedTaskCount: 0 },
      detail: { calculable: true, complete: true, completedCount: 1, totalCount: 1, incompleteFunctions: [], missingFunctions: [], blockedTaskCount: 0 },
      test: { calculable: true, complete: true, completedCount: 1, totalCount: 1, incompleteFunctions: [], missingFunctions: [], blockedTaskCount: 0 }
    }
  };
  return {
    calendar: { '2026-11-21': { working: true }, '2026-11-23': { working: false } },
    versionId: versionIds[index],
    items: index ? [fact('server', 'professional', '服务端', { overdue: true, workingDays: 2 })] : facts,
    requirements: index ? [] : [requirement, secondRequirement],
    progress: {
      coreRequirementCount: 1, foundation: { total: 1, completed: 0, percent: 0 },
      detail: { total: 1, completed: 0, percent: 0 }, test: { total: 1, completed: 0, percent: 0 },
      optimization: { total: 0, stateComplete: 0 }
    },
    optimizations: [], concurrency: { threshold: 3, attention: [], excluded: 0 }, sourceSnapshotAt: '2026-11-23T02:00:00Z', calculatedAt: '2026-11-23T02:05:00Z', revision: 1
  };
}
const tasks = Array.from({ length: 101 }, (_, index) => ({
  sourceTaskId: 'task-' + index, title: '测试任务 ' + index, visibleKey: String(107542 + index), parentVisibleKey: '107541', parentSourceTaskId: 'root',
  typeName: '子需求', functionName: 'UI界面', sourcePresence: 'current', lastSyncedAt: '2026-11-26T07:25:00Z', structureIssues: [], rawStatus: '开发中'
}));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let server, browser;
let configRules = [];
const calendarMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const calendarFixture = {
  [calendarMonth + '-01']: { working: false, intervals: [] },
  [calendarMonth + '-02']: { working: true, intervals: [{ start: '09:00', end: '12:00' }] }
};

(async () => {
  try {
    const { createApplication } = await import(pathToFileURL(path.join(root, 'app/server.mjs')).href);
    const config = { origin: 'http://127.0.0.1:0', loginEnabled: true };
    server = createApplication({ query() { throw new Error('Unexpected database read in isolated browser check'); } }, config);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = config.origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const drawerFact = (drawer, label) => drawer.locator('.fact').filter({ has: page.locator('dt', { hasText: new RegExp('^' + label + '$') }) }).locator('dd');
    await page.clock.setFixedTime(new Date('2026-11-27T02:00:00Z'));
    const errors = [], consoleErrors = [], expectedHttpFailures = new Map();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
    const fontResponses = [];
    page.on('response', response => { if (/\/assets\/jakarta-\d+\.ttf$/.test(response.url())) fontResponses.push(response); });
    await page.route('**/api/**', async route => {
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url());
      let data;
      if (url.pathname === '/api/me') data = { id: 'test', displayName: '测试用户', role: 'viewer' };
      else if (url.pathname === '/api/versions') data = versions;
      else if (url.pathname === '/api/status') data = { pollingEnabled: false, actualTimeEditing: true, actualTimeBatch: true };
      else if (url.pathname === '/api/management') data = {
        revision: 1, functions: ['UI界面', 'UI图标', '客户端'], semantics: { not_started: '未开始', developing: '开发中' },
        markers: ['development_start'], defaults: { foundation: ['UI界面', '客户端'], detail: ['UI图标'], schedules: [{ day: 2, time: '10:00' }], concurrency: 3 },
        rules: configRules, calendar: calendarFixture, mappings: [], projects: [{ id: 'project', name: '测试项目', statuses: [{ id: 'developing', name: '开发中', workflowId: 'flow', workflowName: '开发流程', usedCount: 1 }] }],
        versions: versions.map(version => ({ id: version.id, name: version.displayName, lifecycle: 'enrolled' })), requirements: []
      };
      else if (url.pathname.startsWith('/api/management/versions/')) {
        data = management(versionIds.indexOf(url.pathname.split('/').at(-1)));
        if (new URL(page.url()).searchParams.get('scenario') === 'actual-timeline') {
          const build = (id, values) => ({ ...fact(id, 'professional', '客户端', null), plannedStartAt: '2026-11-20', plannedDueAt: '2026-11-22', ...values });
          data.items = [facts[0],
            build('single-day', { semantic: 'delivered', rawStatus: '已完成', timing: { development: { unknown: false, workingDays: 1, rounds: [{ start: '2026-11-23', end: '2026-11-23' }] } } }),
            build('unplanned', { plannedStartAt: null, plannedDueAt: null, planWorkingDays: null, timing: { development: { unknown: false, workingDays: 2, rounds: [{ start: '2026-11-18', end: null }] } } }),
            build('future-start', { timing: { development: { unknown: false, rounds: [{ start: '2026-12-15', end: null }] } } }),
            build('future-today', { timing: { development: { unknown: false, workingDays: 0, rounds: [{ start: '2026-11-27T17:00:00+08:00', end: null }] } } }),
            build('pending', { semantic: 'not_started', rawStatus: '未开始', timing: { development: { unknown: true, rounds: [] } } }),
            build('unknown-time', { timing: { development: { unknown: true, rounds: [{ start: '2026-11-19', end: null }] } } }),
            build('reopened', { timing: { development: { unknown: false, workingDays: 4.5, rounds: [{ start: '2026-11-19', end: '2026-11-20' }, { start: '2026-11-26', end: null }] } } }),
            build('testing', { typeName: '测试任务', semantic: 'testing', timing: { test: { unknown: false, workingDays: 1, rounds: [{ start: '2026-11-25', end: null }] } } })
          ];
        }
      }
      else if (url.pathname.includes('/history')) data = { items: [], nextOffset: null };
      else if (url.pathname.includes('/tasks')) {
        const offset = Number(url.searchParams.get('offset') || 0);
        data = { items: tasks.slice(offset, offset + 100), total: tasks.length, nextOffset: offset === 0 ? 100 : null };
      } else throw new Error('Unexpected API path: ' + url.pathname);
      await route.fulfill({ json: data });
    });
    await page.route('**/healthz', route => route.fulfill({ json: { loginEnabled: true } }));
    const metric = index => page.locator('.metric-card').nth(index).locator('.metric-value');
    const { correctTiming, datePair, actualValue } = await import(pathToFileURL(path.join(root, 'app/actual-time-engine.mjs')).href);
    const actualSource = structuredClone(facts[1].timing); actualSource.development.rounds[0].anchors = ['source-start', 'source-end'];
    actualSource.development.rounds[0].hours = 22.5; actualSource.development.rounds[0].workingDays = 3;
    let actualRecords = [], actualSnapshot = 1, rejectActualSave = false;
    const actualWrites = [], actualHistory = [];
    const actualFact = () => ({ ...facts[1], sourceTiming: actualSource, ...(() => { const result = correctTiming(actualSource, actualRecords); return { timing: result.timing, timingCorrections: result.corrections }; })() });
    await page.route('**/api/management/versions/*/items/*/actual-time', async route => {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON(); actualWrites.push(input);
        assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
        assert.ok(Array.isArray(input.changes)); assert.equal(input.evidence, undefined);
        if (rejectActualSave) { rejectActualSave = false; actualSnapshot++; expectedHttpFailures.set(route.request().url(), 409); return route.fulfill({ status: 409, json: { error: '来源或修正记录已变化，请重新读取并核对后保存' } }); }
        assert.equal(input.snapshot, 'snapshot-' + actualSnapshot);
        for (const change of input.changes) {
          const previous = actualRecords.find(c => c.id === change.correctionId);
          const raw = actualSource[change.stage]?.rounds?.find(r => r.anchors?.[0] === change.roundKey), source = datePair(raw);
          const fields = structuredClone(previous?.fields ?? {});
          for (const [field, value] of Object.entries(change.fields)) {
            if (value.mode === 'inherit' || change.resolution === 'restore') delete fields[field];
            else fields[field] = { ...value, ...(value.mode === 'date' ? { value: actualValue(value.value) } : {}), source: source[field] };
          }
          if (change.resolution === 'restore') for (const field of Object.keys(fields)) delete fields[field];
          const effective = { ...source }; for (const [field, value] of Object.entries(fields)) effective[field] = value.mode === 'date' ? value.value : null;
          actualRecords = actualRecords.filter(c => c.id !== previous?.id);
          const record = { id: previous?.id ?? 'manual-' + change.stage + '-' + change.roundKey, stage: change.stage, anchors: raw?.anchors ?? [], fields, revision: actualSnapshot, last_valid: effective };
          if (Object.keys(fields).length) actualRecords.push(record);
          actualHistory.unshift({ actor: '测试所有者', occurred_at: '2026-11-27T02:00:00Z', reason: input.reason, before_value: null, after_value: { stage: change.stage, fields, effective, source, anchors: record.anchors, active: Boolean(Object.keys(fields).length), rebind: change.rebind } });
        }
        Object.assign(facts[1], actualFact()); actualSnapshot++;
        return route.fulfill({ json: { saved: true, count: input.changes.length } });
      }
      return route.fulfill({ json: { snapshot: 'snapshot-' + actualSnapshot, item: actualFact(), history: actualHistory } });
    });


    await page.goto(origin);
    await page.locator('.action-grid').waitFor();
    assert.equal(await page.locator('#tb-sync').isVisible(), false);
    assert.equal(await page.locator('#feedback-sync').isVisible(), false);
    assert.equal(await metric(3).innerText(), '2');
    assert.equal(await metric(4).innerText(), '1');
    assert.deepEqual(await page.locator('.metrics .metric-value').allTextContents(),['1','1','2','2','1']);
    assert.equal(await page.locator('.action-risk').count(),2);assert.equal(await page.locator('.action-risk[open]').count(),2);
    assert.equal(await page.locator('.action-risk-owner').count(),2,'same display names must not merge distinct people');
    assert.equal(await page.locator('.action-risk-owner > summary .action-owner-signals').count(),2,'counts stay visible while task lists are collapsed');
    assert.match(await page.locator('.action-risk.high').innerText(),/接口延期/);
    assert.match(await page.locator('.action-risk.high').innerText(),/提交时计划 72%/);
    for(const width of [375,768,1440]){
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,width+'px action risk page has no horizontal overflow');
      await page.screenshot({path:path.join(output,'p09-risk-'+width+'.png'),fullPage:true});
    }
    await page.locator('.action-risk > summary').first().click();assert.equal(await page.locator('.action-risk[open]').count(),1);
    await page.locator('.action-risk > summary').first().press('Enter');assert.equal(await page.locator('.action-risk[open]').count(),2);
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
    assert.match(await page.locator('.version-detail-pane').innerText(), /风险需求\s*2/);
    assert.deepEqual(await page.locator('.version-kpis .metric-value').allTextContents(), ['1', '0', '2']);
    const stageAlignments = await page.locator('.version-requirements :is(th, td):nth-child(3), .version-requirements :is(th, td):nth-child(4)').evaluateAll(elements => elements.map(element => getComputedStyle(element).textAlign));
    assert.deepEqual(stageAlignments, ['left', 'left', 'left', 'left', 'left', 'left']);
    assert.match(await page.locator('.version-requirements').innerText(), /0 \/ 2 · 未完成/);
    assert.match(await page.locator('.version-requirements').innerText(), /未完成职能：UI界面、客户端/);
    assert.doesNotMatch(await page.locator('#view').innerText(), /受阻工单|测试阶段：|需求 ID root/);
    assert.match(await page.locator('.version-requirements').innerText(), /Viking-107541/);
    assert.equal(await page.locator('.version-tasks').evaluate(element => element.open), false);
    const position = await page.locator('.version-detail-layout').evaluate(element => {
      const bounds = selector => element.querySelector(selector).getBoundingClientRect();
      const tasks = bounds('.version-tasks'), changes = bounds('.version-changes'), requirements = bounds('.version-requirements'), signals = bounds('.version-signal-list');
      return { alignedRows: Math.abs(tasks.top - changes.top) < 1, alignedColumns: Math.abs(tasks.left - requirements.left) < 1, sideBySide: tasks.right <= changes.left, changesBelowSignals: changes.top > signals.bottom };
    });
    assert.deepEqual(position, { alignedRows: false, alignedColumns: true, sideBySide: true, changesBelowSignals: true });
    await page.locator('.version-requirements .version-name').first().click();
    await page.locator('.requirement-overview').waitFor();
    assert.match(page.url(), /#\/requirements\?version=11111111-1111-1111-1111-111111111111&requirement=root/);
    assert.match(await page.locator('.requirement-title').innerText(), /测试核心需求/);
    assert.equal(await page.locator('.requirement-picker select').count(), 1);
    await page.locator('.requirement-picker select').selectOption('root-2');
    await page.locator('.requirement-title').waitFor();
    assert.match(page.url(), /requirement=root-2/);
    assert.equal(await page.locator('.requirement-title').innerText(), '第二个核心需求');
    await page.goto(origin + '#/versions/' + versionIds[0]);
    await page.locator('.version-detail-pane').waitFor();
    await page.locator('.version-requirement-row').first().locator('td').nth(1).click();
    await page.locator('.requirement-overview').waitFor();
    assert.match(page.url(), /#\/requirements\?version=11111111-1111-1111-1111-111111111111&requirement=root/);
    assert.equal(await page.locator('.requirement-list').count(), 0);
    await page.goto(origin + '#/versions/' + versionIds[0]);
    await page.locator('.version-detail-pane').waitFor();
    assert.match(await page.locator('.version-detail-pane').innerText(), /当前管理信号/);
    assert.match(await page.locator('.version-detail-pane').innerText(), /最近变化/);
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('version-page')), true);
    await page.evaluate(() => document.fonts.ready);
    for (const weight of [400, 500, 600, 700]) {
      assert.equal(await page.evaluate(weight => document.fonts.check(weight + ' 13px "Plus Jakarta Sans"'), weight), true);
    }
    assert.ok(fontResponses.length > 0, 'Version page must request local fonts');
    assert.ok(fontResponses.every(response => response.status() === 200));
    const fontClient = await page.context().newCDPSession(page);
    await fontClient.send('DOM.enable'); await fontClient.send('CSS.enable');
    const documentNode = await fontClient.send('DOM.getDocument');
    const titleNode = await fontClient.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '.version-detail-title' });
    const titleFonts = await fontClient.send('CSS.getPlatformFontsForNode', { nodeId: titleNode.nodeId });
    assert.ok(titleFonts.fonts.some(font => font.isCustomFont && font.familyName.includes('Jakarta')));
    await fontClient.detach();
    const visualComparisons = [];
    if (process.env.VIKINGPM_V2_ORIGIN) {
      const prototype = await browser.newPage();
      await prototype.goto(process.env.VIKINGPM_V2_ORIGIN);
      await prototype.locator('.side [data-page="versions"]').click();
      await prototype.locator('.version-workspace').waitFor();
      await prototype.evaluate(() => document.fonts.ready);
      const pairs = [
        ['body', 'body', ['fontFamily', 'fontSize', 'fontSynthesis', 'fontVariantNumeric', 'color', 'padding']],
        ['.top', '.top', ['minHeight', 'padding', 'backgroundColor']],
        ['.title', '.title', ['fontSize', 'lineHeight', 'fontWeight', 'color', 'letterSpacing']],
        ['.nav.active', '.nav.active', ['fontSize', 'fontWeight', 'gap', 'color', 'backgroundColor', 'padding']],
        ['.nav-icon', '.nav svg', ['width', 'height', 'strokeWidth']],
        ['.content', '.version-style .detail-page', ['padding', 'backgroundColor']],
        ['.version-workspace', '.version-workspace', ['gap']],
        ['.version-rail-toggle', '.version-rail-toggle', ['width', 'height', 'borderRadius']],
        ['.version-rail-item.active', '.version-rail-item.active', ['backgroundColor', 'borderColor', 'borderRadius']],
        ['.version-rail-item b', '.version-rail-item b', ['fontSize', 'fontWeight', 'lineHeight']],
        ['.version-detail-title', '.detail-title', ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color']],
        ['.version-kpis', '.version-kpis', ['gap']],
        ['.version-kpis .metric-card', '.version-kpis .card', ['padding', 'minHeight', 'borderRadius', 'borderColor', 'boxShadow']],
        ['.version-kpis .metric-value', '.version-kpis .metric', ['fontSize', 'lineHeight', 'fontWeight', 'letterSpacing', 'color']],
        ['.version-requirements', '.version-style .detail-layout>.card', ['padding', 'borderRadius', 'borderColor', 'boxShadow']],
        ['.version-requirements .section-title', '.version-style .section-title', ['fontSize', 'lineHeight', 'fontWeight', 'color']],
        ['.version-requirements th', '.version-style .detail-table th', ['fontSize', 'lineHeight', 'fontWeight', 'padding', 'backgroundColor']],
        ['.version-requirements td', '.version-style .detail-table td', ['fontSize', 'lineHeight', 'fontWeight', 'padding', 'color']],
        ['.version-requirements .pill', '.version-style .detail-table .pill', ['fontSize', 'lineHeight', 'fontWeight', 'padding', 'borderRadius']],
        ['.version-signal-list', '.version-style .signal-list', ['gap', 'marginTop']],
        ['.version-signal.red', '.version-style .signal.red-line', ['borderLeftColor', 'paddingLeft']],
        ['.version-signal.red b', '.version-style .signal.red-line b', ['fontSize', 'lineHeight', 'fontWeight', 'color']],
        ['.version-timeline-item b', '.version-style .timeline b', ['fontSize', 'fontWeight', 'color']]
      ];
      for (const width of [1440, 768, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await prototype.setViewportSize({ width, height: 1000 });
        for (const [actualSelector, expectedSelector, properties] of pairs) {
          const read = (target, selector) => target.locator(selector).first().evaluate((element, properties) => {
            const style = getComputedStyle(element);
            return Object.fromEntries(properties.map(property => [property, style[property]]));
          }, properties);
          const actual = await read(page, actualSelector), expected = await read(prototype, expectedSelector);
          visualComparisons.push({ width, selector: actualSelector, actual, expected });
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, 'p09-version-v2-' + width + '.png'), fullPage: true });
      }
      await prototype.close();
      fs.writeFileSync(path.join(output, 'p09-v2-comparison.json'), JSON.stringify(visualComparisons, null, 2));
      for (const comparison of visualComparisons) assert.deepEqual(comparison.actual, comparison.expected, comparison.width + 'px ' + comparison.selector);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.version-rail-toggle').click();
    assert.equal(await page.locator('.version-rail-list').isVisible(), false);
    await page.locator('.version-rail-toggle').click();
    assert.equal(await page.locator('.version-rail-list').isVisible(), true);
    await page.screenshot({ path: path.join(output, 'p09-version-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 768, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, 'p09-version-tablet.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.task-summary').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('region', { name: '任务详情列表', exact: true }).waitFor();
    const firstTask = page.getByRole('region', { name: '任务详情列表', exact: true }).locator('tbody tr').first();
    assert.equal(await firstTask.locator('td').nth(0).locator('a').innerText(), 'Viking-107542');
    assert.equal(await firstTask.locator('td').nth(3).innerText(), 'Viking-107541');
    assert.equal(await firstTask.locator('td').nth(1).innerText(), '测试任务 0');
    await page.getByLabel('搜索编号或标题').fill('Viking-107542');
    await page.waitForFunction(() => document.querySelector('.count-line').textContent.includes('当前筛选显示 1 张'));
    await page.getByLabel('搜索编号或标题').fill('');
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, 'p09-version-expanded-' + width + '.png') });
    }
    await page.screenshot({ path: path.join(output, 'p09-version-expanded.png') });
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.waitForFunction(() => location.hash.includes('offset=100') && document.querySelector('.count-line')?.textContent.includes('本页 1 张'));
    await page.getByRole('region', { name: '任务详情列表', exact: true }).locator('tbody tr').first().click();
    await page.locator('.task-panel').waitFor();
    assert.equal(await page.locator('.panel-title').innerText(), '测试任务 100');
    assert.equal(await drawerFact(page.locator('.task-panel'), '来源可用性').innerText(), '本次可读');
    assert.match(await drawerFact(page.locator('.task-panel'), '最近同步').innerText(), /2026.*11.*26.*15:25/);
    await page.reload();
    await page.locator('.task-panel').waitFor();
    assert.equal(await page.locator('.panel-title').innerText(), '测试任务 100');
    assert.match(page.url(), /offset=100&task=task-100/);
    assert.match(await page.locator('.task-panel').innerText(), /Viking-107642/);
    assert.equal(await page.locator('.version-tasks').evaluate(element => element.open), true);
    await page.getByRole('link', { name: '需求', exact: true }).click();
    await page.locator('.requirement-overview').waitFor();
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('version-page')), false);
    assert.match(await page.locator('.requirement-overview').innerText(), /测试核心需求/);
    assert.equal(await page.locator('.requirement-timeline-row').count(), 2);
    assert.equal(await page.locator('.requirement-work-card').count(), 1);
    assert.equal(await page.locator('body').evaluate(element => element.classList.contains('requirement-page')), true);
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily), /Plus Jakarta Sans/);
    assert.equal(await page.locator('.requirement-day').count(), 9);
    assert.equal(await page.locator('.requirement-actual-bar').count(), 2);
    assert.equal(await page.locator('.requirement-actual-bar i').count(), 1);
    assert.match(await page.locator('.requirement-timeline-label').first().innerText(), /估：.*实：/s);
    assert.equal(await page.locator('.requirement-actual-bar').first().evaluate(element => getComputedStyle(element).height), '4px');
    assert.equal(await page.locator('.requirement-day.special').count(), 1);
    assert.equal(await page.locator('.requirement-day.rest').count(), 2);
    const calendarComparison = [];
    let v2Requirement;
    if (process.env.VIKINGPM_V2_ORIGIN) {
      v2Requirement = await browser.newPage(); v2Requirement.setDefaultTimeout(5000);
      await v2Requirement.goto(process.env.VIKINGPM_V2_ORIGIN);
      await v2Requirement.locator('.side [data-page="versions"]').click();
      await v2Requirement.locator('.version-requirement-link').first().click();
      await v2Requirement.locator('.req-overview').waitFor();
      await v2Requirement.mouse.move(0, 0);
      await v2Requirement.evaluate(() => document.fonts.ready);
    }
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const scroll = page.locator('.requirement-timeline');
      const labelLeft = await page.locator('.requirement-timeline-label').first().evaluate(element => element.getBoundingClientRect().left);
      await scroll.evaluate(element => element.scrollLeft = 200);
      assert.ok(Math.abs(labelLeft - await page.locator('.requirement-timeline-label').first().evaluate(element => element.getBoundingClientRect().left)) < 1);
      await scroll.evaluate(element => element.scrollLeft = 0);
      await page.screenshot({ path: path.join(output, 'p09-requirement-v2-' + width + '.png'), fullPage: true });
      if (v2Requirement) {
        await v2Requirement.setViewportSize({ width, height: 1000 });
        const pairs = [
          ['body', 'body', ['fontFamily', 'fontSize', 'fontSynthesis']],
          ['.content', '.detail-page', ['padding', 'backgroundColor']],
          ['.requirement-title', '.req-overview h1', ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color']],
          ['.requirement-overview', '.req-overview', ['padding', 'gap', 'borderRadius', 'borderColor', 'boxShadow']],
          ['.requirement-meta', '.req-meta', ['fontSize', 'lineHeight', 'color']],
          ['.requirement-tags', '.req-tags', ['gap', 'marginTop']],
          ['.requirement-overview-fact b', '.req-fact b', ['fontSize', 'lineHeight', 'fontWeight', 'color']],
          ['.requirement-timeline-card', '.gantt-v2', ['padding', 'borderRadius', 'borderColor', 'boxShadow']],
          ['.requirement-timeline-label', '.gantt-v2-label', ['padding', 'position', 'backgroundColor']],
          ['.requirement-actual-bar.active', '.gantt-v2-actual.doing', ['height', 'top', 'borderRadius', 'backgroundColor']],
          ['.requirement-work-name', '.work-name', ['fontSize', 'lineHeight', 'fontWeight', 'color']],
          ['.requirement-work-card', '.work-card', ['padding', 'borderRadius', 'minHeight', 'borderColor', 'boxShadow']]
        ];
        for (const [actualSelector, expectedSelector, properties] of pairs) {
          const read = (target, selector) => target.locator(selector).first().evaluate((element, properties) => {
            const style = getComputedStyle(element); return Object.fromEntries(properties.map(property => [property, style[property]]));
          }, properties);
          calendarComparison.push({ width, selector: actualSelector, actual: await read(page, actualSelector), expected: await read(v2Requirement, expectedSelector) });
        }
      }
    }
    await v2Requirement?.close();
    fs.writeFileSync(path.join(output, 'p09-requirement-comparison.json'), JSON.stringify(calendarComparison, null, 2));
    for (const row of calendarComparison) assert.deepEqual(row.actual, row.expected, row.width + 'px ' + row.selector);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(output, 'p09-requirement-desktop.png'), fullPage: true });

    const timelineTask = page.locator('.requirement-timeline-row').first();
    await timelineTask.click();
    const taskDrawer = page.getByRole('dialog', { name: '任务详情', exact: true });
    await taskDrawer.waitFor();
    assert.equal(await taskDrawer.locator('.panel-title').innerText(), 'ui');
    assert.equal(await drawerFact(taskDrawer, '来源可用性').innerText(), '本次可读');
    assert.match(await drawerFact(taskDrawer, '最近同步').innerText(), /2026.*11.*27.*10:48/);
    assert.equal(await drawerFact(taskDrawer, '到期判断').innerText(), '已完成，无需到期提醒');
    assert.doesNotMatch(await taskDrawer.innerText(), /不在当前分页|计算事实未提供/);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await taskDrawer.evaluate(element => element.scrollWidth > element.clientWidth), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, 'p09-task-facts-' + width + '.png') });
    }


    await taskDrawer.getByRole('button', { name: '来源动态', exact: true }).click();
    await taskDrawer.getByText('当前没有来源动态记录。', { exact: true }).waitFor();
    await taskDrawer.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await timelineTask.evaluate(element => document.activeElement === element), true);
    for (const key of ['Enter', 'Space']) {
      await timelineTask.press(key);
      await taskDrawer.waitFor();
      await page.keyboard.press('Escape');
      await taskDrawer.waitFor({ state: 'detached' });
      assert.equal(await timelineTask.evaluate(element => document.activeElement === element), true);
    }


    // Fact-only drawers must distinguish terminal states from missing data.
    const detailCases = [
      { semantic: 'non_delivery', sourcePresence: 'archived', due: null, presence: '来源已归档', dueText: '已结束，无需到期提醒' },
      { semantic: 'developing', sourcePresence: 'current', due: { overdue: true, workingDays: 2 }, presence: '本次可读', dueText: '已逾期 2 个工作日' },
      { semantic: 'developing', sourcePresence: 'current', due: { overdue: false, dueSoon: true }, presence: '本次可读', dueText: '3 个工作日内到期' },
      { semantic: 'developing', sourcePresence: 'current', due: { overdue: false }, presence: '本次可读', dueText: '未逾期' },
      { semantic: 'developing', sourcePresence: null, due: null, presence: '待核对', dueText: '不可判断', lastSyncedAt: null }
    ];
    for (const entry of detailCases) {
      await page.route('**/api/management/versions/*', async route => {
        const data = management(0); data.items = data.items.map(item => item.id === 'ui' ? { ...item, ...entry } : item);
        await route.fulfill({ json: data });
      });
      await page.reload(); await page.locator('.requirement-timeline-row').filter({ has: page.locator('b', { hasText: /^ui$/ }) }).click();
      await taskDrawer.waitFor();
      assert.equal(await drawerFact(taskDrawer, '来源可用性').innerText(), entry.presence);
      assert.equal(await drawerFact(taskDrawer, '到期判断').innerText(), entry.dueText);
      if (entry.lastSyncedAt === null) assert.equal(await drawerFact(taskDrawer, '最近同步').innerText(), '尚无记录');
      assert.doesNotMatch(await taskDrawer.innerText(), /不在当前分页|计算事实未提供/);
      await taskDrawer.getByRole('button', { name: '关闭', exact: true }).click();
      await page.unroute('**/api/management/versions/*');
    }

    await page.goto(origin + '/?scenario=actual-timeline#/requirements?version=' + versionIds[0] + '&requirement=root');
    await page.locator('.requirement-timeline-row').first().waitFor();
    assert.equal(await page.locator('.requirement-day').count(), 10, 'Actual time extends the shared calendar, future actual starts do not');
    assert.equal(await page.locator('.requirement-actual-bar').count(), 4);
    assert.equal(await page.locator('.requirement-actual-bar i').count(), 1);
    const expected = {
      'single-day': ['2026-11-23', '2026-11-23'], unplanned: ['2026-11-18', '2026-11-27'],
      reopened: ['2026-11-19', '2026-11-27'], testing: ['2026-11-25', '2026-11-27']
    };
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const result = await page.locator('.requirement-timeline').evaluate((element, expected) => {
        const days = [...element.querySelectorAll('.requirement-day')];
        return [...element.querySelectorAll('.requirement-timeline-row')].map(row => {
          const title = row.querySelector('b').textContent, actual = row.querySelector('.requirement-actual-bar'), plan = row.querySelector('.requirement-bar');
          const dates = expected[title];
          const rect = actual?.getBoundingClientRect(), track = row.querySelector('.requirement-track').getBoundingClientRect();
          const startIndex = dates ? Math.round((Date.parse(dates[0]) - Date.parse('2026-11-18')) / 86400000) : -1;
          const endIndex = dates ? Math.round((Date.parse(dates[1]) - Date.parse('2026-11-18')) / 86400000) : -1;
          const expectedLeft = startIndex >= 0 ? days[startIndex].getBoundingClientRect().left : null;
          const expectedRight = endIndex >= 0 ? days[endIndex].getBoundingClientRect().right : null;
          return { title, label: row.querySelector('.requirement-timeline-label').textContent, actual: !!actual, plan: !!plan,
            leftDelta: rect ? Math.abs(rect.left - expectedLeft) : null, rightDelta: rect ? Math.abs(rect.right - expectedRight) : null,
            height: rect?.height, top: rect ? rect.top - track.top : null, minHeight: row.getBoundingClientRect().height,
            planLeft: plan ? Math.abs(plan.getBoundingClientRect().left - days[2].getBoundingClientRect().left) : null,
            planRight: plan ? Math.abs(plan.getBoundingClientRect().right - days[4].getBoundingClientRect().right) : null,
            tone: actual ? getComputedStyle(actual).backgroundColor : null,
            pendingColor: getComputedStyle(row.querySelector('.gantt-actual-label')).color };
        });
      }, expected);
      for (const row of result) {
        if (expected[row.title]) {
          assert.equal(row.actual, true, row.title);
          assert.ok(row.leftDelta < 1 && row.rightDelta < 1, width + 'px strict date alignment: ' + JSON.stringify(row));
          assert.equal(row.height, 4);
          assert.equal(row.top, 51);
          assert.ok(row.minHeight >= 76);
        } else assert.equal(row.actual, false, row.title + ' must not invent actual times');
        if (row.plan) assert.ok(row.planLeft < 1 && row.planRight < 1, 'Planned date endpoints must stay fixed: ' + row.title);
      }
      const byTitle = Object.fromEntries(result.map(row => [row.title, row]));
      assert.equal(byTitle.unplanned.plan, false);
      assert.match(byTitle.unplanned.label, /估：未配置/);
      assert.match(byTitle.reopened.label, /已进行 4.5 工作日/);
      assert.match(byTitle.testing.label, /实：11.25 - /);
      assert.match(byTitle.pending.label, /实：未开始/);
      assert.match(byTitle['future-today'].label, /实：未开始/);
      assert.equal(byTitle.pending.pendingColor, 'rgb(152, 162, 179)');
      assert.match(byTitle['unknown-time'].label, /实：实际时间不可判断/);
      assert.equal(byTitle['single-day'].tone, 'rgb(112, 169, 141)');
      assert.equal(byTitle.reopened.tone, 'rgb(109, 136, 194)');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, 'p09-actual-timeline-' + width + '.png'), fullPage: true });
      await page.locator('.requirement-timeline-row').first().click();
      const drawer = page.getByRole('dialog', { name: '任务详情', exact: true });
      await drawer.waitFor();
      const bounds = await drawer.evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, overflow: element.scrollWidth > element.clientWidth }; });
      assert.ok(bounds.left >= 0 && bounds.right <= width && !bounds.overflow, width + 'px task drawer');
      await page.screenshot({ path: path.join(output, 'p09-actual-task-drawer-' + width + '.png') });
      await page.keyboard.press('Escape');
      await drawer.waitFor({ state: 'detached' });
    }

    await page.goto(origin + '/#/requirements?version=' + versionIds[0] + '&requirement=root');
    await page.locator('.requirement-timeline-row').first().click();
    await page.getByRole('button', { name: '查看实际时间记录', exact: true }).click();
    await page.locator('.actual-time-dialog .actual-time-history').waitFor();
    assert.equal(await page.getByRole('button', { name: '预览修改', exact: true }).count(), 0);
    assert.equal(await page.locator('.actual-time-dialog textarea').count(), 0);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.route('**/api/status', route => route.fulfill({ json: { pollingEnabled: false } }));
    await page.reload(); await page.locator('.requirement-timeline-row').first().click();
    assert.equal(await page.getByRole('button', { name: '查看实际时间记录', exact: true }).isDisabled(), true);
    assert.match(await page.getByRole('dialog', { name: '任务详情', exact: true }).innerText(), /实际时间修正尚未启用/); await page.keyboard.press('Escape');
    await page.route('**/api/status', route => { expectedHttpFailures.set(route.request().url(), 401); return route.fulfill({ status: 401, json: { error: '登录已过期' } }); });
    await page.reload(); await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#app').isVisible(), false);
    await page.route('**/api/status', route => route.fulfill({ json: { pollingEnabled: false, actualTimeEditing: true, actualTimeBatch: true } }));
    await page.reload(); await page.locator('.requirement-timeline-row').first().waitFor();


    await page.goto(origin + '/#/action');
    await page.locator('.action-grid').waitFor();
    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto(origin + '/#/versions/' + versionIds[0]);
    await page.locator('.version-workspace').waitFor();
    assert.equal(await page.locator('.version-tasks').evaluate(element => element.open), false);
    await page.screenshot({ path: path.join(output, 'p09-version-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.task-summary').click();
    await page.getByRole('region', { name: '任务详情列表', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, 'p09-version-mobile-expanded.png') });
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
    await page.locator('.config-v2-nav').filter({ hasText: '状态语义' }).click();
    await page.getByRole('region', { name: '状态语义映射', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '编辑映射', exact: true }).isVisible(), false);
    assert.equal(await page.locator('.status-context').count(), 1);
    assert.equal(await page.locator('.status-summary .tag').count(), 3);
    assert.equal(await page.locator('.status-table').count(), 1);
    await page.getByRole('button', { name: '影响与恢复', exact: true }).click();
    assert.equal(await page.locator('.status-current-card').count(), 1);
    assert.equal(await page.locator('.status-recovery-grid').count(), 1);
    assert.equal(await page.locator('.status-pending-card').count(), 1);
    assert.equal(await page.locator('.status-verification-card').count(), 1);
    await page.getByRole('button', { name: '状态映射', exact: true }).click();
    await page.locator('.config-v2-nav').filter({ hasText: '人员与通知' }).click();
    assert.match(await page.locator('.config-content').innerText(), /当前身份：测试用户/);

    await page.route('**/api/management/versions/*', async route => {
      const index = versionIds.indexOf(new URL(route.request().url()).pathname.split('/').at(-1));
      if (index) expectedHttpFailures.set(route.request().url(), 503);
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
    await page.route('**/api/me', route => {
      expectedHttpFailures.set(route.request().url(), 401);
      return route.fulfill({ status: 401, json: { error: '登录已过期' } });
    });
    await page.reload();
    await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#app').isVisible(), false);
    await page.route('**/api/me', route => route.fulfill({ json: { id: 'owner', displayName: '测试所有者', role: 'owner', csrf: 'fake-csrf' } }));
    await page.route('**/api/management/versions/*', route => route.fulfill({ json: management(versionIds.indexOf(new URL(route.request().url()).pathname.split('/').at(-1))) }));
    const openActual = async () => {
      await page.goto(origin + '/#/requirements?version=' + versionIds[0] + '&requirement=root');
      await page.locator('.requirement-timeline-row').first().click();
      await page.getByRole('button', { name: '修改实际时间', exact: true }).click();
      await page.locator('.actual-time-dialog .actual-time-history').waitFor();
    };
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await openActual();
      const editor = page.locator('.actual-time-dialog');
      await editor.getByLabel('实际开始时间处理方式', { exact: true }).selectOption('date');
      await editor.getByLabel('实际开始日期', { exact: true }).fill('2026-12-01');
      await editor.getByLabel('实际开始时分', { exact: true }).fill('09:30');
      assert.equal(await editor.getByLabel('实际开始日期', { exact: true }).getAttribute('max'), null);
      await editor.getByLabel('计时阶段', { exact: true }).selectOption('test');
      await editor.getByLabel('计时阶段', { exact: true }).selectOption('development');
      assert.equal(await editor.getByLabel('实际开始日期', { exact: true }).inputValue(), '2026-12-01');
      assert.equal(await editor.getByLabel('实际开始时分', { exact: true }).inputValue(), '09:30');
      assert.equal(await editor.getByLabel('依据', { exact: true }).count(), 0);
      const headBefore = await editor.locator('.actual-time-head').boundingBox();
      await editor.locator('.actual-time-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
      const headAfter = await editor.locator('.actual-time-head').boundingBox(); assert.equal(headBefore.y, headAfter.y);
      assert.equal(await editor.evaluate(element => element.scrollWidth > element.clientWidth), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, 'p09-actual-time-editor-' + width + '.png') });
      await editor.getByRole('button', { name: '取消', exact: true }).click(); await page.keyboard.press('Escape');
    }
    assert.equal(actualWrites.length, 0, 'Cancel must not persist edits');
    await openActual();
    const actualEditor = page.locator('.actual-time-dialog');
    const prepareActual = async (start, end) => {
      await actualEditor.getByLabel('实际开始时间处理方式', { exact: true }).selectOption('date'); await actualEditor.getByLabel('实际开始日期', { exact: true }).fill(start); await actualEditor.getByLabel('实际开始时分', { exact: true }).fill('09:30');
      if (end) { await actualEditor.getByLabel('实际结束时间处理方式', { exact: true }).selectOption('date'); await actualEditor.getByLabel('实际结束日期', { exact: true }).fill(end); await actualEditor.getByLabel('实际结束时分', { exact: true }).fill('18:15'); }
      await actualEditor.getByLabel('修改原因', { exact: true }).fill('人工核对开始');
      await actualEditor.getByRole('button', { name: '预览修改', exact: true }).click(); await actualEditor.locator('.actual-time-preview').waitFor();
    };
    await prepareActual('2026-11-18'); rejectActualSave = true;
    await actualEditor.getByRole('button', { name: '确认保存', exact: true }).click();
    await actualEditor.getByRole('alert').waitFor({ state: 'visible' }); assert.match(await actualEditor.innerText(), /来源或修正记录已变化/);
    await actualEditor.getByRole('button', { name: '重新读取并核对', exact: true }).click(); await actualEditor.locator('.actual-time-history').waitFor();
    await prepareActual('2026-11-18'); await actualEditor.getByRole('button', { name: '确认保存', exact: true }).click(); await actualEditor.waitFor({ state: 'detached' });
    await page.locator('.requirement-timeline-row').first().waitFor();
    assert.equal(actualWrites.at(-1).changes[0].fields.end.mode, 'inherit'); assert.equal(actualWrites.at(-1).changes[0].stage, 'development');
    assert.match(await page.locator('.requirement-timeline-row').first().innerText(), /实：11.18 - 11.24.*已完成 [\d.]+ 个工作日/);
    await page.locator('.requirement-timeline-row').first().click(); await page.getByRole('button', { name: '修改实际时间', exact: true }).click(); await actualEditor.locator('.actual-time-history').waitFor();
    await prepareActual('2026-12-01', '2026-12-03'); await actualEditor.getByRole('button', { name: '确认保存', exact: true }).click(); await actualEditor.waitFor({ state: 'detached' });
    await page.locator('.requirement-timeline-row').first().waitFor(); assert.equal(await page.locator('.requirement-timeline-row').first().locator('.requirement-actual-bar').count(), 0);
    await page.locator('.requirement-timeline-row').first().click(); await page.getByRole('button', { name: '修改实际时间', exact: true }).click(); await actualEditor.locator('.actual-time-history').waitFor();
    await actualEditor.getByLabel('修改原因', { exact: true }).fill('恢复来源');
    await actualEditor.getByRole('button', { name: '恢复使用 TB 时间', exact: true }).click(); await actualEditor.getByRole('button', { name: '确认保存', exact: true }).click(); await actualEditor.waitFor({ state: 'detached' });
    await page.locator('.requirement-timeline-row').first().waitFor(); assert.equal(await page.locator('.requirement-timeline-row').first().locator('.requirement-actual-bar').count(), 1);

    actualRecords = [{ id: 'pending-record', stage: 'development', anchors: ['missing-old-round'], fields: { start: { mode: 'date', value: '2026-11-18', source: null } }, revision: 1, last_valid: { start: '2026-11-18', end: '2026-11-24' } }];
    await openActual(); assert.match(await actualEditor.innerText(), /来源轮次发生变化/);
    await actualEditor.getByLabel('重新关联目标轮次', { exact: true }).selectOption('source-start');
    await actualEditor.getByRole('checkbox').check();
    await actualEditor.getByLabel('修改原因', { exact: true }).fill('核对历史轮次');
    await actualEditor.getByRole('button', { name: '预览修改', exact: true }).click(); await actualEditor.getByRole('button', { name: '确认保存', exact: true }).click(); await actualEditor.waitFor({ state: 'detached' });
    assert.equal(actualWrites.at(-1).changes[0].rebind, true); assert.equal(actualWrites.at(-1).changes[0].roundKey, 'source-start');
    actualRecords[0].fields.start.source = '2026-11-17';
    await openActual(); assert.match(await actualEditor.innerText(), /来源时间有变化，待核对/);
    await actualEditor.getByLabel('修改原因', { exact: true }).fill('保留核实结果');
    await actualEditor.getByRole('button', { name: '保留人工修正', exact: true }).click(); await actualEditor.getByRole('button', { name: '确认保存', exact: true }).click(); await actualEditor.waitFor({ state: 'detached' }); assert.equal(actualWrites.at(-1).changes[0].resolution, 'keep');
    actualRecords = []; Object.assign(facts[1], actualFact());
    const originalActualSource = structuredClone(actualSource);
    actualSource.development.rounds.push(
      { start: '2026-11-25T02:00:00Z', end: '2026-11-25T03:00:00Z', anchors: ['second-start', 'second-end'], hours: 1, workingDays: 0.2 },
      { start: '2026-11-26T02:00:00Z', end: '2026-11-26T03:00:00Z', anchors: ['third-start', 'third-end'], hours: 1, workingDays: 0.2 }
    );
    await openActual();
    const writesBeforeBatch = actualWrites.length;
    await actualEditor.getByLabel('计时轮次', { exact: true }).selectOption('source-start');
    await actualEditor.getByLabel('实际开始时间处理方式', { exact: true }).selectOption('date');
    await actualEditor.getByLabel('实际开始日期', { exact: true }).fill('2026-11-18'); await actualEditor.getByLabel('实际开始时分', { exact: true }).fill('09:15');
    await actualEditor.getByLabel('计时轮次', { exact: true }).selectOption('second-start');
    await actualEditor.getByLabel('实际结束时间处理方式', { exact: true }).selectOption('date');
    await actualEditor.getByLabel('实际结束日期', { exact: true }).fill('2026-11-25'); await actualEditor.getByLabel('实际结束时分', { exact: true }).fill('12:45');
    await actualEditor.getByLabel('计时轮次', { exact: true }).selectOption('third-start');
    await actualEditor.getByLabel('实际开始时间处理方式', { exact: true }).selectOption('date');
    await actualEditor.getByLabel('实际开始日期', { exact: true }).fill('2026-11-26'); await actualEditor.getByLabel('实际开始时分', { exact: true }).fill('09:40');
    await actualEditor.getByLabel('计时阶段', { exact: true }).selectOption('test');
    await actualEditor.getByLabel('实际开始时间处理方式', { exact: true }).selectOption('date');
    await actualEditor.getByLabel('实际开始日期', { exact: true }).fill('2026-11-27'); await actualEditor.getByLabel('实际开始时分', { exact: true }).fill('15:30');
    await actualEditor.getByLabel('计时阶段', { exact: true }).selectOption('development');
    await actualEditor.getByLabel('计时轮次', { exact: true }).selectOption('source-start');
    assert.equal(await actualEditor.getByLabel('实际开始时分', { exact: true }).inputValue(), '09:15');
    await actualEditor.getByLabel('修改原因', { exact: true }).fill('统一核对多轮时间');
    assert.match(await actualEditor.innerText(), /已修改 4 个轮次/);
    await actualEditor.getByRole('button', { name: '预览修改', exact: true }).click();
    assert.equal(await actualEditor.locator('.actual-time-preview-round').count(), 4);
    await actualEditor.getByRole('button', { name: '确认保存', exact: true }).click(); await actualEditor.waitFor({ state: 'detached' });
    assert.equal(actualWrites.length - writesBeforeBatch, 1); assert.equal(actualWrites.at(-1).changes.length, 4); assert.equal(actualWrites.at(-1).reason, '统一核对多轮时间');
    assert.ok(actualWrites.at(-1).changes.some(c => c.stage === 'test')); assert.equal(actualRecords.length, 4);
    actualRecords = []; Object.assign(actualSource, originalActualSource); Object.assign(facts[1], actualFact());
    const peopleRecords = [{ id: 'owner', displayName: '测试所有者', role: 'owner', active: true, mappingEnabled: true, confirmed: true }, { id: 'person-a', displayName: '测试查看者', role: 'viewer', active: true, mappingEnabled: true, confirmed: true }];
    const permissionWrites = [], identityWrites = [], identityStateWrites = [];
    await page.route('**/api/access', route => route.fulfill({ json: peopleRecords }));
    await page.route('**/api/access/*', async route => {
      assert.equal(route.request().method(), 'PATCH');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      const input = route.request().postDataJSON(); permissionWrites.push(input);
      peopleRecords[1].role = input.role; await route.fulfill({ json: peopleRecords[1] });
    });
    await page.route('**/api/identities/*', async route => {
      assert.equal(route.request().method(), 'PATCH');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      const input = route.request().postDataJSON(); identityStateWrites.push(input);
      Object.assign(peopleRecords[1], { active: input.active, mappingEnabled: input.mappingEnabled });
      await route.fulfill({ json: peopleRecords[1] });
    });
    await page.route('**/api/identities', async route => {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      identityWrites.push(route.request().postDataJSON()); await route.fulfill({ json: { id: 'new-fake-person', role: 'none' } });
    });
    await page.route('**/api/audit', route => route.fulfill({ json: [{ id: '1', action: 'management.calendar', reason: '隔离验证', occurred_at: '2026-11-23T02:00:00Z', before_value: null, after_value: { working: true } }] }));
    const syncCalls = [];
    await page.route('**/api/versions/*/sync', async route => {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      assert.equal(route.request().postDataJSON().reason, '顶部按钮手动获取最新 TB 工单状态');
      syncCalls.push(new URL(route.request().url()).pathname.split('/').at(-2));
      await route.fulfill({ json: { status: 'succeeded', importedCount: 6, issueCount: 0 } });
    });
    const feedbackCalls = [];
    let feedbackMode = 'success';
    await page.route('**/api/feedback/versions/*', route => route.fulfill({ json: { sources: feedbackMode === 'no-source' ? [] : [{ id: 'enabled-source', enabled: true }, { id: 'disabled-source', enabled: false }] } }));
    await page.route('**/api/feedback/read', async route => {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      const input = route.request().postDataJSON();
      assert.equal(input.sourceId, 'enabled-source');
      assert.equal(input.reason, '顶部按钮手动获取最新反馈并核对当前 TB 事实');
      feedbackCalls.push(input);
      await wait(100);
      const failed = feedbackMode === 'failed' || (feedbackMode === 'partial' && input.versionId === versionIds[1]);
      if (failed) expectedHttpFailures.set(route.request().url(), 503);
      await route.fulfill(failed ? { status: 503, json: { error: '测试反馈来源读取失败；未导入本轮记录' } } : { json: { readCount: 3 } });
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
      assert.ok(['calendar', 'rules'].includes(input.kind));
      if (input.kind === 'calendar' && input.values.working === false) assert.deepEqual(input.values.intervals, [], 'Holiday preview must omit hidden work intervals');
      const before = { foundation: { value: ['UI界面', '客户端'], source: 'system' }, detail: { value: ['UI图标'], source: 'system' }, schedules: { value: [{ day: 2, time: '10:00' }], source: 'system' }, concurrency: { value: 3, source: 'system' } };
      const after = { ...before };
      if (input.kind === 'rules') for (const [key, value] of Object.entries(input.values)) after[key] = { value, source: input.scope };
      await route.fulfill({ json: { revision: 1, previewToken: 'fake-preview', affected: { versionCount: 2, taskCount: 101 }, before: input.kind === 'rules' ? before : {}, after: input.kind === 'rules' ? after : input.values } });
    });
    await page.route('**/api/management/save', async route => {
      assert.equal(route.request().method(), 'POST');
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      const input = route.request().postDataJSON();
      assert.equal(input.previewToken, 'fake-preview');
      assert.equal(input.confirmed, true);
      assert.equal(input.expectedRevision, 1);
      if (input.kind === 'calendar') {
        if (input.values.working === false) assert.deepEqual(input.values.intervals, [], 'Holiday save must omit hidden work intervals');
        calendarFixture[input.values.day] = input.values;
      }
      saved++;
      if (input.kind === 'rules') configRules = [{ scope: input.scope, scope_key: input.scopeKey, values: input.values }];
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
    assert.equal(await page.locator('#feedback-sync').isVisible(), true);
    assert.equal(await page.locator('#tb-sync + #feedback-sync').count(), 1);
    await page.getByRole('button', { name: '获取最新反馈', exact: true }).click();
    assert.equal(await page.locator('#tb-sync').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#feedback-sync').disabled);
    assert.deepEqual(feedbackCalls.map(c=>c.versionId), [versionIds[0]]);
    assert.match(await page.locator('#message').innerText(), /已获取最新反馈：1\/1 个版本完成/);
    await page.selectOption('#version-select', '');
    await page.getByRole('button', { name: '获取最新反馈', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#feedback-sync').disabled);
    assert.deepEqual(feedbackCalls.map(c=>c.versionId), [versionIds[0],...versionIds]);
    assert.match(await page.locator('#message').innerText(), /2\/2 个版本完成/);
    feedbackMode = 'partial';
    await page.getByRole('button', { name: '获取最新反馈', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#feedback-sync').disabled);
    assert.match(await page.locator('#message').innerText(), /未全部完成：1\/2 个版本完成/);
    assert.match(await page.locator('#message').innerText(), /测试反馈来源读取失败/);
    await page.selectOption('#version-select', versionIds[0]);
    feedbackMode = 'no-source';
    const beforeMissing = feedbackCalls.length;
    await page.getByRole('button', { name: '获取最新反馈', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#feedback-sync').disabled);
    assert.equal(feedbackCalls.length,beforeMissing);
    assert.match(await page.locator('#message').innerText(), /未配置可用反馈来源/);
    feedbackMode = 'success';
    for (const width of [375,768,1440]) {
      await page.setViewportSize({width,height:1000});
      for (const hash of ['#/action','#/versions/'+versionIds[0],'#/requirements?version='+versionIds[0]+'&requirement=root']) {
        await page.goto(origin+hash); await page.locator(hash.startsWith('#/action')?'.action-grid':hash.startsWith('#/versions')?'.version-workspace':'.requirement-overview').waitFor();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,width+'px feedback toolbar '+hash);
        assert.equal(await page.locator('#tb-sync').isDisabled(),false);
        assert.equal(await page.locator('#feedback-sync').isDisabled(),false);
        const buttons=await page.locator('#source-sync-controls').evaluate(element=>[...element.querySelectorAll('button')].map(button=>({top:button.getBoundingClientRect().top,left:button.getBoundingClientRect().left,right:button.getBoundingClientRect().right})));
        assert.ok(Math.abs(buttons[0].top-buttons[1].top)<1,width+'px refresh buttons stay on the same row');
        assert.ok(buttons[0].right<=buttons[1].left,width+'px refresh buttons do not overlap');
      }
      await page.screenshot({path:path.join(output,'p09-feedback-toolbar-'+width+'.png'),fullPage:true});
    }

    await page.getByRole('link', { name: '配置库', exact: true }).click();
    await page.locator('.config-layout').waitFor();
    assert.equal(await page.locator('.version-scope-panel').count(), 1);
    assert.equal(await page.locator('.version-scope-table').count(), 1);
    assert.match(await page.locator('.version-scope-panel').innerText(), /已纳入/);
    assert.equal(await page.locator('.version-scope-table .status.ok').count(), 2);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, width + 'px version scope has no page overflow');
      assert.equal(await page.locator('.version-scope-table-wrap').evaluate(element => element.scrollWidth >= element.clientWidth), true, width + 'px version scope table keeps bounded scroll');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '工作日历', exact: true }).click();
    assert.equal(await page.locator('.cal-layout').count(), 1);
    assert.equal(await page.locator('.cal-legend').getByText('工作日', { exact: true }).count(), 1);
    assert.equal(await page.locator('.cal-legend').getByText('周末', { exact: true }).count(), 1);
    assert.equal(await page.locator('.cal-legend').getByText('节假日', { exact: true }).count(), 1);
    assert.equal(await page.locator('.cal-legend').getByText('补班', { exact: true }).count(), 1);
    assert.equal(await page.locator('.cal-layout').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await page.getByRole('button', { name: '编辑日期', exact: true }).click();
    const calendarTypes = await page.locator('#mg-calendar-working option').allTextContents();
    assert.ok(calendarTypes.includes('节假日'));
    assert.ok(calendarTypes.includes('补班（工作日）'));
    await page.locator('#mg-calendar-intervals input[aria-label="时段开始"]').first().fill('');
    await page.locator('#mg-calendar-working').selectOption('false');
    assert.equal(await page.locator('#mg-calendar-interval-fields').isHidden(), true);
    assert.equal(await page.locator('#mg-calendar-intervals input').first().isDisabled(), true);
    assert.equal(await page.locator('#mg-calendar-interval-note').isVisible(), true);
    await page.locator('#mg-calendar-working').selectOption('true');
    assert.equal(await page.locator('#mg-calendar-interval-fields').isHidden(), false);
    assert.equal(await page.locator('#mg-calendar-intervals input').first().isDisabled(), false);
    await page.locator('#mg-calendar-working').selectOption('false');
    await page.locator('#mg-calendar-day').fill('2026-11-27');
    await page.locator('#mg-calendar-reason').fill('隔离直接保存验证');
    await page.locator('#mg-calendar-save').click();
    await page.waitForFunction(() => document.querySelector('#mg-feedback').textContent.includes('保存成功'));
    assert.equal(await page.locator('#mg-review[open]').count(), 0, 'Direct calendar save must not open review dialog');
    assert.equal(saved, 1);
    await page.getByRole('button', { name: '编辑日期', exact: true }).click();
    await page.locator('#mg-calendar-day').fill('2026-11-28');
    await page.locator('#mg-calendar-reason').fill('隔离浏览器验证');
    await page.locator('#mg-calendar-form button[type=submit]').click();
    await page.locator('#mg-review[open]').waitFor();
    await page.locator('#mg-save').click();
    await page.waitForFunction(() => document.querySelector('#mg-feedback').textContent.includes('保存成功'));
    assert.equal(saved, 2);
    await page.screenshot({ path: path.join(output, 'p09-config.png'), fullPage: true });
    await page.getByRole('button', { name: '规则设置', exact: true }).click();
    assert.equal(await page.locator('#mg-rules-form').isVisible(), false);
    assert.match(await page.locator('.config-rule-summary').innerText(), /进度完成条件/);
    assert.equal(await page.locator('.config-rule-scope-buttons button').count(), 3);
    assert.equal(await page.locator('.config-rule-scope-buttons button[aria-pressed="true"]').innerText(), '系统默认');
    await page.getByRole('button', { name: '版本覆盖', exact: true }).click();
    assert.equal(await page.locator('#mg-scope').inputValue(), 'version');
    assert.equal(await page.locator('.config-rule-scope-buttons button[aria-pressed="true"]').innerText(), '版本覆盖');
    await page.getByRole('button', { name: '系统默认', exact: true }).click();
    assert.equal(await page.locator('#mg-scope').inputValue(), 'system');
    await page.screenshot({ path: path.join(output, 'p09-rules-v2.png'), fullPage: true });
    await page.getByRole('button', { name: '编辑配置', exact: true }).click();
    await page.locator('[data-rule-field="foundation"]').getByLabel('客户端', { exact: true }).uncheck();
    await page.getByRole('dialog', { name: '编辑配置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(saved, 2, 'Closing the rule editor must not save');
    await page.getByRole('button', { name: '编辑配置', exact: true }).click();
    assert.equal(await page.locator('[data-rule-field="foundation"]').getByLabel('客户端', { exact: true }).isChecked(), true);
    await page.locator('[data-rule-field="foundation"]').getByLabel('客户端', { exact: true }).uncheck();
    await page.locator('#mg-rule-reason').fill('隔离规则修改');
    await page.locator('#mg-rules-form button[type=submit]').click();
    await page.locator('#mg-review[open]').waitFor();
    await page.locator('#mg-save').click();
    await page.waitForFunction(() => !document.querySelector('#mg-review').open && document.querySelector('#mg-feedback').textContent.includes('保存成功'));
    assert.equal(saved, 3);
    assert.equal(await page.getByRole('dialog', { name: '编辑配置', exact: true }).isVisible(), false);
    await page.locator('#mg-scope').selectOption('version');
    assert.match(await page.locator('.config-rule-summary').innerText(), /继承系统默认/);
    await page.locator('#mg-scope').selectOption('system');
    const enrollCalls = [];
    await page.route('**/api/source-candidates', route => route.fulfill({ json: [
      { projectId: 'project-a', versionId: 'candidate-a', projectName: '测试项目', versionName: '候选甲' },
      { projectId: 'project-b', versionId: 'candidate-b', projectName: '测试项目', versionName: '候选乙' }
    ] }));
    await page.route('**/api/version-people', route => route.fulfill({ json: [{ id: 'owner-a', displayName: '负责人甲' }, { id: 'owner-b', displayName: '负责人乙' }] }));
    await page.route('**/api/versions', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      assert.equal(route.request().headers()['x-csrf-token'], 'fake-csrf');
      enrollCalls.push(route.request().postDataJSON()); await route.fulfill({ json: { id: versionIds[1] } });
    });
    await page.getByRole('button', { name: '版本范围', exact: true }).click();
    await page.getByRole('button', { name: '选择版本', exact: true }).click();
    const enrollment = page.getByRole('dialog', { name: '选择版本', exact: true });
    await enrollment.getByLabel('Teambition 版本', { exact: true }).waitFor();
    assert.equal(await enrollment.getByLabel('Teambition 版本', { exact: true }).inputValue(), '');
    assert.equal(await enrollment.getByLabel('版本负责人', { exact: true }).inputValue(), '');
    await enrollment.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(enrollCalls.length, 0);
    await page.getByRole('button', { name: '选择版本', exact: true }).click();
    await enrollment.getByLabel('Teambition 版本', { exact: true }).selectOption('candidate-b');
    await enrollment.getByLabel('版本负责人', { exact: true }).selectOption('owner-b');
    await enrollment.getByLabel('核对依据与纳入原因', { exact: true }).fill('隔离验证明确选择');
    await enrollment.getByRole('button', { name: '核对来源并确认', exact: true }).click();
    await enrollment.waitFor({ state: 'hidden' });
    assert.deepEqual(enrollCalls, [{ projectId: 'project-b', versionId: 'candidate-b', ownerId: 'owner-b', reason: '隔离验证明确选择' }]);
    const useSpace = async value => {
      if (await page.locator('.config-v2-mobile').isVisible()) await page.locator('.config-v2-mobile').selectOption(value);
      else await page.locator('.config-v2-nav[data-workspace="' + value + '"]').click();
    };
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [workspace, labels] of [['version', ['版本范围', '规则设置', '工作日历']], ['status', ['状态映射', '影响与恢复']], ['people', ['人员与权限', '通知对象']]]) {
        await useSpace(workspace);
        for (const label of labels) {
          await page.getByRole('button', { name: label, exact: true }).click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, width + ' ' + label);
          if (label === '工作日历') {
            const [special, defaults] = await page.locator('.cal-aside > .cal-panel').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { left: box.left, top: box.top, bottom: box.bottom }; }));
            assert.equal(special.left, defaults.left, width + ' calendar aside stays in one column');
            assert.ok(defaults.top - special.bottom >= 15, width + ' calendar aside panels have 16px spacing');
          }
          await page.screenshot({ path: path.join(output, 'p09-config-' + workspace + '-' + labels.indexOf(label) + '-' + width + '.png'), fullPage: true });
        }
      }
    }
    await page.setViewportSize({ width: 375, height: 400 });
    await useSpace('status');
    await page.getByRole('button', { name: '状态映射', exact: true }).click();
    const statusTable = page.getByRole('region', { name: '状态语义映射', exact: true });
    assert.deepEqual(await statusTable.locator('thead th').allTextContents(), ['原始状态', '工作流', '统一管理语义', '计时节点', '映射结果']);
    assert.doesNotMatch(await statusTable.innerText(), /developing/);
    await page.getByRole('button', { name: '编辑映射', exact: true }).click();
    const statusEditor = page.getByRole('dialog', { name: '编辑状态映射', exact: true });
    assert.deepEqual(await statusEditor.locator('thead th').allTextContents(), ['原始状态', '工作流', '统一管理语义', '计时节点', '恢复状态']);
    assert.equal(await statusEditor.locator('.status-timing-start').count(), 2);
    assert.equal(await statusEditor.locator('.status-timing-end').count(), 2);
    assert.equal(await statusEditor.locator('.status-timing-start').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(237, 242, 251)');
    assert.equal(await statusEditor.locator('.status-timing-end').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(237, 246, 241)');
    const headerTop = await statusEditor.locator(':scope > .config-v2-section-head').evaluate(element => element.getBoundingClientRect().top);
    await statusEditor.locator('form').evaluate(form => { form.scrollTop = form.scrollHeight; });
    assert.equal(await statusEditor.locator(':scope > .config-v2-section-head').evaluate(element => element.getBoundingClientRect().top), headerTop);
    await statusEditor.getByRole('button', { name: '关闭', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await useSpace('version');
    await page.getByRole('button', { name: '规则设置', exact: true }).click();
    await page.reload();
    await page.locator('.config-layout').waitFor();
    assert.equal(await page.getByRole('button', { name: '规则设置', exact: true }).getAttribute('aria-current'), 'page');
    const acceptanceResponse = await page.request.get(origin + '/acceptance');
    assert.match(await acceptanceResponse.text(), /id="management-rules"/);

    await useSpace('people');
    const peopleRegion = page.getByRole('region', { name: '人员与权限', exact: true });
    assert.deepEqual(await peopleRegion.locator('thead th').allTextContents(), ['人员', '系统权限', '身份状态', '操作']);
    assert.ok(await peopleRegion.locator('.person-access').count() >= 2);
    assert.ok(await peopleRegion.locator('.person-map').count() >= 2);
    await page.getByRole('button', { name: '通知对象', exact: true }).click();
    const noticeRegion = page.locator('.people-notice-panel');
    assert.equal(await noticeRegion.locator('.people-notice-conditions > div').count(), 3);
    assert.deepEqual(await noticeRegion.locator('thead th').allTextContents(), ['通知节点', '接收规则']);
    await page.getByRole('button', { name: '人员与权限', exact: true }).click();
    const personRow = page.getByRole('region', { name: '人员与权限', exact: true }).locator('tbody tr').filter({ hasText: '测试查看者' });
    await personRow.getByRole('button', { name: '编辑权限', exact: true }).click();
    const personEditor = page.getByRole('dialog', { name: '编辑人员配置', exact: true });
    assert.equal(await personEditor.locator('.person-dialog-head').count(), 1);
    assert.equal(await personEditor.locator('.person-dialog-body').count(), 1);
    assert.equal(await personEditor.locator('.person-dialog-actions').count(), 1);
    await personEditor.getByLabel('系统权限', { exact: true }).selectOption('admin');
    await personEditor.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(permissionWrites.length, 0);
    await personRow.getByRole('button', { name: '编辑权限', exact: true }).click();
    assert.equal(await personEditor.getByLabel('系统权限', { exact: true }).inputValue(), 'viewer');
    await personEditor.getByLabel('系统权限', { exact: true }).selectOption('admin');
    await personEditor.getByLabel('变更依据与原因', { exact: true }).fill('隔离权限修改');
    await personEditor.getByRole('button', { name: '确认保存', exact: true }).click();
    await personEditor.waitFor({ state: 'hidden' });
    assert.deepEqual(permissionWrites, [{ role: 'admin', reason: '隔离权限修改' }]);
    await personRow.getByRole('button', { name: '编辑身份', exact: true }).click();
    await personEditor.getByLabel('启用人员', { exact: true }).uncheck();
    await personEditor.getByLabel('变更依据与原因', { exact: true }).fill('隔离身份停用');
    await personEditor.getByRole('button', { name: '确认保存', exact: true }).click();
    await personEditor.waitFor({ state: 'hidden' });
    assert.deepEqual(identityStateWrites, [{ active: false, mappingEnabled: true, reason: '隔离身份停用' }]);
    await page.getByRole('button', { name: '登记已核实身份', exact: true }).click();
    await personEditor.getByLabel('显示姓名', { exact: true }).fill('隔离登记人员');
    await personEditor.getByLabel('已核实的钉钉 Union ID', { exact: true }).fill('fake-union-id');
    await personEditor.getByLabel('已核对当前企业及该人员的可信身份', { exact: true }).check();
    await personEditor.getByLabel('变更依据与原因', { exact: true }).fill('隔离身份核对');
    await personEditor.getByRole('button', { name: '确认保存', exact: true }).click();
    await personEditor.waitFor({ state: 'hidden' });
    assert.deepEqual(identityWrites, [{ displayName: '隔离登记人员', unionId: 'fake-union-id', reason: '隔离身份核对', confirmed: true }]);
    await useSpace('version');
    await page.getByRole('button', { name: '规则设置', exact: true }).click();
    if (process.env.VIKINGPM_V2_ORIGIN) {
      const reference = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await reference.goto(process.env.VIKINGPM_V2_ORIGIN + '?page=config');
      await reference.locator('.cfg-shell').waitFor();
      const pairs = [
        ['.config-v2-shell', '.cfg-shell', ['gridTemplateColumns', 'backgroundColor']],
        ['.config-v2-rail', '.cfg-rail', ['padding', 'backgroundColor']],
        ['.config-v2-top', '.cfg-top', ['padding', 'backgroundColor']],
        ['.config-v2-top h1', '.cfg-top h1', ['fontSize', 'fontWeight', 'lineHeight', 'color']],
        ['.config-v2-content', '.cfg-content', ['padding']],
        ['.config-v2-subtabs', '.cfg-tabs', ['gap', 'marginBottom']],
        ['.config-v2-subtab.active', '.cfg-tab.active', ['fontSize', 'fontWeight', 'color']],
        ['.config-v2-section', '.cfg-section', ['borderRadius', 'borderColor', 'boxShadow']]
      ];
      const comparisons = [];
      for (const [actualSelector, expectedSelector, properties] of pairs) {
        const readStyles = (element, keys) => Object.fromEntries(keys.map(key => [key, getComputedStyle(element)[key]]));
        const actual = await page.locator(actualSelector).filter({ visible: true }).first().evaluate(readStyles, properties);
        const expected = await reference.locator(expectedSelector).filter({ visible: true }).first().evaluate(readStyles, properties);
        comparisons.push({ actualSelector, expectedSelector, actual, expected });
        for (const key of properties) if (key !== 'gridTemplateColumns') assert.equal(actual[key], expected[key], actualSelector + ' ' + key);
        if (properties.includes('gridTemplateColumns')) assert.equal(actual.gridTemplateColumns.split(' ')[0], expected.gridTemplateColumns.split(' ')[0]);
      }
      fs.writeFileSync(path.join(output, 'p09-config-v2-style-comparison.json'), JSON.stringify(comparisons, null, 2));
      await reference.close();
    }
    const beforeActionReads = ownerReads;
    await page.getByRole('link', { name: '行动中心', exact: true }).click();
    await page.locator('.action-grid').waitFor();
    assert.equal(ownerReads, beforeActionReads + 2, 'Saved configuration invalidates computed management caches');
    await page.getByRole('link', { name: '配置库', exact: true }).click();
    await page.locator('.config-layout').waitFor();
    await page.locator('.config-v2-nav').filter({ hasText: '人员与通知' }).click();
    await page.getByRole('region', { name: '人员与权限', exact: true }).waitFor();
    await page.getByRole('link', { name: /^异常与审计/ }).click();
    await page.getByRole('region', { name: '最近系统审计', exact: true }).waitFor();
    assert.match(await page.locator('#view').innerText(), /隔离验证/);
    await page.screenshot({ path: path.join(output, 'p09-audit.png'), fullPage: true });
    assert.deepEqual(errors, []);
    for (const message of consoleErrors) {
      const expectedStatus = expectedHttpFailures.get(message.url);
      assert.ok(expectedStatus && message.text.startsWith('Failed to load resource:') && message.text.includes('status of ' + expectedStatus), JSON.stringify(message));
    }
    console.log('PASS P09 browser: desktop/mobile version and requirement workspaces, actual timeline date alignment, actual-time editing/restore/stale saves and task drawers, function scopes, data tab, pagination, task deep link, delayed navigation, failures, expired session, viewer restrictions, owner config preview/save and audit.');
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(resolve => server ? server.close(resolve) : resolve());
  }
})();
