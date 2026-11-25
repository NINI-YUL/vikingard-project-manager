import { setupManagement } from './management-ui.js';
import { functions as FUNCTION_NAMES } from '../function-catalog.mjs';
const ROLE_NAMES = { none: '无后台权限', viewer: '查看者', admin: '系统管理员', owner: '系统所有者' };
const SYNC_NAMES = { never: '待首次同步', running: '同步中', succeeded: '同步成功', failed: '同步失败，保留原数据' };
const PRESENCE_NAMES = {
  current: '本次可读',
  archived: '来源已归档',
  out_of_scope: '已移出管理范围',
  access_restricted: '来源访问受限，原因待核对',
  missing_unknown: '来源缺失，原因不明',
  deleted_confirmed: '来源明确标记删除'
};
const ISSUE_NAMES = {
  missing_function: '缺少职能',
  unknown_task_type: '未知任务类型',
  unknown_status: '未知来源状态',
  customfields_missing: '自定义字段结构缺失',
  missing_title: '缺少标题',
  parent_missing: '父任务未纳入',
  self_parent: '父任务指向自身'
};
const state = {
  actor: null,
  versions: null,
  management: new Map(),
  tasks: new Map(),
  filters: new Map(),
  expandedTasks: new Set(),
  actionTab: 'delivery',
  versionRailCollapsed: false,
  routeRevision: 0
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const $ = id => document.getElementById(id);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function link(text, href, className) {
  const element = node('a', className, text);
  element.href = href;
  return element;
}

function button(label, onClick, className = 'button small') {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function loading(text = '正在读取本机数据，请等待结果…') {
  return node('div', 'loading', text);
}

function errorCard(message, retry) {
  const box = node('div', 'error-box');
  box.append(node('p', null, message));
  if (retry) box.append(button('重试', retry));
  return box;
}

function emptyCard(message) {
  return node('div', 'empty', message);
}

function setTitle(title, sub) {
  $('page-title').textContent = title;
  $('page-sub').textContent = sub;
}

function showMessage(text, kind = 'info') {
  const element = $('message');
  element.textContent = text;
  element.className = 'message' + (kind === 'error' ? ' error' : kind === 'success' ? ' success' : '');
  element.hidden = false;
}

function clearMessage() {
  const element = $('message');
  element.hidden = true;
  element.textContent = '';
}

function formatDate(value) {
  if (!value) return '尚无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatDay(value) {
  if (!value) return '日期未配置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期未知';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function dayValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function formatSync(version) {
  const name = SYNC_NAMES[version.syncStatus] ?? '同步状态未知';
  const cls = version.syncStatus === 'failed' ? 'bad' : version.syncStatus === 'running' ? 'warn' : version.syncStatus === 'succeeded' ? 'ok' : '';
  return { name, cls };
}

function ownerText(version) {
  if (!version.ownerName) return '待确认';
  return version.ownerConfirmed ? version.ownerName : version.ownerName + '（身份待确认）';
}

export function formatTaskNumber(value, prefix) {
  const key = String(value ?? '').trim();
  if (!key) return '无编号';
  if (!/^\d+$/.test(key)) return key;
  const projectPrefix = String(prefix ?? '').trim().replace(/-+$/, '');
  return projectPrefix ? projectPrefix + '-' + key : key + '（前缀待核对）';
}

function stageSummary(progress, key) {
  const stage = progress?.[key];
  if (!stage) return { text: '未知', detail: '尚未取得计算结果' };
  if (!stage.total) return { text: '暂无核心需求', detail: '分母为零，不计算比例' };
  if (stage.percent === null) return { text: stage.completed + ' / ' + stage.total, detail: '有 ' + stage.unknown + ' 个需求不可计算' };
  return { text: stage.completed + ' / ' + stage.total, detail: Math.round(stage.percent) + '% · 已知完成' };
}

function optimizationSummary(progress) {
  const item = progress?.optimization;
  if (!item) return { text: '未知', detail: '尚未取得计算结果' };
  return { text: item.stateComplete + ' / ' + item.total, detail: item.unknown ? item.unknown + ' 个未知' : '自身状态完成' };
}

function requirementStage(stage) {
  if (!stage) return { text: '未知', cls: '' };
  const count = Number.isInteger(stage.completedCount) && Number.isInteger(stage.totalCount) ? stage.completedCount + ' / ' + stage.totalCount + ' · ' : '';
  if (!stage.calculable) return { text: count + '不可计算', cls: 'amber' };
  return stage.complete ? { text: count + '已完成', cls: 'green' } : { text: count + '未完成', cls: 'blue' };
}

function appendStageDetails(cell, stage) {
  const incomplete = stage?.incompleteFunctions ?? [];
  if (incomplete.length) cell.append(node('div', 'cell-note', '未完成职能：' + incomplete.join('、')));
}

function stageCell(progress, key) {
  const summary = stageSummary(progress, key);
  const cell = node('td');
  cell.append(node('div', null, summary.text), node('div', 'cell-note', summary.detail));
  return cell;
}

function statusNode(version) {
  const status = formatSync(version);
  return node('span', 'status ' + status.cls, status.name);
}

function statusCell(version) {
  const cell = node('td');
  cell.append(statusNode(version));
  return cell;
}

function api(path, { method = 'GET', body, headers = {} } = {}) {
  return (async () => {
    const response = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-csrf-token': state.actor?.csrf ?? '' } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      if (state.actor) showLogin('登录已过期，请重新使用钉钉登录后继续。');
      throw new ApiError(401, '401：登录已过期，请重新登录。');
    }
    if (!response.ok) throw new ApiError(response.status, response.status + '：' + (data.error ?? '请求失败'));
    if (method === 'POST' && ['/api/management/save', '/api/management/verify'].includes(path)) state.management.clear();
    return data;
  })();
}

async function loadVersions(force = false) {
  if (!force && state.versions) return state.versions;
  const versions = await api('/api/versions');
  state.versions = versions;
  return versions;
}

function managementFor(versionId, force = false) {
  if (force) state.management.delete(versionId);
  if (!state.management.has(versionId)) {
    const promise = api('/api/management/versions/' + versionId).catch(error => {
      state.management.delete(versionId);
      throw error;
    });
    state.management.set(versionId, promise);
  }
  return state.management.get(versionId);
}

function tasksFor(versionId, offset, force = false) {
  const key = versionId + ':' + offset;
  if (force) state.tasks.delete(key);
  if (!state.tasks.has(key)) {
    const promise = api('/api/versions/' + versionId + '/tasks?offset=' + offset).catch(error => {
      state.tasks.delete(key);
      throw error;
    });
    state.tasks.set(key, promise);
  }
  return state.tasks.get(key);
}

function clearVersionCaches(versionId) {
  state.management.delete(versionId);
  for (const key of [...state.tasks.keys()]) if (key.startsWith(versionId + ':')) state.tasks.delete(key);
}

async function loadVersionContexts(force = false) {
  const versions = await loadVersions(force);
  return Promise.all(versions.map(async version => {
    try {
      return { version, management: await managementFor(version.id, force), error: null };
    } catch (error) {
      return { version, management: null, error };
    }
  }));
}

export function summarizeManagement(management) {
  const items = Array.isArray(management?.items) ? management.items : [];
  return {
    overdue: items.filter(item => item.due?.overdue).length,
    dueSoon: items.filter(item => item.due?.dueSoon).length,
    issueTasks: items.filter(item => Array.isArray(item.issues) && item.issues.length > 0).length,
    issueCount: items.reduce((total, item) => total + (Array.isArray(item.issues) ? item.issues.length : 0), 0),
    developmentUnknown: items.filter(item => item.timing?.development?.unknown).length,
    testUnknown: items.filter(item => item.timing?.test?.unknown).length
  };
}

export function actionHash(versionId = '', functions = [], tab = null) {
  const query = new URLSearchParams();
  if (versionId) query.set('version', versionId);
  for (const name of functions) query.append('function', name);
  if (tab === 'data') query.set('tab', 'data');
  return '#/action' + (query.size ? '?' + query : '');
}

export function selectedFunctions(raw) {
  const query = new URLSearchParams(String(raw).split('?')[1] ?? '');
  return [...new Set(query.getAll('function'))];
}

export function scopeActionContexts(contexts, versionId, functions = [], dataTab = false) {
  return contexts.filter(context => !versionId || context.version.id === versionId).map(context => ({
    ...context,
    management: context.management ? { ...context.management, items: context.management.items.filter(item =>
      dataTab || (item.kind === 'professional' && (!functions.length || functions.includes(item.functionName)))) } : null
  }));
}

export function syncTargetVersions(versions, selectedVersionId = '') {
  return selectedVersionId ? versions.filter(version => version.id === selectedVersionId) : versions;
}

async function syncLatestTb() {
  const control = $('tb-sync');
  const originalText = control.textContent;
  control.disabled = true;
  control.textContent = '正在获取…';
  clearMessage();
  try {
    const versions = await loadVersions();
    const targets = syncTargetVersions(versions, $('version-select').value);
    if (!targets.length) throw new ApiError(404, '没有可同步的活跃版本。');
    const results = [];
    for (const version of targets) {
      try {
        const result = await api('/api/versions/' + version.id + '/sync', {
          method: 'POST',
          body: { reason: '顶部按钮手动获取最新 TB 工单状态' }
        });
        results.push({ version, result });
      } catch (error) {
        results.push({ version, error });
        if ([401, 403, 503].includes(error.status)) break;
      }
    }
    state.versions = null;
    state.management.clear();
    state.tasks.clear();
    await route();
    const succeeded = results.filter(item => item.result?.status === 'succeeded');
    const failed = results.filter(item => !item.result || item.result.status !== 'succeeded');
    if (!failed.length) {
      const detail = targets.length === 1
        ? '同步 ' + succeeded[0].result.importedCount + ' 张工单，' + succeeded[0].result.issueCount + ' 张存在结构问题。'
        : succeeded.length + '/' + targets.length + ' 个版本同步成功。';
      showMessage('已获取最新 TB。' + detail, 'success');
    } else {
      showMessage('获取完成：' + succeeded.length + ' 个版本成功，' + failed.length + ' 个版本失败；失败版本保留上次成功数据。', 'error');
    }
  } catch (error) {
    if (error.status !== 401) showMessage('获取最新 TB 失败：' + error.message, 'error');
  } finally {
    control.disabled = false;
    control.textContent = originalText;
  }
}

function syncFunctionFilter(current) {
  $('function-filter').hidden = current.name !== 'action' || current.tab === 'data';
  const selected = selectedFunctions(current.raw);
  $('function-summary').textContent = '职能：' + (selected.length ? selected.join('、') : '全部');
  const options = $('function-options');
  options.replaceChildren();
  for (const name of ['', ...FUNCTION_NAMES]) {
    const label = node('label');
    const input = node('input');
    input.type = 'checkbox';
    input.checked = name ? selected.includes(name) : selected.length === 0;
    input.addEventListener('change', () => {
      const next = !name ? [] : input.checked ? [...selected, name] : selected.filter(value => value !== name);
      navigate(actionHash(current.versionId, next, current.tab));
    });
    label.append(input, document.createTextNode(name || '全部'));
    options.append(label);
  }
}

export function parseHash(raw = '') {
  const text = String(raw).replace(/^#/, '') || '/action';
  const [pathPart, queryPart = ''] = text.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart);
  const offsetValue = Number(query.get('offset') ?? 0);
  const base = {
    raw: text,
    offset: Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0,
    taskId: query.get('task') || null,
    versionId: query.get('version') || null,
    requirementId: query.get('requirement') || null,
    tab: query.get('tab') || null
  };
  if (parts.length === 0 || parts[0] === 'action') return { ...base, name: 'action' };
  if (parts[0] === 'versions' && parts.length === 1) return { ...base, name: 'versions' };
  if (parts[0] === 'versions' && parts.length === 2) return { ...base, name: 'versionDetail', versionId: parts[1] };
  if (parts[0] === 'requirements') return { ...base, name: 'requirements' };
  if (parts[0] === 'people') return { ...base, name: 'people' };
  if (parts[0] === 'anomalies') return { ...base, name: 'anomalies' };
  if (parts[0] === 'participation') return { ...base, name: 'participation' };
  if (parts[0] === 'config') return { ...base, name: 'config' };
  if (parts[0] === 'history') return { ...base, name: 'history' };
  return { ...base, name: 'notFound' };
}

function routeKey(route) {
  if (route.name === 'versionDetail') return 'versions';
  return route.name;
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function versionHash(versionId) {
  return '#/versions/' + versionId;
}

function taskHash(versionId, offset, taskId) {
  const query = new URLSearchParams({ offset: String(offset) });
  if (taskId) query.set('task', taskId);
  return '#/versions/' + versionId + '?' + query.toString();
}

function requirementsHash(versionId, requirementId) {
  const query = new URLSearchParams();
  if (versionId) query.set('version', versionId);
  if (requirementId) query.set('requirement', requirementId);
  return '#/requirements' + (query.toString() ? '?' + query.toString() : '');
}

function setNav(route) {
  const key = routeKey(route);
  for (const item of document.querySelectorAll('.nav[data-route]')) {
    const active = item.dataset.route === key;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

function populateVersionSelect(versions) {
  const select = $('version-select');
  select.replaceChildren();
  const all = node('option', null, '全部活跃版本');
  all.value = '';
  select.append(all);
  for (const version of versions) {
    const option = node('option', null, version.displayName);
    option.value = version.id;
    select.append(option);
  }
  select.disabled = versions.length === 0;
}

function syncVersionSelect(route) {
  const selected = route.versionId || '';
  $('version-select').value = selected && [...$('version-select').options].some(option => option.value === selected) ? selected : '';
}

async function route() {
  if (!state.actor) return;
  const revision = ++state.routeRevision;
  clearMessage();
  const current = parseHash(location.hash);
  if (!location.hash) history.replaceState(null, '', '#/action');
  document.body.classList.toggle('version-page', ['versions', 'versionDetail'].includes(current.name));
  document.body.classList.toggle('requirement-page', current.name === 'requirements');
  document.body.classList.toggle('v2-page', ['versions', 'versionDetail', 'requirements'].includes(current.name));
  setNav(current);
  syncVersionSelect(current);
  syncFunctionFilter(current);
  const view = $('view');
  const content = node('div');
  view.replaceChildren(loading());
  try {
    await renderRoute(current, content, revision);
  } catch (error) {
    if (error.status === 401 || revision !== state.routeRevision) return;
    content.replaceChildren(errorCard(error.message ?? '页面读取失败', () => route()));
  }
  if (!state.actor || revision !== state.routeRevision) return;
  view.replaceChildren(...content.childNodes);
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function renderRoute(current, view, revision) {
  const versions = await loadVersions();
  if (revision !== state.routeRevision) return;
  populateVersionSelect(versions);
  syncVersionSelect(current);
  if (!['versions', 'versionDetail'].includes(current.name)) state.expandedTasks.clear();
  if (current.name === 'action') return renderAction(current, view);
  if (current.name === 'versions') return renderVersions(view);
  if (current.name === 'versionDetail') return renderVersionDetail(current, view);
  if (current.name === 'requirements') return renderRequirements(current, view);
  if (current.name === 'people') return renderPeople(view);
  if (current.name === 'anomalies') return renderAnomalies(current, view);
  if (current.name === 'participation') return renderParticipation(view);
  if (current.name === 'config') return renderConfig(view, current);
  if (current.name === 'history') return renderHistory(view);
  setTitle('页面不存在', '请从左侧导航重新选择');
  view.replaceChildren(errorCard('该地址没有对应页面，可能来自旧链接。', () => navigate('#/action')));
}

function tabsNode(active, current) {
  const functions = selectedFunctions(current.raw);
  const tabs = node('div', 'tabs');
  const delivery = link('风险与到期', actionHash(current.versionId, functions), 'tab' + (active === 'delivery' ? ' active' : ''));
  const data = link('数据待处理', actionHash(current.versionId, functions, 'data'), 'tab' + (active === 'data' ? ' active' : ''));
  tabs.append(delivery, data);
  return tabs;
}

function metricCard(label, value, detail, tone = '') {
  const card = node('div', 'metric-card');
  card.append(
    node('div', 'metric-label', label),
    node('div', 'metric-value ' + tone, value),
    node('div', 'metric-detail', detail)
  );
  return card;
}

function tableWrap(caption) {
  const wrap = node('div', 'table-wrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', caption);
  return wrap;
}

function buildTable(caption, columns, rows, emptyText) {
  const wrap = tableWrap(caption);
  const table = node('table');
  const cap = node('caption', 'sr-only', caption);
  const thead = node('thead');
  const headRow = node('tr');
  for (const column of columns) headRow.append(node('th', null, column));
  thead.append(headRow);
  const tbody = node('tbody');
  if (!rows.length) {
    const row = node('tr');
    const cell = node('td', 'empty-cell', emptyText);
    cell.colSpan = columns.length;
    row.append(cell);
    tbody.append(row);
  } else {
    for (const row of rows) tbody.append(row);
  }
  table.append(cap, thead, tbody);
  wrap.append(table);
  return wrap;
}

function dataTabNode(contexts, versionId = null) {
  const wrap = node('div');
  const summary = contexts.map(item => ({ ...item, counts: item.management ? summarizeManagement(item.management) : null }));
  const failed = summary.filter(item => item.error).length;
  const known = summary.filter(item => item.counts);
  const issueTasks = failed ? '未知' : known.reduce((total, item) => total + item.counts.issueTasks, 0);
  const issueCount = failed ? '未知' : known.reduce((total, item) => total + item.counts.issueCount, 0);
  const metrics = node('div', 'metrics');
  metrics.append(
    metricCard('受影响工单', issueTasks, failed ? failed + ' 个版本读取失败，不能汇总' : '去重到工单，不等同异常事项数', 'amber'),
    metricCard('问题标记', issueCount, '同一工单可同时存在多个问题', 'amber'),
    metricCard('读取失败版本', failed, failed ? '失败不伪装为空结果' : '当前版本计算事实均可读', failed ? 'red' : 'blue')
  );

  const rows = summary.map(item => {
    const row = node('tr');
    const versionCell = node('td');
    versionCell.append(link(item.version.displayName, versionHash(item.version.id), 'version-name'), node('div', 'cell-note', item.version.projectName ?? ''));
    row.append(versionCell);
    if (item.error) {
      const cell = node('td');
      cell.append(node('div', null, '读取失败'), node('div', 'cell-note', item.error.message));
      row.append(cell, node('td', null, '未知'), node('td', null, formatDate(item.version.lastSuccessAt)));
    } else {
      const types = new Map();
      for (const fact of item.management.items) for (const issue of fact.issues ?? []) types.set(issue, (types.get(issue) ?? 0) + 1);
      const typeText = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, count]) => text + ' ' + count).join('；') || '当前无问题标记';
      row.append(
        node('td', null, item.counts.issueTasks + ' 张'),
        node('td', 'wrap', typeText),
        node('td', null, formatDate(item.management.sourceSnapshotAt))
      );
    }
    const action = node('td');
    action.append(link('打开版本', versionHash(item.version.id), 'row-link'));
    row.append(action);
    return row;
  });

  wrap.append(metrics, buildTable('数据待处理汇总', ['版本', '受影响工单', '问题类型', '来源快照', '操作'], rows, '尚未纳入版本，暂无数据待处理汇总。'));
  const notice = node('div', 'notice');
  notice.append(node('p', null, '本页仅汇总版本计算返回的当前问题标记。完整异常事项、去重口径、处理入口与审计记录归“异常与审计”后续批次；反馈原始校验、同步失败和投递失败尚未并入本页。'));
  const actions = node('div', 'section-actions');
  actions.append(link('查看异常与审计', '#/anomalies' + (versionId ? '?version=' + encodeURIComponent(versionId) : ''), 'button small'), link('打开功能验收', '/acceptance', 'button small'));
  notice.append(actions);
  wrap.append(node('div', null, ''), notice);
  return wrap;
}

async function renderAction(current, view) {
  setTitle('行动中心', '全部活跃版本 · 两个页签分别处理交付事项与数据事项');

  const allContexts = await loadVersionContexts();
  updateAnomalyBadge(allContexts);
  if (current.versionId && !allContexts.some(context => context.version.id === current.versionId)) {
    view.replaceChildren(errorCard('所选版本不存在或已退出活跃范围，请重新选择版本。'));
    return;
  }
  const active = current.tab === 'data' ? 'data' : 'delivery';
  const contexts = scopeActionContexts(allContexts, current.versionId, selectedFunctions(current.raw), active === 'data');
  const wrap = node('div', 'action-page');
  wrap.append(tabsNode(active, current));
  if (active === 'data') {
    wrap.append(dataTabNode(contexts, current.versionId));
    view.replaceChildren(wrap);
    return;
  }

  const failed = contexts.filter(context => context.error).length;
  const facts = contexts.flatMap(context => (context.management?.items ?? []).map(item => ({ ...item, version: context.version })));
  const overdue = facts.filter(item => item.due?.overdue);
  const dueSoon = facts.filter(item => item.due?.dueSoon);
  const scope = node('div', 'scope');
  scope.append(node('span', null, '当前范围：' + contexts.length + ' 个活跃版本'));
  const guide = node('details', 'scope-guide');
  guide.append(node('summary', null, '统计口径与说明'), node('p', null,
    '仅统计核心需求下的核心专业子单。三日内按公司工作日历计算；缺少计划时间或状态映射的工单无法判断到期。职能筛选不影响数据待处理。风险反馈尚未接入，不把缺失数据填成正常。'));
  scope.append(node('span', 'note', '仅统计核心需求下的核心专业子单'), guide);
  wrap.append(scope);
  if (failed) wrap.append(errorCard(failed + ' 个版本读取失败。以下仅列出读取成功的工单，总数未知。', () => route()));
  const unknownDue = facts.filter(item => item.due == null && !['delivered', 'non_delivery'].includes(item.semantic)).length;
  if (unknownDue) wrap.append(node('p', 'note', unknownDue + ' 张核心专业子单因计划、状态或来源问题无法判断到期，请在异常与审计核对。'));

  const metrics = node('div', 'metrics');
  metrics.append(
    metricCard('高风险需求', '待接入', '风险等级尚未接入', 'red'),
    metricCard('需关注需求', '待接入', '风险等级尚未接入', 'amber'),
    metricCard('风险工单', '待接入', '反馈风险尚未接入', 'blue'),
    metricCard('已逾期工单', failed || unknownDue ? '未知' : overdue.length, unknownDue ? '已知逾期 ' + overdue.length + ' 张；另 ' + unknownDue + ' 张到期未知' : '按已知计划与当前状态判断', 'red'),
    metricCard('三日内到期', failed || unknownDue ? '未知' : dueSoon.length, unknownDue ? '已知三日内到期 ' + dueSoon.length + ' 张；另 ' + unknownDue + ' 张到期未知' : '按公司工作日历计算', 'blue')
  );
  wrap.append(metrics);

  const grid = node('div', 'action-grid');
  const main = node('div', 'action-main');
  const side = node('div', 'action-side');
  function section(title, count) {
    const card = node('section', 'card action-section');
    const head = node('div', 'section-head');
    head.append(node('h2', 'section-title', title));
    if (count != null) head.append(node('span', 'pill', count));
    card.append(head);
    return card;
  }
  const risk = section('风险关注');
  risk.append(emptyCard('风险等级与反馈风险尚未接入，暂不能判断高风险或需关注需求。'));
  main.append(risk);

  const overdueCard = section('已逾期工单', failed ? '总数未知' : overdue.length + ' 张工单');
  const rows = overdue.map(item => {
    const row = node('tr');
    const identity = node('td');
    identity.append(link(item.title, taskHash(item.version.id, 0, item.sourceTaskId), 'row-link'),
      node('div', 'cell-note', (item.requirementTitle || '所属需求待核对') + ' · ' + item.version.displayName));
    const days = node('td');
    days.append(node('span', 'overdue-days', '逾期 ' + item.due.workingDays + ' 日'));
    row.append(identity, node('td', null, item.executorName || '身份待核对'), days, node('td', null, item.rawStatus || '状态未知'));
    return row;
  });
  overdueCard.append(buildTable('已逾期核心专业子单', ['工单 / 所属需求', '执行者', '逾期', '当前情况'], rows,
    failed ? '暂无可读取的逾期明细，不能判断为零。' : unknownDue ? '可判断的工单中暂无逾期，其余工单到期未知。' : '当前范围暂无已逾期核心专业子单。'));
  main.append(overdueCard);

  const dueCard = section('即将到期工单', failed ? '总数未知' : dueSoon.length + ' 张工单');
  const timeline = node('div', 'due-timeline');
  const groups = new Map();
  for (const item of dueSoon.sort((a, b) => String(a.plannedDueAt).localeCompare(String(b.plannedDueAt)))) {
    const key = item.due.deadlineDate || item.plannedDueAt;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [date, items] of groups) {
    const days = items[0].due.workingDaysUntil;
    const label = date === items[0].due.today ? '今天' : days === 0 ? '非工作日到期' : Number.isInteger(days) ? days + ' 个工作日后' : '三日内到期';
    const group = node('div', 'due-group');
    group.append(node('h3', 'due-heading', label + ' · ' + (date || '日期待核对') + ' · ' + items.length + ' 张'));
    for (const item of items) {
      const card = link('', taskHash(item.version.id, 0, item.sourceTaskId), 'due-item');
      card.append(node('strong', null, item.title), node('span', 'cell-note',
        (item.requirementTitle || '所属需求待核对') + ' · ' + (item.executorName || '执行者身份待核对')),
        node('span', 'cell-note', item.version.displayName + ' · ' + (item.rawStatus || '状态未知') + ' · 截止 ' + formatDate(item.plannedDueAt)));
      group.append(card);
    }
    timeline.append(group);
  }
  if (!dueSoon.length) timeline.append(emptyCard(failed ? '到期信息读取不完整。' : unknownDue ? '可判断的工单中暂无三日内到期，其余工单到期未知。' : '当前范围暂无三日内到期核心专业子单。'));
  dueCard.append(timeline);
  const executors = section('风险工单执行人');
  executors.append(emptyCard('风险工单尚未接入，执行人汇总待完成。'));
  side.append(dueCard, executors);
  grid.append(main, side);
  wrap.append(grid);
  view.replaceChildren(wrap);
}

async function renderVersions(view) {
  setTitle('版本', '活跃版本列表与版本详情');
  const versions = await loadVersions();
  if (versions.length) {
    const current = parseHash(versionHash(versions[0].id));
    history.replaceState(null, '', versionHash(versions[0].id));
    syncVersionSelect(current);
    return renderVersionDetail(current, view);
  }
  view.replaceChildren(emptyCard('暂无活跃版本。管理员可从功能验收纳入受控版本。'));
}

async function renderVersionDetail(current, view) {
  const versions = await loadVersions();
  const version = versions.find(item => item.id === current.versionId);

  if (!version) {
    setTitle('版本不存在', '该对象可能已移除，或链接不属于当前可见版本');
    view.replaceChildren(errorCard('当前可见版本中没有该对象。请返回活跃版本重新选择。', () => navigate('#/versions')));
    return;
  }
  setTitle('版本', '活跃版本列表与版本详情');
  view.replaceChildren(loading());

  const [contexts, tasksResult] = await Promise.all([
    loadVersionContexts(),
    Promise.allSettled([tasksFor(version.id, current.offset)]).then(results => results[0])
  ]);
  updateAnomalyBadge(contexts);
  const context = contexts.find(item => item.version.id === version.id);
  const management = context?.management ?? null;
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : null;
  const wrap = node('div');
  const workspace = node('div', 'version-workspace' + (state.versionRailCollapsed ? ' rail-collapsed' : ''));
  const rail = node('aside', 'version-rail');
  rail.setAttribute('aria-label', '活跃版本');
  const railHead = node('div', 'version-rail-head');
  const railTitle = node('div', 'version-rail-title');
  railTitle.append(node('span', null, '活跃版本'), node('span', 'pill blue', contexts.length));
  const toggle = button(state.versionRailCollapsed ? '→' : '←', () => {
    state.versionRailCollapsed = !state.versionRailCollapsed;
    workspace.classList.toggle('rail-collapsed', state.versionRailCollapsed);
    toggle.textContent = state.versionRailCollapsed ? '→' : '←';
    toggle.setAttribute('aria-label', state.versionRailCollapsed ? '展开活跃版本列表' : '收起活跃版本列表');
  }, 'version-rail-toggle');
  toggle.setAttribute('aria-label', state.versionRailCollapsed ? '展开活跃版本列表' : '收起活跃版本列表');
  railHead.append(railTitle, toggle);
  const railList = node('div', 'version-rail-list');
  for (const item of contexts) {
    const active = item.version.id === version.id;
    const entry = link('', versionHash(item.version.id), 'version-rail-item' + (active ? ' active' : ''));
    if (active) entry.setAttribute('aria-current', 'page');
    const count = item.error ? '详情读取失败' : item.management.progress.coreRequirementCount + ' 个核心需求';
    entry.append(node('b', null, item.version.displayName), node('span', null, count));
    railList.append(entry);
  }
  rail.append(railHead, railList);

  const detailPane = node('section', 'version-detail-pane');
  const breadcrumbs = node('div', 'breadcrumbs');
  breadcrumbs.append(link('全部活跃版本', '#/versions'), node('span', null, '/'), node('b', null, version.displayName));
  const hero = node('div', 'version-detail-hero');
  hero.append(node('div', 'note', '版本'), node('h1', 'version-detail-title', version.displayName), node('div', 'sub', 'Teambition 同步起点：' + formatDate(version.syncStartAt)));
  detailPane.append(breadcrumbs, hero);
  const detailLayout = node('div', 'version-detail-layout');
  let changesCard;

  if (context?.error) {
    detailPane.append(errorCard('计算事实读取失败：' + context.error.message, async () => {
      clearVersionCaches(version.id);
      await route();
    }));
  }

  if (management) {
    const counts = summarizeManagement(management);
    const progress = management.progress;
    const metrics = node('div', 'version-kpis');
    const foundation = stageSummary(progress, 'foundation');
    const opt = optimizationSummary(progress);
    metrics.append(
      metricCard('核心需求', progress.coreRequirementCount, '基础流程 ' + foundation.text + ' · ' + foundation.detail),
      metricCard('优化需求', progress.optimization.total, opt.text + ' · ' + opt.detail),
      metricCard('风险需求', '待接入', '风险需求聚合将在 P09 后续阶段接入', 'muted')
    );
    detailPane.append(metrics);

    const reqCard = node('div', 'card version-requirements');
    const reqHead = node('div', 'section-head');
    const reqTitles = node('div');
    reqTitles.append(node('div', 'section-title', '核心需求进展与风险'), node('div', 'note', '只展示核心需求；阶段未知保留为不可计算，不以零代替'));
    const reqActions = node('div', 'section-actions');
    reqActions.append(link('查看需求页', requirementsHash(version.id), 'button small'));
    reqHead.append(reqTitles, reqActions);
    reqCard.append(reqHead);
    const reqRows = management.requirements.map(requirement => {
      const row = node('tr');
      const name = node('td');
      const root = management.items.find(item => item.id === requirement.id);
      name.append(link(requirement.title || '未命名需求', requirementsHash(version.id, requirement.id), 'version-name'), node('div', 'cell-note task-number', formatTaskNumber(root?.key, version.uniqueIdPrefix)));
      row.append(name);
      const owner = root?.executorName;
      row.append(node('td', null, owner || '身份待核对'));
      const foundationStage = requirementStage(requirement.stages.foundation);
      const foundationCell = node('td');
      foundationCell.append(node('span', 'pill ' + foundationStage.cls, foundationStage.text));
      appendStageDetails(foundationCell, requirement.stages.foundation);
      row.append(foundationCell);
      const detailStage = requirementStage(requirement.stages.detail);
      const detailCell = node('td');
      detailCell.append(node('span', 'pill ' + detailStage.cls, detailStage.text));
      appendStageDetails(detailCell, requirement.stages.detail);
      row.append(detailCell);
      const riskCell = node('td');
      riskCell.append(node('span', 'pill', '待接入'));
      row.append(riskCell);
      return row;
    });
    reqCard.append(buildTable('核心需求进展与风险', ['核心需求', '负责人', '基础流程', '全部内容', '风险'], reqRows, '当前版本没有可识别的核心需求。'));

    const signalCard = node('div', 'card');
    signalCard.append(node('div', 'section-title', '当前管理信号'));
    const signalList = node('div', 'version-signal-list');
    const signals = [
      ['已逾期', counts.overdue ? counts.overdue + ' 张工单已逾期' : '当前可判断工单中暂无逾期', counts.overdue ? 'red' : 'green'],
      ['即将到期', counts.dueSoon ? counts.dueSoon + ' 张工单在三个工作日内到期' : '当前可判断工单中暂无三日内到期', counts.dueSoon ? 'amber' : 'green'],
      ['数据异常', counts.issueTasks ? counts.issueTasks + ' 张工单存在 ' + counts.issueCount + ' 项数据问题' : '当前读取范围未发现数据问题', counts.issueTasks ? 'amber' : 'green']
    ];
    for (const [label, text, tone] of signals) {
      const signal = node('div', 'version-signal ' + tone);
      signal.append(node('b', null, label), node('div', 'note', text));
      signalList.append(signal);
    }
    signalCard.append(signalList);

    changesCard = node('div', 'card version-changes');
    changesCard.append(node('div', 'section-title', '最近变化'), node('div', 'note', '只记录当前可核对的同步与计算事实'));
    const timeline = node('div', 'version-timeline');
    const changes = [
      [version.lastSuccessAt, '来源同步', formatSync(version).name + (version.lastErrorCode ? ' · ' + version.lastErrorCode : '')],
      [management.sourceSnapshotAt, '来源快照', '当前管理计算使用的 Teambition 快照'],
      [management.calculatedAt, '管理计算', 'revision ' + management.revision]
    ];
    for (const [at, label, text] of changes) {
      const item = node('div', 'version-timeline-item');
      item.append(node('span', 'note', formatDate(at)), node('b', null, label), node('div', 'note', text));
      timeline.append(item);
    }
    changesCard.append(timeline);
    detailLayout.append(reqCard, signalCard);
  }

  const taskCard = node('details', 'card version-tasks');
  taskCard.open = state.expandedTasks.has(version.id) || Boolean(current.taskId) || current.offset > 0;
  taskCard.addEventListener('toggle', () => {
    if (!taskCard.isConnected) return;
    if (taskCard.open) state.expandedTasks.add(version.id);
    else state.expandedTasks.delete(version.id);
  });
  const taskSummary = node('summary', 'task-summary');
  taskSummary.append(node('span', 'section-title', '任务详情'), node('span', 'note', '点击展开 / 收起'));
  taskCard.append(taskSummary);
  const taskBody = node('div', 'task-body');
  const taskHead = node('div', 'section-head');
  const taskTitles = node('div');
  taskTitles.append(node('div', 'note', '点击任务查看来源事实、计算问题与来源历史；筛选仅作用于当前页'));
  const taskActions = node('div', 'section-actions');
  taskActions.append(button('刷新本页', async () => {
    clearVersionCaches(version.id);
    await route();
  }));
  taskHead.append(taskTitles, taskActions);
  taskBody.append(taskHead);
  taskCard.append(taskBody);
  detailLayout.append(taskCard);
  if (changesCard) detailLayout.append(changesCard);
  detailPane.append(detailLayout);

  if (!tasks) {
    taskSummary.append(node('span', 'pill red', '读取失败'));
    taskBody.append(errorCard('任务详情读取失败：' + tasksResult.reason.message, async () => {
      state.tasks.delete(version.id + ':' + current.offset);
      await route();
    }));
    workspace.append(rail, detailPane);
    wrap.append(workspace);
    view.replaceChildren(wrap);
    return;
  }

  const layout = node('div', 'task-layout' + (current.taskId ? ' with-panel' : ''));
  const taskList = node('div');
  taskList.append(renderTaskList(version, tasks, current));
  layout.append(taskList);
  if (current.taskId) layout.append(renderTaskPanel(version, tasks, management, current));
  taskBody.append(layout);
  workspace.append(rail, detailPane);
  wrap.append(workspace);
  view.replaceChildren(wrap);
}

function taskFilter(versionId) {
  if (!state.filters.has(versionId)) state.filters.set(versionId, { q: '', type: '', fn: '', issues: false });
  return state.filters.get(versionId);
}

function renderTaskList(version, tasks, current) {
  const wrap = node('div');
  const filters = taskFilter(version.id);
  const types = [...new Set(tasks.items.map(item => item.typeName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const functions = [...new Set(tasks.items.map(item => item.functionName || (item.functionResolution === 'missing' ? '未填写' : '职能待配置')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));

  const toolbar = node('div', 'toolbar-row');
  const searchField = node('label', 'field grow');
  searchField.append(node('span', null, '搜索编号或标题'));
  const search = node('input', 'input');
  search.type = 'search';
  search.placeholder = '输入编号或标题';
  search.value = filters.q;
  searchField.append(search);
  const typeField = node('label', 'field');
  typeField.append(node('span', null, '类型'));
  const typeSelect = node('select', 'select');
  const typeAll = node('option', null, '全部类型');
  typeAll.value = '';
  typeSelect.append(typeAll);
  for (const type of types) {
    const option = node('option', null, type);
    option.value = type;
    typeSelect.append(option);
  }
  typeSelect.value = filters.type;
  typeField.append(typeSelect);
  const functionField = node('label', 'field');
  functionField.append(node('span', null, '职能'));
  const functionSelect = node('select', 'select');
  const functionAll = node('option', null, '全部职能');
  functionAll.value = '';
  functionSelect.append(functionAll);
  for (const value of functions) {
    const option = node('option', null, value);
    option.value = value;
    functionSelect.append(option);
  }
  functionSelect.value = filters.fn;
  functionField.append(functionSelect);
  const issuesField = node('label', 'check-field');
  const issues = node('input');
  issues.type = 'checkbox';
  issues.checked = filters.issues;
  issuesField.append(issues, node('span', null, '只看结构问题'));
  toolbar.append(searchField, typeField, functionField, issuesField);

  const countLine = node('p', 'count-line');
  const tableRows = tasks.items.map(item => {
    const row = node('tr');
    row.dataset.search = (formatTaskNumber(item.visibleKey, version.uniqueIdPrefix) + ' ' + item.title).toLowerCase();
    row.dataset.type = item.typeName ?? '';
    row.dataset.fn = item.functionName || (item.functionResolution === 'missing' ? '未填写' : '职能待配置');
    row.dataset.issues = (item.structureIssues?.length ? '1' : '0');
    row.tabIndex = 0;

    const keyCell = node('td', 'task-number');
    keyCell.append(link(formatTaskNumber(item.visibleKey, version.uniqueIdPrefix), taskHash(version.id, current.offset, item.sourceTaskId), 'version-name'));
    keyCell.append(node('div', 'cell-note', item.category ?? '分类未填写'));
    const titleCell = node('td', 'wrap');
    titleCell.append(node('div', null, item.title || '未填写标题'));
    const typeCell = node('td');
    typeCell.append(node('div', null, item.typeName ?? '未知类型'), node('div', 'cell-note', item.functionName || (item.functionResolution === 'confirmed' ? '' : '职能待配置')));
    const parentCell = node('td', 'task-number');
    parentCell.append(node('div', null, item.parentVisibleKey ? formatTaskNumber(item.parentVisibleKey, version.uniqueIdPrefix) : (item.parentSourceTaskId ? '父任务未纳入' : '无')));
    const statusCell = node('td');
    statusCell.append(node('div', null, item.rawStatus ?? '未知'), node('div', 'cell-note', PRESENCE_NAMES[item.sourcePresence] ?? '来源状态待核对'));
    const issueCell = node('td', 'wrap');
    const issueText = item.structureIssues?.length ? item.structureIssues.map(code => ISSUE_NAMES[code] ?? code).join('；') : (item.availability === 'unknown' ? '待识别' : '当前结构检查通过');
    issueCell.append(node('div', null, issueText), node('div', 'cell-note', '最近同步 ' + formatDate(item.lastSyncedAt)));
    const action = node('td');
    action.append(link('打开', taskHash(version.id, current.offset, item.sourceTaskId), 'row-link'));
    row.append(keyCell, titleCell, typeCell, parentCell, statusCell, issueCell, action);

    row.addEventListener('click', event => {
      if (event.target.closest('a,button')) return;
      navigate(taskHash(version.id, current.offset, item.sourceTaskId));
    });
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigate(taskHash(version.id, current.offset, item.sourceTaskId));
      }
    });
    return row;
  });

  const apply = () => {
    let visible = 0;
    for (const row of tableRows) {
      const matchesSearch = !filters.q || row.dataset.search.includes(filters.q.toLowerCase());
      const matchesType = !filters.type || row.dataset.type === filters.type;
      const matchesFunction = !filters.fn || row.dataset.fn === filters.fn;
      const matchesIssues = !filters.issues || row.dataset.issues === '1';
      const show = matchesSearch && matchesType && matchesFunction && matchesIssues;
      row.hidden = !show;
      if (show) visible++;
    }
    countLine.textContent = '共 ' + tasks.total + ' 张；本页 ' + tasks.items.length + ' 张，当前筛选显示 ' + visible + ' 张。筛选仅检查本页 ' + tasks.items.length + ' 张。';
  };

  search.addEventListener('input', () => { filters.q = search.value.trim(); apply(); });
  typeSelect.addEventListener('change', () => { filters.type = typeSelect.value; apply(); });
  functionSelect.addEventListener('change', () => { filters.fn = functionSelect.value; apply(); });
  issues.addEventListener('change', () => { filters.issues = issues.checked; apply(); });

  const table = buildTable('任务详情列表', ['编号', '标题', '类型与职能', '父任务编号', '原始状态与来源', '结构检查', '操作'], tableRows, '当前页没有任务。');
  wrap.append(toolbar, countLine, table);

  const pagination = node('div', 'pagination');
  const previous = button('上一页', () => navigate(taskHash(version.id, Math.max(0, current.offset - 100), null)));
  previous.disabled = current.offset === 0;
  const next = button('下一页', () => navigate(taskHash(version.id, tasks.nextOffset, null)));
  next.disabled = tasks.nextOffset === null;
  const range = node('span', 'note', '偏移 ' + current.offset + ' · 下一页 ' + (tasks.nextOffset ?? '无'));
  const actions = node('div', 'pagination-actions');
  actions.append(previous, next);
  pagination.append(range, actions);
  wrap.append(pagination);
  apply();
  return wrap;
}

function factFromManagement(management, taskId) {
  return management?.items?.find(item => item.sourceTaskId === taskId) ?? null;
}

function renderTaskPanel(version, tasks, management, current) {
  const panel = node('aside', 'task-panel');
  panel.setAttribute('aria-label', '任务详情');
  const close = button('关闭', () => navigate(taskHash(version.id, current.offset, null)), 'button small');
  const task = tasks.items.find(item => item.sourceTaskId === current.taskId);
  const fact = factFromManagement(management, current.taskId);
  if (!task && !fact) {
    const head = node('div', 'panel-head');
    head.append(node('h2', 'panel-title', '任务不可见'), close);
    panel.append(head, errorCard('该任务不在当前页，也未出现在当前版本计算事实中。可能已移出管理范围或链接已过期。', () => navigate(taskHash(version.id, current.offset, null))));
    return panel;
  }

  const head = node('div', 'panel-head');
  const titleBox = node('div');
  titleBox.append(node('h2', 'panel-title', task?.title || fact?.title || '未命名任务'));
  titleBox.append(node('div', 'note task-number', formatTaskNumber(task?.visibleKey || fact?.key, version.uniqueIdPrefix) + ' · ' + (task?.typeName || '计算事实')));
  head.append(titleBox, close);
  panel.append(head);

  if (!task) {
    panel.append(node('div', 'notice', '该任务不在当前分页，基础信息来自版本计算事实。返回任务所在页可查看完整来源结构字段。'));
  }

  const facts = node('dl', 'facts');
  const addFact = (label, value) => {
    const item = node('div', 'fact');
    item.append(node('dt', null, label), node('dd', null, value || '未知'));
    facts.append(item);
  };
  addFact('来源工单 ID', task?.sourceTaskId || fact?.sourceTaskId);
  addFact('原始状态', task?.rawStatus || fact?.rawStatus);
  addFact('职能', (task?.functionName || fact?.functionName) || (task?.functionResolution === 'missing' ? '未填写' : '待配置'));
  addFact('来源可用性', task ? (PRESENCE_NAMES[task.sourcePresence] ?? '待核对') : '计算事实未提供');
  addFact('最近同步', task ? formatDate(task.lastSyncedAt) : '计算事实未提供');
  const parentSourceTaskId = task?.parentSourceTaskId ?? fact?.parentSourceTaskId;
  const parentKey = task?.parentVisibleKey || management?.items.find(item => item.sourceTaskId === parentSourceTaskId)?.key;
  addFact('父任务编号', parentKey ? formatTaskNumber(parentKey, version.uniqueIdPrefix) : parentSourceTaskId ? '父任务未纳入' : '无');
  panel.append(facts);

  const issues = [...new Set([...(task?.structureIssues ?? []).map(code => ISSUE_NAMES[code] ?? code), ...(fact?.issues ?? [])])];
  if (issues.length) {
    const section = node('section', 'panel-section');
    section.append(node('h3', null, '当前问题'));
    const list = node('ul', 'issue-list');
    for (const item of issues) list.append(node('li', null, item));
    section.append(list);
    panel.append(section);
  }

  if (fact) {
    const section = node('section', 'panel-section');
    section.append(node('h3', null, '计算事实'));
    const facts2 = node('dl', 'facts');
    const add = (label, value) => {
      const item = node('div', 'fact');
      item.append(node('dt', null, label), node('dd', null, value));
      facts2.append(item);
    };
    const dev = fact.timing?.development?.workingDays;
    const test = fact.timing?.test?.workingDays;
    add('计划工作日', fact.planWorkingDays === null || fact.planWorkingDays === undefined ? '未知' : fact.planWorkingDays + ' 日');
    add('到期判断', fact.due?.overdue ? '已逾期 ' + fact.due.workingDays + ' 个工作日' : fact.due?.dueSoon ? '3 个工作日内到期' : fact.due ? '未逾期' : '不可判断');
    add('开发计时', dev === null || dev === undefined ? '未知' : dev + ' 个工作日');
    add('测试计时', test === null || test === undefined ? '未知' : test + ' 个工作日');
    section.append(facts2);
    panel.append(section);
  }

  const historySection = node('section', 'panel-section');
  historySection.append(node('h3', null, '来源历史'));
  const historyActions = node('div', 'section-actions');
  const historyBox = node('div', 'history-list');
  historyBox.append(node('div', 'history-item', '选择历史类型后读取。来源动态时间不等于系统观察时间。'));
  const read = kind => {
    historyBox.replaceChildren(node('div', 'history-item', '正在读取历史，请等待结果…'));
    api('/api/versions/' + version.id + '/tasks/' + encodeURIComponent(current.taskId) + '/history?kind=' + kind + '&offset=0')
      .then(data => renderHistoryItems(historyBox, data, kind))
      .catch(error => historyBox.replaceChildren(errorCard('历史读取失败：' + error.message)));
  };
  historyActions.append(button('来源动态', () => read('activities')), button('系统观察', () => read('observations')));
  historySection.append(historyActions, historyBox);
  panel.append(historySection);
  return panel;
}

function renderHistoryItems(container, data, kind) {
  container.replaceChildren();
  if (!data.items.length) {
    container.append(node('div', 'history-item', kind === 'activities' ? '当前没有来源动态记录。' : '当前没有系统观察记录。'));
    return;
  }
  for (const item of data.items) {
    const row = node('div', 'history-item');
    if (kind === 'activities') {
      row.append(node('b', null, item.action || '来源动态'), node('span', null, '发生：' + formatDate(item.occurredAt) + ' · 读取：' + formatDate(item.fetchedAt)));
    } else {
      let factsText = '';
      try {
        factsText = Object.entries(item.facts ?? {}).slice(0, 6).map(([key, value]) => key + '=' + (typeof value === 'object' ? JSON.stringify(value) : value)).join(' · ');
      } catch {
        factsText = '观察事实无法展开';
      }
      row.append(node('b', null, '系统观察到来源更新'), node('span', null, '观察：' + formatDate(item.observedAt) + ' · 来源更新：' + formatDate(item.sourceUpdatedAt)));
      if (factsText) row.append(node('div', 'cell-note', factsText));
    }
    container.append(row);
  }
  if (data.nextOffset !== null && data.nextOffset !== undefined) {
    container.append(node('div', 'history-item', '当前最多显示前 100 条；更多历史将在后续批次支持翻页。'));
  }
}

// Calendar geometry uses Beijing calendar days, independent of task time-of-day.
export function requirementCalendar(start, end, calendar = {}) {
  const localDay = value => {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    return Date.parse(key + 'T00:00:00Z');
  };
  const first = localDay(start), last = localDay(end);
  if (first === null || last === null || last < first || last - first > 3659 * 86400000) return [];
  const days = [];
  for (let at = first; at <= last; at += 86400000) {
    const key = new Date(at).toISOString().slice(0, 10), weekday = new Date(at).getUTCDay();
    const weekend = weekday === 0 || weekday === 6, entry = calendar[key];
    const working = typeof entry === 'boolean' ? entry : entry?.working ?? !weekend;
    days.push({ key, at, weekday, working, special: weekend && working });
  }
  return days;
}

async function renderRequirements(current, view) {
  setTitle('核心需求详情', '核心交付时间线与其他直属工作单');
  const versions = await loadVersions();
  if (!versions.length) {
    view.replaceChildren(emptyCard('暂无活跃版本，当前没有可查看的核心需求。'));
    return;
  }

  const version = current.versionId ? versions.find(item => item.id === current.versionId) : versions[0];
  if (!version) {
    setTitle('版本不存在', '当前可见版本中没有该对象');
    view.replaceChildren(errorCard('当前可见版本中没有该对象。', () => navigate('#/requirements')));
    return;
  }
  let management;
  try {
    management = await managementFor(version.id);
  } catch (error) {
    view.replaceChildren(errorCard('需求与阶段读取失败：' + error.message, () => route()));
    return;
  }
  const requirement = current.requirementId
    ? management.requirements.find(item => item.id === current.requirementId)
    : management.requirements[0] ?? null;
  if (!current.versionId || (!current.requirementId && requirement)) {
    const hash = requirementsHash(version.id, requirement?.id);
    history.replaceState(null, '', hash);
    syncVersionSelect(parseHash(hash));
  }
  const breadcrumbs = node('div', 'breadcrumbs');
  breadcrumbs.append(link('行动中心', '#/action'), node('span', null, '/'), link(version.displayName, versionHash(version.id)), node('span', null, '/'), node('b', null, requirement?.title || '核心需求'));
  const wrap = node('div');
  wrap.append(breadcrumbs);

  if (current.requirementId && !requirement) {
    wrap.append(errorCard('当前版本计算事实中没有该需求。', () => navigate(requirementsHash(version.id))));
  } else if (requirement) {
    const root = management.items.find(item => item.id === requirement.id);
    const direct = root ? management.items.filter(item => item.parentSourceTaskId === root.sourceTaskId) : [];
    const timelineItems = direct.filter(item => item.kind === 'professional' || item.typeName?.includes('测试'));
    const otherItems = direct.filter(item => !timelineItems.includes(item));
    const plannedStarts = direct.map(item => dayValue(item.plannedStartAt)).filter(value => value !== null);
    const plannedEnds = direct.map(item => dayValue(item.plannedDueAt)).filter(value => value !== null);
    const plannedStart = plannedStarts.length ? Math.min(...plannedStarts) : null;
    const plannedEnd = plannedEnds.length ? Math.max(...plannedEnds) : null;
    const terminalCount = direct.filter(item => ['delivered', 'non_delivery'].includes(item.semantic)).length;
    const issueCount = direct.filter(item => item.issues?.length).length;
    const currentStage = !requirement.stages.foundation?.complete ? '基础流程'
      : !requirement.stages.detail?.complete ? '全部内容制作'
        : !requirement.stages.test?.complete ? '测试阶段' : '已完成';

    const overview = node('section', 'card requirement-overview');
    const overviewMain = node('div', 'requirement-overview-main');
    overviewMain.append(node('div', 'note task-number', '核心需求 · ' + formatTaskNumber(root?.key, version.uniqueIdPrefix)), node('h1', 'requirement-title', requirement.title || '未命名需求'));
    overviewMain.append(node('div', 'requirement-meta', '需求负责人：' + (root?.executorName || '身份待核对') + ' · 版本：' + version.displayName + ' · 预计完成：' + formatDay(plannedEnd)));
    const tags = node('div', 'requirement-tags');
    const foundation = requirementStage(requirement.stages.foundation);
    tags.append(node('span', 'pill blue', '核心需求'), node('span', 'pill', direct.length + ' 张直属工作单'), node('span', 'pill', '基础流程 ' + foundation.text), node('span', 'pill', '风险待接入'));
    overviewMain.append(tags);
    const facts = node('div', 'requirement-overview-facts');
    const overviewFacts = [
      ['计划周期', plannedStart && plannedEnd ? formatDay(plannedStart) + ' → ' + formatDay(plannedEnd) : '日期未完整配置'],
      ['终态工作单', terminalCount + ' / ' + direct.length],
      ['当前阶段', currentStage],
      ['数据异常', issueCount + ' 张']
    ];
    const factGroups = [node('div', 'requirement-fact-group'), node('div', 'requirement-fact-group')];
    for (const [index, [label, value]] of overviewFacts.entries()) {
      const fact = node('div', 'requirement-overview-fact');
      fact.append(node('span', 'note', label), node('b', null, value));
      factGroups[index % 2].append(fact);
    }
    facts.append(...factGroups);
    overview.append(overviewMain, facts);
    wrap.append(overview);

    const timelineSection = node('section', 'requirement-section');
    const timelineHead = node('div', 'section-head');
    timelineHead.append(node('div', null));
    timelineHead.firstChild.append(node('div', 'section-title', '工单时间线'), node('div', 'note', timelineItems.length + ' 张核心专业子单与测试工作单'));
    timelineHead.append(link('打开版本任务', versionHash(version.id), 'button small'));
    timelineSection.append(timelineHead);
    const timelineCard = node('div', 'card requirement-timeline-card');
    if (!timelineItems.length) {
      timelineCard.append(emptyCard('当前需求没有可识别的核心专业子单或测试工作单。'));
    } else {
      const timeline = node('div', 'requirement-timeline');
      const timelineInner = node('div', 'requirement-timeline-inner');
      timeline.tabIndex = 0;
      timeline.setAttribute('role', 'region');
      timeline.setAttribute('aria-label', '按日工单时间线，可横向滚动；左侧工单信息固定');
      const days = requirementCalendar(plannedStart, plannedEnd, management.calendar);
      timelineInner.style.setProperty('--day-count', String(Math.max(1, days.length)));
      const axis = node('div', 'requirement-timeline-axis');
      axis.append(node('div', 'requirement-axis-corner', '职能 / 工单 / 起止时间'));
      const axisTrack = node('div', 'requirement-axis-track');
      if (days.length) {
        const weeks = node('div', 'requirement-weeks'), dates = node('div', 'requirement-dates');
        for (let index = 0; index < days.length;) {
          let end = index + 1;
          while (end < days.length && days[end].weekday !== 1) end++;
          const week = node('span', null, 'W' + (weeks.childElementCount + 1) + ' · ' + days[index].key.slice(5) + '–' + days[end - 1].key.slice(5));
          week.style.gridColumn = 'span ' + (end - index);
          weeks.append(week); index = end;
        }
        for (const day of days) {
          const cell = node('div', 'requirement-day' + (!day.working ? ' rest' : day.special ? ' special' : ''));
          cell.append(node('strong', null, day.key.slice(8)), node('small', null, '日一二三四五六'[day.weekday]));
          if (!day.working || day.special) cell.append(node('em', null, day.special ? '班' : '休'));
          dates.append(cell);
        }
        axisTrack.append(weeks, dates);
      } else {
        axisTrack.append(node('span', 'requirement-range-note', '日期范围未完整配置或超过十年；请查看每张工单的起止时间'));
      }
      axis.append(axisTrack);
      timelineInner.append(axis);
      const today = requirementCalendar(new Date(), new Date())[0]?.key;
      const todayIndex = days.findIndex(day => day.key === today);
      for (const item of timelineItems) {
        const row = node('div', 'requirement-timeline-row');
        const label = node('div', 'requirement-timeline-label');
        label.append(node('b', null, (item.functionName || item.typeName || '职能待核对') + ' · ' + item.title), node('span', null, formatDay(item.plannedStartAt) + ' → ' + formatDay(item.plannedDueAt) + (item.planWorkingDays === null || item.planWorkingDays === undefined ? '' : ' · ' + item.planWorkingDays + ' 个工作日')));
        const track = node('div', 'requirement-track');
        const itemDays = requirementCalendar(item.plannedStartAt, item.plannedDueAt);
        const startIndex = days.findIndex(day => day.key === itemDays[0]?.key);
        const endIndex = days.findIndex(day => day.key === itemDays.at(-1)?.key);
        for (const day of days) track.append(node('span', 'requirement-day-cell' + (!day.working ? ' rest' : day.special ? ' special' : '')));
        if (todayIndex >= 0) {
          const marker = node('span', 'requirement-today');
          marker.style.left = ((todayIndex + .5) / days.length * 100) + '%';
          marker.title = '今天（北京时间）：' + today;
          track.append(marker);
        }
        if (startIndex >= 0 && endIndex >= startIndex) {
          const bar = node('div', 'requirement-bar ' + (item.due?.overdue ? 'risk' : ['delivered', 'non_delivery'].includes(item.semantic) ? 'done' : item.semantic === 'not_started' ? 'pending' : item.semantic ? 'active' : 'unknown'), item.rawStatus || '状态未知');
          bar.style.left = (startIndex / days.length * 100) + '%';
          bar.style.width = ((endIndex - startIndex + 1) / days.length * 100) + '%';
          bar.title = item.title + ' · ' + item.rawStatus + ' · ' + formatDay(item.plannedStartAt) + ' → ' + formatDay(item.plannedDueAt);
          track.append(bar);
        } else {
          track.append(node('div', 'requirement-unplanned', '周期未配置，不绘制时间条'));
        }
        row.append(label, track);
        timelineInner.append(row);
      }
      timeline.append(timelineInner);
      const legend = node('div', 'requirement-timeline-legend');
      for (const [tone, text] of [['done', '终态'], ['active', '进行中 / 处理中'], ['pending', '未开始'], ['risk', '已逾期'], ['rest', '休息日（不计工作日）'], ['special', '特殊工作日（计工作日）']]) {
        const entry = node('span'); entry.append(node('i', 'requirement-legend-dot ' + tone), node('span', null, text)); legend.append(entry);
      }
      legend.append(node('span', null, '灰线：今天（北京时间）；日期缺失或范围异常不绘制时间条'));
      timelineCard.append(timeline, legend);
    }
    timelineSection.append(timelineCard);
    wrap.append(timelineSection);

    const otherSection = node('section', 'requirement-section');
    const otherHead = node('div', 'section-head');
    otherHead.append(node('div', null), node('span', 'pill', otherItems.length + ' 张'));
    otherHead.firstChild.append(node('div', 'section-title', '其他直属工作单'), node('div', 'note', '不展开第二层后代；完整来源事实从版本任务进入'));
    otherSection.append(otherHead);
    if (!otherItems.length) {
      otherSection.append(emptyCard('当前需求没有其他直属工作单。'));
    } else {
      const grid = node('div', 'requirement-other-grid');
      for (const item of otherItems) {
        const card = node('article', 'card requirement-work-card');
        const cardHead = node('div', 'requirement-work-head');
        cardHead.append(node('span', 'pill', item.typeName || item.kind), node('span', 'pill ' + (item.due?.overdue ? 'red' : 'blue'), item.rawStatus || '状态未知'));
        card.append(cardHead, node('div', 'requirement-work-name', item.title), node('div', 'note', (item.executorName || '执行者身份待核对') + ' · ' + formatDay(item.plannedStartAt) + ' → ' + formatDay(item.plannedDueAt)), node('div', 'requirement-work-foot', item.issues?.length ? item.issues.length + ' 项数据问题' : '当前无数据问题'));
        grid.append(card);
      }
      otherSection.append(grid);
    }
    wrap.append(otherSection);
  }

  const card = node('div', 'card requirement-list');
  const head = node('div', 'section-head');
  const titles = node('div');
  titles.append(node('div', 'section-title', '核心需求阶段'), node('div', 'note', '当前版本共 ' + management.requirements.length + ' 个核心需求'));
  const actions = node('div', 'section-actions');
  actions.append(node('span', 'pill blue', management.requirements.length + ' 个'));
  head.append(titles, actions);
  card.append(head);
  const rows = management.requirements.map(requirement => {
    const row = node('tr');
    const name = node('td');
    name.append(link(requirement.title || '未命名需求', requirementsHash(version.id, requirement.id), 'version-name'), node('div', 'cell-note task-number', formatTaskNumber(management.items.find(item => item.id === requirement.id)?.key, version.uniqueIdPrefix)));
    row.append(name);
    for (const key of ['foundation', 'detail', 'test']) {
      const state = requirementStage(requirement.stages[key]);
      const cell = node('td');
      cell.append(node('span', 'pill ' + state.cls, state.text));
      appendStageDetails(cell, requirement.stages[key]);
      row.append(cell);
    }
    const action = node('td');
    action.append(link('查看需求', requirementsHash(version.id, requirement.id), 'row-link'));
    row.append(action);
    return row;
  });
  card.append(buildTable('核心需求列表', ['需求', '基础流程', '细节完整', '测试阶段', '操作'], rows, '当前版本没有可识别的核心需求。'));
  wrap.append(card);
  view.replaceChildren(wrap);
}

async function renderPeople(view) {
  setTitle('人员', '业务人员与系统权限分开；人员详情和任务事实下钻待后续批次');

  const card = node('div', 'card');
  const head = node('div', 'section-head');
  const titles = node('div');
  titles.append(node('div', 'section-title', '当前身份'), node('div', 'note', 'Teambition 身份、版本负责人或执行者身份不会自动产生后台权限'));
  head.append(titles, node('span', 'pill blue', ROLE_NAMES[state.actor.role] ?? '权限未知'));
  card.append(head);
  const facts = node('dl', 'facts');
  for (const [label, value] of [['姓名', state.actor.displayName], ['系统权限', ROLE_NAMES[state.actor.role] ?? '未知'], ['身份状态', '已通过本次会话鉴权']]) {
    const item = node('div', 'fact');
    item.append(node('dt', null, label), node('dd', null, value));
    facts.append(item);
  }
  card.append(facts);

  const placeholder = node('div', 'placeholder');
  placeholder.append(
    node('h2', null, '人员详情待下一批接入'),
    node('p', null, '后续批次将提供人员汇总、业务角色、任务事实和权限分离展示。本批不展示演示人员、虚构参与度或自动推断的后台权限。'),
    node('p', null, '现有人员权限维护和身份登记入口仍保留在功能验收。')
  );
  const actions = node('div', 'section-actions');
  actions.append(link('打开功能验收', '/acceptance', 'button primary'));
  placeholder.append(actions);
  view.replaceChildren(card, placeholder);
}

function updateAnomalyBadge(contexts) {
  const badge = $('anomaly-badge');
  const failed = contexts.some(item => item.error);
  if (failed) {
    badge.hidden = true;
    badge.removeAttribute('title');
    return;
  }
  const count = contexts.reduce((total, item) => total + (item.management ? summarizeManagement(item.management).issueTasks : 0), 0);
  badge.textContent = String(count);
  badge.hidden = count === 0;
  badge.title = count + ' 张工单存在当前问题标记';
}

async function renderAnomalies(current, view) {
  setTitle('异常与审计', '当前异常工单与处理入口 · 配置及权限审计');

  const allContexts = await loadVersionContexts();
  updateAnomalyBadge(allContexts);
  const contexts = current.versionId ? allContexts.filter(context => context.version.id === current.versionId) : allContexts;
  if (current.versionId && !contexts.length) { view.replaceChildren(errorCard('所选版本不存在或已退出活跃范围。')); return; }
  const failed = contexts.filter(item => item.error).length;
  const known = contexts.filter(item => item.management);
  const total = failed ? '未知' : known.reduce((sum, item) => sum + summarizeManagement(item.management).issueTasks, 0);
  const metrics = node('div', 'metrics');
  metrics.append(
    metricCard('受影响工单', total, failed ? failed + ' 个版本读取失败，不能汇总' : '按版本计算事实去重', 'amber'),
    metricCard('版本数', contexts.length, '当前可见已纳入版本', 'blue'),
    metricCard('读取失败', failed, failed ? '失败不伪装成无异常' : '全部版本计算事实可读', failed ? 'red' : 'blue')
  );
  const rows = contexts.map(context => {
    const row = node('tr');
    const name = node('td');
    name.append(link(context.version.displayName, versionHash(context.version.id), 'version-name'), node('div', 'cell-note', context.version.projectName ?? ''));
    row.append(name);
    if (context.error) {
      row.append(node('td', null, '读取失败'), node('td', 'wrap', context.error.message), node('td', null, formatDate(context.version.lastSuccessAt)));
    } else {
      const counts = summarizeManagement(context.management);
      const types = new Map();
      for (const fact of context.management.items) for (const issue of fact.issues ?? []) types.set(issue, (types.get(issue) ?? 0) + 1);
      row.append(node('td', null, counts.issueTasks + ' 张'), node('td', 'wrap', [...types.entries()].map(([text, count]) => text + ' ' + count).join('；') || '当前无问题标记'), node('td', null, formatDate(context.management.sourceSnapshotAt)));
    }
    const action = node('td');
    action.append(link('打开版本', versionHash(context.version.id), 'row-link'));
    row.append(action);
    return row;
  });
  const card = node('div', 'card');
  card.append(buildTable('异常与审计当前汇总', ['版本', '受影响工单', '问题类型', '来源快照', '操作'], rows, '尚未纳入版本。'));
  const notice = node('div', 'notice');
  notice.append(node('p', null, '本页不把缺失、读取失败或未映射状态显示为零。状态映射验证后的恢复、异常去重、处理记录和审计筛选仍待后续批次接入。'));
  const actions = node('div', 'section-actions');
  actions.append(link('打开功能验收', '/acceptance', 'button small'));
  notice.append(actions);
  const issueCard = node('section', 'card');
  issueCard.append(node('h2', 'section-title', '异常工单明细'));
  const issueRows = contexts.flatMap(context => (context.management?.items ?? []).filter(item => item.issues?.length).map(item => {
    const row = node('tr');
    const title = node('td');
    title.append(link(item.title, taskHash(context.version.id, 0, item.sourceTaskId), 'row-link'), node('div', 'cell-note', context.version.displayName));
    const actions = node('td');
    actions.append(link('查看工单', taskHash(context.version.id, 0, item.sourceTaskId), 'row-link'));
    if (item.issues.some(issue => issue.includes('映射'))) actions.append(node('span', null, ' · '), link('核对状态语义', '#/config?section=status', 'row-link'));
    row.append(title, node('td', 'wrap', item.issues.join('；')), actions);
    return row;
  }));
  issueCard.append(buildTable('当前异常工单', ['工单 / 版本', '问题与影响', '处理入口'], issueRows, failed ? '当前读取不完整，不能判断为无异常。' : '当前计算事实没有问题标记。'));
  const audit = node('section', 'card');
  audit.append(node('h2', 'section-title', '审计记录'));
  if (['admin', 'owner'].includes(state.actor.role)) {
    const records = node('div');
    const load = async () => {
      records.replaceChildren(loading('正在读取最近 100 条系统审计记录…'));
      try {
        const events = await api('/api/audit');
        const rows = events.map(event => {
          const row = node('tr');
          const changes = node('td');
          const details = node('details');
          details.append(node('summary', null, '查看前后值'));
          details.append(node('pre', 'audit-values', JSON.stringify({ before: event.before_value, after: event.after_value }, null, 2)));
          changes.append(details);
          row.append(node('td', null, formatDate(event.occurred_at)), node('td', null, event.action), node('td', 'wrap', event.reason || '未记录原因'), changes);
          return row;
        });
        records.replaceChildren(buildTable('最近系统审计', ['时间', '操作', '原因', '前后值'], rows, '暂无审计记录。'));
      } catch (error) { records.replaceChildren(errorCard(error.message, load)); }
    };
    audit.append(node('p', 'note', '最近 100 条系统记录，跨版本展示。完整审计历史仍保存在数据库中；本页不提供删除。'), button('刷新审计', load, 'button small'), records);
    void load();
  } else audit.append(node('p', 'note', '审计记录仅系统管理员及所有者可查看。'));
  notice.replaceChildren(node('p', null, '异常依据当前来源事实与映射重新计算。请在对应配置或来源中修正，恢复后保留审计；本页不提供绕过校验的手动清除。反馈校验和投递失败尚未合并为统一事项。'));
  view.replaceChildren(metrics, card, issueCard, audit, notice);
}

function placeholderPage(view, title, sub, heading, paragraphs, bullets, actions) {
  setTitle(title, sub);

  const box = node('div', 'placeholder');
  box.append(node('h2', null, heading));
  for (const text of paragraphs) box.append(node('p', null, text));
  if (bullets.length) {
    const list = node('ul');
    for (const text of bullets) list.append(node('li', null, text));
    box.append(list);
  }
  const actionBox = node('div', 'section-actions');
  for (const [label, href, primary] of actions) actionBox.append(link(label, href, 'button ' + (primary ? 'primary' : 'small')));
  box.append(actionBox);
  view.replaceChildren(box);
}

function renderParticipation(view) {
  placeholderPage(
    view,
    '人力参与度',
    'P11 正式人力参与度后端尚未接入；不展示演示图表或虚构统计',
    '人力参与度待后续批次接入',
    ['本批只交付正式页面壳、真实版本列表和任务下钻。年度开发、调优、空闲色带、未知斜纹与统计口径仍归 P11。'],
    ['不把演示数据作为正式结果。', '不根据人员详情访问自动授予后台权限。', '人员参与度需要独立后端计算与验收。'],
    [['打开功能验收', '/acceptance', true], ['查看版本任务', '#/versions', false]]
  );
}

async function renderConfig(view, current) {
  setTitle('配置库', '版本与规则 · 状态语义 · 人员与通知');
  const layout = node('div', 'config-layout');
  const tabs = node('nav', 'config-tabs');
  tabs.setAttribute('aria-label', '配置分类');
  const content = node('div', 'config-content');
  const response = await fetch('/acceptance');
  if (!response.ok) throw new Error('配置表单读取失败，请重试。');
  // shortcut: reuse the shipped acceptance form; extract a shared template when its structure diverges.
  const document = new DOMParser().parseFromString(await response.text(), 'text/html');
  const forms = document.querySelector('#management-rules');
  if (!forms) throw new Error('配置表单不完整，请联系管理员。');
  forms.hidden = false;
  forms.className = 'card config-forms';
  forms.querySelector('h2').textContent = '版本与规则';
  forms.querySelector('h2 + p').textContent = '配置按系统、版本和需求逐层继承。保存前预览影响；状态映射保存后须验证恢复。';
  forms.querySelector('#mg-results').hidden = true;
  const detailForms = [...forms.querySelectorAll(':scope > details')];
  const people = node('section', 'card');
  people.hidden = true;
  people.append(node('h2', 'section-title', '人员与权限'),
    node('p', 'note', '业务角色与系统权限分别维护。仅所有者可调整系统权限；身份登记和停用仍从功能验收操作。'));
  const roles = node('div');
  people.append(roles, link('身份与权限维护', '/acceptance', 'button small'));
  let peopleLoaded = false;
  async function showPeople() {
    if (peopleLoaded) return;
    roles.replaceChildren(loading());
    try {
      if (state.actor.role !== 'owner') {
        roles.replaceChildren(node('p', null, '当前身份：' + state.actor.displayName + ' · ' + (ROLE_NAMES[state.actor.role] ?? '权限未知')),
          node('p', 'note', '完整系统权限清单仅对所有者开放。'));
      } else {
        const records = await api('/api/access');
        const rows = records.map(person => {
          const row = node('tr');
          row.append(node('td', null, person.displayName), node('td', null, ROLE_NAMES[person.role] ?? '未知'),
            node('td', null, person.active && person.mappingEnabled && person.confirmed ? '身份有效' : '停用或未确认'));
          return row;
        });
        roles.replaceChildren(buildTable('人员与权限', ['人员', '系统权限', '身份状态'], rows, '暂无可读取人员。'));
      }
      peopleLoaded = true;
    } catch (error) { roles.replaceChildren(errorCard(error.message, showPeople)); }
  }
  const rulesNotice = node('div', 'notice');
  rulesNotice.append(node('p', null, '通知对象依据已确认身份、版本负责人和有效执行者确定。权限角色不自动推定业务角色，修改本页配置不会直接发送消息。'));
  people.append(rulesNotice);
  function selectTab(name) {
    people.hidden = name !== 'people';
    forms.hidden = name === 'people';
    forms.querySelector('h2').textContent = name === 'status' ? '状态语义' : '版本与规则';
    for (const details of detailForms) {
      const status = Boolean(details.querySelector('#mg-mapping-form'));
      details.hidden = name === 'status' ? !status : status;
      if (status && name === 'status') details.open = true;
    }
    for (const item of tabs.children) {
      const active = item.dataset.tab === name;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    }
    if (name === 'people') void showPeople();
  }
  for (const [name, label] of [['rules', '版本与规则'], ['status', '状态语义'], ['people', '人员与通知']]) {
    const item = button(label, () => selectTab(name), 'nav');
    item.dataset.tab = name;
    tabs.append(item);
  }
  content.append(forms, people);
  layout.append(tabs, content);
  view.append(layout);
  await setupManagement(state.actor, (path, method = 'GET', body) => api(path, { method, body }), forms);
  selectTab(new URLSearchParams(current.raw.split('?')[1] ?? '').get('section') === 'status' ? 'status' : 'rules');
}

function renderHistory(view) {
  placeholderPage(
    view,
    '历史查询',
    'P10 生命周期与留档后端尚未接入；当前可查看版本任务的来源历史',
    '历史查询待后续批次接入',
    ['本批不展示演示留档、上线结论或虚构历史统计。来源动态和系统观察记录已能在版本任务详情中读取。'],
    ['来源动态时间不能替代实际状态发生时间。', '观察历史只表示系统何时读到变化。', '历史统计仅应使用已确认留档且实际上线的版本。'],
    [['查看版本与任务', '#/versions', true], ['打开功能验收', '/acceptance', false]]
  );
}

function showLogin(message) {
  state.actor = null;
  $('boot').hidden = true;
  $('app').hidden = true;
  $('login-view').hidden = false;
  $('login-message').textContent = message;
  const code = new URL(location.href).searchParams.get('login');
  if (!message && code === '403') $('login-message').textContent = '当前钉钉身份未获授权，或企业身份验证未通过。';
  else if (!message && code) $('login-message').textContent = '登录失败，请重新发起或联系管理员。';
}

async function boot() {
  try {
    const health = await api('/healthz');
    if (!health.loginEnabled) {
      showLogin('服务可用，登录尚未启用。请先核对首位所有者、访问名单和钉钉回调配置。');
      $('login-link').hidden = true;
      return;
    }
    try {
      state.actor = await api('/api/me');
    } catch (error) {
      if (error.status === 401) {
        showLogin('');
        return;
      }
      throw error;
    }
    $('boot').hidden = true;
    $('login-view').hidden = true;
    $('app').hidden = false;
    $('side-user').textContent = state.actor.displayName + ' · ' + (ROLE_NAMES[state.actor.role] ?? '权限未知');
    $('role-chip').textContent = ROLE_NAMES[state.actor.role] ?? '权限未知';
    const canSync = ['admin', 'owner'].includes(state.actor.role);
    $('tb-sync').hidden = !canSync;
    if (canSync) $('tb-sync').addEventListener('click', syncLatestTb);
    $('logout').addEventListener('click', async () => {
      try {
        await api('/auth/logout', { method: 'POST', body: {} });
      } catch (error) {
        if (error.status !== 401) showMessage('退出登录未完成：' + error.message, 'error');
        return;
      }
      location.href = '/';
    });
    $('version-select').addEventListener('change', event => {
      const current = parseHash(location.hash);
      if (current.name === 'action') navigate(actionHash(event.target.value, selectedFunctions(current.raw), current.tab));
      else if (current.name === 'requirements') navigate(requirementsHash(event.target.value));
      else if (current.name === 'anomalies') navigate('#/anomalies' + (event.target.value ? '?version=' + encodeURIComponent(event.target.value) : ''));
      else if (event.target.value) navigate(versionHash(event.target.value));
      else navigate('#/versions');
    });
    window.addEventListener('hashchange', route);
    try {
      const versions = await loadVersions();
      populateVersionSelect(versions);
    } catch (error) {
      showMessage('版本列表读取失败：' + error.message, 'error');
    }
    await route();
  } catch (error) {
    $('boot').textContent = '服务暂不可用，请联系管理员检查数据库及配置。';
    $('boot').className = 'boot error-box';
  }
}

if (typeof document !== 'undefined') boot();





