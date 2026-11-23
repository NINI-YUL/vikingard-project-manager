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
  actionTab: 'delivery'
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

function formatSync(version) {
  const name = SYNC_NAMES[version.syncStatus] ?? '同步状态未知';
  const cls = version.syncStatus === 'failed' ? 'bad' : version.syncStatus === 'running' ? 'warn' : version.syncStatus === 'succeeded' ? 'ok' : '';
  return { name, cls };
}

function ownerText(version) {
  if (!version.ownerName) return '待确认';
  return version.ownerConfirmed ? version.ownerName : version.ownerName + '（身份待确认）';
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
  if (!stage.calculable) return { text: '不可计算', cls: 'amber' };
  return stage.complete ? { text: '已完成', cls: 'green' } : { text: '未完成', cls: 'blue' };
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
  const all = node('option', null, '全部版本');
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
  clearMessage();
  const current = parseHash(location.hash);
  if (!location.hash) history.replaceState(null, '', '#/action');
  setNav(current);
  syncVersionSelect(current);
  const view = $('view');
  view.replaceChildren(loading());
  try {
    await renderRoute(current);
  } catch (error) {
    if (error.status === 401) return;
    view.replaceChildren(errorCard(error.message ?? '页面读取失败', () => route()));
  }
  view.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function renderRoute(current) {
  const versions = await loadVersions();
  populateVersionSelect(versions);
  syncVersionSelect(current);
  if (current.name === 'action') return renderAction(current);
  if (current.name === 'versions') return renderVersions();
  if (current.name === 'versionDetail') return renderVersionDetail(current);
  if (current.name === 'requirements') return renderRequirements(current);
  if (current.name === 'people') return renderPeople();
  if (current.name === 'anomalies') return renderAnomalies();
  if (current.name === 'participation') return renderParticipation();
  if (current.name === 'config') return renderConfig();
  if (current.name === 'history') return renderHistory();
  setTitle('页面不存在', '请从左侧导航重新选择');
  $('view').replaceChildren(errorCard('该地址没有对应页面，可能来自旧链接。', () => navigate('#/action')));
}

function tabsNode(active) {
  const tabs = node('div', 'tabs');
  const delivery = link('风险与到期', '#/action', 'tab' + (active === 'delivery' ? ' active' : ''));
  const data = link('数据待处理', '#/action?tab=data', 'tab' + (active === 'data' ? ' active' : ''));
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

function dataTabNode(contexts) {
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
  actions.append(link('查看异常与审计', '#/anomalies', 'button small'), link('打开功能验收', '/acceptance', 'button small'));
  notice.append(actions);
  wrap.append(node('div', null, ''), notice);
  return wrap;
}

async function renderAction(current) {
  setTitle('行动中心', '全部活跃版本 · 风险与到期与数据待处理分开呈现');
  const view = $('view');
  const contexts = await loadVersionContexts();
  updateAnomalyBadge(contexts);
  const active = current.tab === 'data' ? 'data' : 'delivery';
  state.actionTab = active;
  const wrap = node('div');
  wrap.append(tabsNode(active));
  if (active === 'data') {
    wrap.append(dataTabNode(contexts));
    view.replaceChildren(wrap);
    return;
  }

  const summary = contexts.map(item => ({ ...item, counts: item.management ? summarizeManagement(item.management) : null }));
  const failed = summary.filter(item => item.error).length;
  const known = summary.filter(item => item.counts);
  const overdue = failed ? '未知' : known.reduce((total, item) => total + item.counts.overdue, 0);
  const dueSoon = failed ? '未知' : known.reduce((total, item) => total + item.counts.dueSoon, 0);

  const scope = node('div', 'scope');
  scope.append(
    node('span', null, '当前范围：' + summary.length + ' 个已纳入版本'),
    node('span', 'note', '风险等级与行动队列待后续批次接入；本页只显示已计算事实')
  );
  wrap.append(scope);

  const metrics = node('div', 'metrics');
  metrics.append(
    metricCard('高风险需求', '待接入', '风险规则尚未在本批启用', 'muted'),
    metricCard('需关注需求', '待接入', '不把缺失数据填成正常', 'muted'),
    metricCard('风险工单', '待接入', '反馈风险与阻塞判断待后续批次', 'muted'),
    metricCard('已逾期工单', overdue, failed ? failed + ' 个版本读取失败，不能汇总' : '按当前计划截止判断', 'red'),
    metricCard('即将到期工单', dueSoon, failed ? failed + ' 个版本读取失败，不能汇总' : '按当前工作日历判断', 'amber')
  );
  wrap.append(metrics);

  const rows = summary.map(item => {
    const row = node('tr');
    const versionCell = node('td');
    versionCell.append(link(item.version.displayName, versionHash(item.version.id), 'version-name'), node('div', 'cell-note', item.version.projectName ?? ''));
    row.append(versionCell, node('td', null, ownerText(item.version)));
    if (item.error) {
      row.append(statusCell(item.version));
      const error = node('td');
      error.append(node('div', null, '读取失败'), node('div', 'cell-note', item.error.message));
      row.append(error, node('td', null, '未知'), node('td', null, '未知'), node('td', null, '未知'), node('td', null, '未知'), node('td', null, '未知'));
    } else {
      const progress = item.management.progress;
      const opt = optimizationSummary(progress);
      const optCell = node('td');
      optCell.append(node('div', null, opt.text), node('div', 'cell-note', opt.detail));
      row.append(
        statusCell(item.version),
        stageCell(progress, 'foundation'),
        stageCell(progress, 'detail'),
        stageCell(progress, 'test'),
        optCell,
        node('td', null, item.counts.overdue + ' 张'),
        node('td', null, item.counts.issueTasks + ' 张')
      );
    }
    row.append(node('td', null, formatDate(item.version.lastSuccessAt)));
    return row;
  });

  wrap.append(buildTable('行动中心版本汇总', ['版本', '负责人', '来源同步', '基础流程', '细节完整', '测试阶段', '优化需求', '已逾期', '数据异常', '最近同步'], rows, '尚未纳入受控版本。管理员可从功能验收纳入版本。'));
  const notice = node('div', 'notice');
  notice.append(node('p', null, 'P09 首批范围是正式页面壳、真实版本列表与任务下钻。风险关注、数据待处理闭环、实际时间修正和日历外时段补录仍待后续批次；本页不展示演示风险或填零结果。'));
  const actions = node('div', 'section-actions');
  actions.append(link('查看版本列表', '#/versions', 'button small'), link('打开功能验收', '/acceptance', 'button small'));
  notice.append(actions);
  wrap.append(node('div', null, ''), notice);
  view.replaceChildren(wrap);
}

async function renderVersions() {
  setTitle('版本', '按纳入时间展示；点击版本查看真实任务与计算事实');
  const view = $('view');
  const contexts = await loadVersionContexts();
  updateAnomalyBadge(contexts);

  const card = node('div', 'card');
  const head = node('div', 'section-head');
  const titles = node('div');
  titles.append(node('div', 'section-title', '全部活跃版本'), node('div', 'note', '版本结束、终止和历史留档仍在后续批次接入'));
  const actions = node('div', 'section-actions');
  actions.append(node('span', 'pill blue', contexts.length + ' 个版本'));
  actions.append(button('刷新列表', async () => {
    state.versions = null;
    state.management.clear();
    state.tasks.clear();
    await route();
  }));
  head.append(titles, actions);
  card.append(head);

  const rows = contexts.map(context => {
    const row = node('tr');
    const versionCell = node('td');
    versionCell.append(link(context.version.displayName, versionHash(context.version.id), 'version-name'), node('div', 'cell-note', context.version.projectName ?? ''));
    row.append(versionCell, node('td', null, ownerText(context.version)), node('td', null, formatDate(context.version.syncStartAt)), statusCell(context.version));
    if (context.error) {
      row.append(node('td', null, '读取失败'), node('td', null, '未知'), node('td', null, '未知'), node('td', null, '未知'));
    } else {
      const progress = context.management.progress;
      const counts = summarizeManagement(context.management);
      const foundation = stageSummary(progress, 'foundation');
      const opt = optimizationSummary(progress);
      const foundationCell = node('td');
      foundationCell.append(node('div', null, foundation.text), node('div', 'cell-note', foundation.detail));
      const optCell = node('td');
      optCell.append(node('div', null, opt.text), node('div', 'cell-note', opt.detail));
      row.append(
        node('td', null, progress.coreRequirementCount + ' 个'),
        foundationCell,
        optCell,
        node('td', null, counts.issueTasks + ' 张')
      );
    }
    const action = node('td');
    action.append(link('打开版本', versionHash(context.version.id), 'row-link'));
    row.append(action);
    return row;
  });

  card.append(buildTable('版本列表', ['版本', '负责人', '同步起点', '来源同步', '核心需求', '基础流程', '优化需求', '数据异常', '操作'], rows, '尚未纳入受控版本。管理员可从功能验收纳入版本。'));
  view.replaceChildren(card);
}

async function renderVersionDetail(current) {
  const versions = await loadVersions();
  const version = versions.find(item => item.id === current.versionId);
  const view = $('view');
  if (!version) {
    setTitle('版本不存在', '该对象可能已移除，或链接不属于当前可见版本');
    view.replaceChildren(errorCard('当前可见版本中没有该对象。请返回版本列表重新选择。', () => navigate('#/versions')));
    return;
  }
  setTitle(version.displayName, (version.projectName ?? '来源项目未知') + ' · 负责人：' + ownerText(version));

  const breadcrumbs = node('div', 'breadcrumbs');
  breadcrumbs.append(link('版本', '#/versions'), node('span', null, '/'), node('b', null, version.displayName));
  view.replaceChildren(breadcrumbs, loading());

  const [managementResult, tasksResult] = await Promise.allSettled([
    managementFor(version.id),
    tasksFor(version.id, current.offset)
  ]);
  const management = managementResult.status === 'fulfilled' ? managementResult.value : null;
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : null;
  const wrap = node('div');
  wrap.append(breadcrumbs);

  if (managementResult.status === 'rejected') {
    wrap.append(errorCard('计算事实读取失败：' + managementResult.reason.message, async () => {
      clearVersionCaches(version.id);
      await route();
    }));
  }

  const summary = node('div', 'summary-strip');
  const summaryItems = [
    ['来源同步', formatSync(version).name + ' · ' + formatDate(version.lastSuccessAt) + (version.lastErrorCode ? ' · ' + version.lastErrorCode : '')],
    ['同步起点（北京时间）', formatDate(version.syncStartAt)],
    ['来源快照', management ? formatDate(management.sourceSnapshotAt) : '未知'],
    ['计算版本', management ? 'revision ' + management.revision : '未知'],
    ['负责人身份', version.ownerConfirmed ? '已确认' : '待确认；自动同步暂停']
  ];
  for (const [label, value] of summaryItems) {
    const item = node('div', 'summary-item');
    item.append(node('span', 'note', label), node('b', null, value));
    summary.append(item);
  }
  wrap.append(summary);

  if (management) {
    const counts = summarizeManagement(management);
    const progress = management.progress;
    const metrics = node('div', 'metrics');
    const foundation = stageSummary(progress, 'foundation');
    const detail = stageSummary(progress, 'detail');
    const test = stageSummary(progress, 'test');
    const opt = optimizationSummary(progress);
    metrics.append(
      metricCard('基础流程', foundation.text, foundation.detail, 'blue'),
      metricCard('细节完整', detail.text, detail.detail, 'blue'),
      metricCard('测试阶段', test.text, test.detail, 'blue'),
      metricCard('优化需求', opt.text, opt.detail, 'blue'),
      metricCard('已逾期', counts.overdue, '按当前计划截止判断', 'red'),
      metricCard('即将到期', counts.dueSoon, '按当前工作日历判断', 'amber'),
      metricCard('数据异常', counts.issueTasks, '有当前问题标记的工单数', counts.issueTasks ? 'amber' : 'blue')
    );
    wrap.append(metrics);

    const reqCard = node('div', 'card');
    const reqHead = node('div', 'section-head');
    const reqTitles = node('div');
    reqTitles.append(node('div', 'section-title', '核心需求阶段'), node('div', 'note', '阶段未知保留为不可计算，不以零代替'));
    const reqActions = node('div', 'section-actions');
    reqActions.append(link('查看需求页', requirementsHash(version.id), 'button small'));
    reqHead.append(reqTitles, reqActions);
    reqCard.append(reqHead);
    const reqRows = management.requirements.map(requirement => {
      const row = node('tr');
      const name = node('td');
      name.append(link(requirement.title || '未命名需求', requirementsHash(version.id, requirement.id), 'version-name'), node('div', 'cell-note', '需求 ID ' + requirement.id));
      row.append(name);
      for (const key of ['foundation', 'detail', 'test']) {
        const stage = requirementStage(requirement.stages[key]);
        const cell = node('td');
        cell.append(node('span', 'pill ' + stage.cls, stage.text));
        const missing = requirement.stages[key]?.missingFunctions ?? [];
        if (missing.length) cell.append(node('div', 'cell-note', '缺少职能：' + missing.join('、')));
        row.append(cell);
      }
      const action = node('td');
      action.append(link('查看需求', requirementsHash(version.id, requirement.id), 'row-link'));
      row.append(action);
      return row;
    });
    reqCard.append(buildTable('核心需求阶段', ['需求', '基础流程', '细节完整', '测试阶段', '操作'], reqRows, '当前版本没有可识别的核心需求。'));
    wrap.append(reqCard);
  }

  const taskCard = node('div', 'card');
  const taskHead = node('div', 'section-head');
  const taskTitles = node('div');
  taskTitles.append(node('div', 'section-title', '任务快照与下钻'), node('div', 'note', '点击任务查看来源事实、计算问题与来源历史；筛选仅作用于当前页'));
  const taskActions = node('div', 'section-actions');
  taskActions.append(button('刷新本页', async () => {
    clearVersionCaches(version.id);
    await route();
  }));
  taskHead.append(taskTitles, taskActions);
  taskCard.append(taskHead);

  if (!tasks) {
    taskCard.append(errorCard('任务快照读取失败：' + tasksResult.reason.message, async () => {
      state.tasks.delete(version.id + ':' + current.offset);
      await route();
    }));
    wrap.append(taskCard);
    view.replaceChildren(wrap);
    return;
  }

  const layout = node('div', 'task-layout' + (current.taskId ? ' with-panel' : ''));
  const taskList = node('div');
  taskList.append(renderTaskList(version, tasks, current));
  layout.append(taskList);
  if (current.taskId) layout.append(renderTaskPanel(version, tasks, management, current));
  taskCard.append(layout);
  wrap.append(taskCard);
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
    row.dataset.search = (item.visibleKey + ' ' + item.title).toLowerCase();
    row.dataset.type = item.typeName ?? '';
    row.dataset.fn = item.functionName || (item.functionResolution === 'missing' ? '未填写' : '职能待配置');
    row.dataset.issues = (item.structureIssues?.length ? '1' : '0');
    row.tabIndex = 0;

    const keyCell = node('td');
    keyCell.append(link(item.visibleKey || '无编号', taskHash(version.id, current.offset, item.sourceTaskId), 'version-name'));
    keyCell.append(node('div', 'cell-note', item.category ?? '分类未填写'));
    const titleCell = node('td', 'wrap');
    titleCell.append(node('div', null, item.title || '未填写标题'));
    titleCell.append(node('div', 'cell-note', item.sourceTaskId));
    const typeCell = node('td');
    typeCell.append(node('div', null, item.typeName ?? '未知类型'), node('div', 'cell-note', item.functionName || (item.functionResolution === 'confirmed' ? '' : '职能待配置')));
    const parentCell = node('td');
    parentCell.append(node('div', null, item.parentVisibleKey || (item.parentSourceTaskId ? '父任务未纳入' : '无')));
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

  const table = buildTable('任务快照', ['编号', '标题', '类型与职能', '父任务', '原始状态与来源', '结构检查', '操作'], tableRows, '当前页没有任务。');
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
  titleBox.append(node('div', 'note', (task?.visibleKey || fact?.key || '无编号') + ' · ' + (task?.typeName || '计算事实')));
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
  addFact('父任务', task ? (task.parentVisibleKey || (task.parentSourceTaskId ? '父任务未纳入' : '无')) : '计算事实未提供');
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

async function renderRequirements(current) {
  setTitle('需求', '按版本查看真实核心需求与阶段计算；工单层级下钻仍从版本详情进入');
  const view = $('view');
  const versions = await loadVersions();
  if (!current.versionId) {
    const card = node('div', 'card');
    const head = node('div', 'section-head');
    const titles = node('div');
    titles.append(node('div', 'section-title', '选择版本查看需求'), node('div', 'note', '需求完成数来自当前计算事实，未知保留不可计算'));
    head.append(titles, node('span', 'pill blue', versions.length + ' 个版本'));
    card.append(head);
    const rows = versions.map(version => {
      const row = node('tr');
      row.append(node('td', null, version.displayName), node('td', null, version.projectName ?? '未知项目'), node('td', null, ownerText(version)), statusCell(version));
      const action = node('td');
      action.append(link('查看需求', requirementsHash(version.id), 'row-link'), node('span', null, ' · '), link('任务', versionHash(version.id), 'row-link'));
      row.append(action);
      return row;
    });
    card.append(buildTable('需求版本选择', ['版本', '项目', '负责人', '来源同步', '操作'], rows, '尚未纳入受控版本。'));
    view.replaceChildren(card);
    return;
  }

  const version = versions.find(item => item.id === current.versionId);
  if (!version) {
    setTitle('版本不存在', '当前可见版本中没有该对象');
    view.replaceChildren(errorCard('当前可见版本中没有该对象。', () => navigate('#/requirements')));
    return;
  }
  setTitle('需求 · ' + version.displayName, version.projectName ?? '来源项目未知');
  let management;
  try {
    management = await managementFor(version.id);
  } catch (error) {
    view.replaceChildren(errorCard('需求与阶段读取失败：' + error.message, () => route()));
    return;
  }
  const breadcrumbs = node('div', 'breadcrumbs');
  breadcrumbs.append(link('需求', '#/requirements'), node('span', null, '/'), link(version.displayName, requirementsHash(version.id)), current.requirementId ? node('b', null, '需求详情') : node('span', null, '需求列表'));
  const wrap = node('div');
  wrap.append(breadcrumbs);

  if (current.requirementId) {
    const requirement = management.requirements.find(item => item.id === current.requirementId);
    if (!requirement) {
      wrap.append(errorCard('当前版本计算事实中没有该需求。', () => navigate(requirementsHash(version.id))));
    } else {
      const card = node('div', 'card');
      const head = node('div', 'section-head');
      const titles = node('div');
      titles.append(node('div', 'section-title', requirement.title || '未命名需求'), node('div', 'note', '需求 ID ' + requirement.id));
      const actions = node('div', 'section-actions');
      actions.append(link('打开版本任务', versionHash(version.id), 'button small'), button('返回需求列表', () => navigate(requirementsHash(version.id))));
      head.append(titles, actions);
      card.append(head);
      const grid = node('div', 'stage-grid');
      for (const [key, label] of [['foundation', '基础流程'], ['detail', '细节完整'], ['test', '测试阶段']]) {
        const stage = requirement.stages[key];
        const state = requirementStage(stage);
        const item = node('div', 'stage ' + (stage?.complete ? 'ok' : stage?.calculable === false ? 'unknown' : ''));
        item.append(node('b', null, label), node('span', null, state.text));
        if (stage?.missingFunctions?.length) item.append(node('div', 'cell-note', '缺少职能：' + stage.missingFunctions.join('、')));
        if (stage?.structureUnknown) item.append(node('div', 'cell-note', '结构未知，阶段暂停判断'));
        if (stage?.blockedTaskIds?.length) item.append(node('div', 'cell-note', '受影响任务：' + stage.blockedTaskIds.length + ' 张'));
        grid.append(item);
      }
      card.append(grid);
      wrap.append(card);
    }
  }

  const card = node('div', 'card');
  const head = node('div', 'section-head');
  const titles = node('div');
  titles.append(node('div', 'section-title', '核心需求阶段'), node('div', 'note', '当前版本共 ' + management.requirements.length + ' 个核心需求'));
  const actions = node('div', 'section-actions');
  actions.append(link('打开版本任务', versionHash(version.id), 'button small'));
  head.append(titles, actions);
  card.append(head);
  const rows = management.requirements.map(requirement => {
    const row = node('tr');
    const name = node('td');
    name.append(link(requirement.title || '未命名需求', requirementsHash(version.id, requirement.id), 'version-name'), node('div', 'cell-note', requirement.id));
    row.append(name);
    for (const key of ['foundation', 'detail', 'test']) {
      const state = requirementStage(requirement.stages[key]);
      const cell = node('td');
      cell.append(node('span', 'pill ' + state.cls, state.text));
      if (requirement.stages[key]?.blockedTaskIds?.length) cell.append(node('div', 'cell-note', '受影响任务：' + requirement.stages[key].blockedTaskIds.length + ' 张'));
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

async function renderPeople() {
  setTitle('人员', '业务人员与系统权限分开；人员详情和任务事实下钻待后续批次');
  const view = $('view');
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

async function renderAnomalies() {
  setTitle('异常与审计', '当前仅汇总版本计算返回的问题标记；完整事项、处理闭环与审计待后续批次');
  const view = $('view');
  const contexts = await loadVersionContexts();
  updateAnomalyBadge(contexts);
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
  view.replaceChildren(metrics, card, notice);
}

function placeholderPage(title, sub, heading, paragraphs, bullets, actions) {
  setTitle(title, sub);
  const view = $('view');
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

function renderParticipation() {
  placeholderPage(
    '人力参与度',
    'P11 正式人力参与度后端尚未接入；不展示演示图表或虚构统计',
    '人力参与度待后续批次接入',
    ['本批只交付正式页面壳、真实版本列表和任务下钻。年度开发、调优、空闲色带、未知斜纹与统计口径仍归 P11。'],
    ['不把演示数据作为正式结果。', '不根据人员详情访问自动授予后台权限。', '人员参与度需要独立后端计算与验收。'],
    [['打开功能验收', '/acceptance', true], ['查看版本任务', '#/versions', false]]
  );
}

function renderConfig() {
  placeholderPage(
    '配置库',
    '正式配置页将在后续批次整合；现有规则、状态、日历、反馈与权限验收入口保留',
    '配置库页面待后续批次接入',
    ['当前 P09 首批不重写配置功能，也不复制原型中的内存演示状态。已实现的配置预览、保存、恢复验证和审计继续从功能验收使用。'],
    ['规则与状态映射沿用现有服务端权限和恢复验证。', '版本、人员、通知和日历配置不从演示数据生成结论。', '后续正式配置页会按总原型 v2 分组导航接入。'],
    [['打开功能验收', '/acceptance', true], ['查看版本', '#/versions', false]]
  );
}

function renderHistory() {
  placeholderPage(
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
      if (event.target.value) navigate(versionHash(event.target.value));
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





