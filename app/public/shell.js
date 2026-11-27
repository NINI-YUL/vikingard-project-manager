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
  actualTimeReady: false,
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

function dayKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function timelineShortDay(value) {
  const key = dayKey(value);
  return key ? key.slice(5).replace('-', '.') : value ? '日期未知' : '未配置';
}

function timelineTone(item) {
  if (item.due?.overdue) return 'risk';
  if (['delivered', 'non_delivery'].includes(item.semantic)) return 'done';
  if (item.semantic === 'not_started') return 'pending';
  return item.semantic ? 'active' : 'unknown';
}

export function actualTimelineSpan(item, todayKey = dayKey(new Date()), now = new Date()) {
  const timing = item.typeName?.includes('测试') ? item.timing?.test : item.timing?.development;
  const rounds = Array.isArray(timing?.rounds) ? timing.rounds : [];
  if (!rounds.length) return { state: item.semantic === 'not_started' ? 'not_started' : 'unknown' };
  if ((timing.unknown && !timing.dateCorrected) || !todayKey) return { state: 'unknown' };
  for (const round of rounds) {
    const start = dayKey(round?.start), end = dayKey(round?.end);
    if (!start || round.unknown || (round.end != null && (!end || end < start))) return { state: 'unknown' };
  }
  const start = rounds[0].start, startKey = dayKey(start);
  const startsLater = value => dayKey(value) > todayKey || (dayKey(value) === todayKey && !/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value) > new Date(now));
  if (startsLater(start)) return { state: 'not_started' };
  if (rounds.some(round => startsLater(round.start))) return { state: 'unknown' };
  const end = rounds.at(-1).end ?? null, endKey = end ? dayKey(end) : todayKey;
  if (endKey < startKey) return { state: 'unknown' };
  const ended = end !== null;
  const terminal = ['delivered', 'non_delivery'].includes(item.semantic);
  return {
    state: ended ? 'done' : 'doing', start, startKey, end, endKey, ended,
    completed: ended && terminal, terminal, durationUnverified: Boolean(timing.durationUnverified), workingDays: timing.workingDays ?? null
  };
}

function timelineEstimateText(item) {
  const start = timelineShortDay(item.plannedStartAt), end = timelineShortDay(item.plannedDueAt);
  if (start === '未配置' && end === '未配置') return '估：未配置';
  return '估：' + start + ' - ' + end + (item.planWorkingDays === null || item.planWorkingDays === undefined ? '' : ' · ' + item.planWorkingDays + '个工作日');
}

export function timelineActualText(actual) {
  if (actual.state === 'not_started') return '实：未开始';
  if (actual.state === 'unknown') return '实：实际时间不可判断';
  const end = actual.ended ? timelineShortDay(actual.end) : '';
  const suffix = actual.completed ? (actual.workingDays !== null && actual.workingDays !== undefined ? '已完成 ' + actual.workingDays + ' 个工作日' : actual.durationUnverified ? '已完成' : '已完成 · 工作日未知') : actual.ended ? '实际已结束，状态未完成' : actual.terminal ? '结束时间缺失' : actual.durationUnverified ? '进行中' : actual.workingDays === null || actual.workingDays === undefined ? '进行中 · 历时未知' : '已进行 ' + actual.workingDays + ' 工作日';
  return '实：' + timelineShortDay(actual.start) + ' - ' + end + ' · ' + suffix + (actual.durationUnverified ? ' · 历时待核实' : '');
}

export function sortTimelineItems(items) {
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const dueA = dayValue(a.item.plannedDueAt), dueB = dayValue(b.item.plannedDueAt);
    if (dueA === null && dueB !== null) return 1;
    if (dueA !== null && dueB === null) return -1;
    if (dueA !== null && dueB !== null && dueA !== dueB) return dueA - dueB;
    const startA = dayValue(a.item.plannedStartAt), startB = dayValue(b.item.plannedStartAt);
    if (startA === null && startB !== null) return 1;
    if (startA !== null && startB === null) return -1;
    if (startA !== null && startB !== null && startA !== startB) return startA - startB;
    return a.index - b.index;
  }).map(entry => entry.item);
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

export function actionRiskSummary(facts) {
  const groups=new Map(),owners=new Map();
  const ownerKey=item=>item.executorPersonId||item.version.id+'/'+(item.executorSourceId||item.sourceTaskId);
  const riskItems=facts.filter(item=>['high','watch'].includes(item.risk?.level));
  for(const item of facts){
    const key=item.version.id+'/'+item.parentSourceTaskId;
    if(!groups.has(key))groups.set(key,{version:item.version,sourceTaskId:item.parentSourceTaskId,title:item.requirementTitle,items:[],level:'unknown'});
    groups.get(key).items.push(item);
  }
  for(const group of groups.values())group.level=group.items.some(i=>i.risk?.level==='high')?'high':group.items.some(i=>i.risk?.level==='watch')?'watch':group.items.some(i=>!i.risk||i.risk.level==='unknown')?'unknown':'normal';
  for(const item of riskItems){
    const key=ownerKey(item);
    if(!owners.has(key))owners.set(key,{name:item.executorName||'执行者身份待核对',items:[],all:[]});
    owners.get(key).items.push(item);
  }
  for(const item of facts)owners.get(ownerKey(item))?.all.push(item);
  return {groups:[...groups.values()],owners:[...owners.values()],riskItems,unknown:facts.filter(i=>!i.risk||i.risk.level==='unknown').length};
}

function riskPill(risk) {
  const styles={high:['red','高风险'],watch:['amber','需关注'],normal:['green','正常'],unknown:['','未知']};
  const [tone,label]=styles[risk?.level]||styles.unknown;
  return node('span','pill '+tone,label);
}

function feedbackSummary(item) {
  const risk=item.risk,feedback=risk?.feedback;
  if(!feedback)return risk?.reason||'尚无有效反馈';
  const plan=risk.plannedProgressPercent;
  return '反馈 '+feedback.progressPercent+'% · 提交 '+formatDate(feedback.submittedAt)+(plan==null?' · 计划进度不可计算':' · 提交时计划 '+Number(plan.toFixed(1))+'% · 落后 '+Number(risk.lagPercentagePoints.toFixed(1))+' 个百分点');
}

export function syncTargetVersions(versions, selectedVersionId = '') {
  return selectedVersionId ? versions.filter(version => version.id === selectedVersionId) : versions;
}

async function syncLatestTb() {
  const control = $('tb-sync');
  if (control.disabled) return;
  const originalText = control.textContent;
  control.disabled = true;
  $('feedback-sync').disabled = true;
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
    $('feedback-sync').disabled = false;
    control.textContent = originalText;
  }
}

async function syncLatestFeedback() {
  const control = $('feedback-sync');
  if (control.disabled) return;
  control.disabled = true;
  $('tb-sync').disabled = true;
  control.textContent = '正在获取反馈…';
  clearMessage();
  try {
    const targets = syncTargetVersions(await loadVersions(), $('version-select').value);
    if (!targets.length) throw new ApiError(404, '没有可读取反馈的活跃版本。');
    const results = [];
    for (const version of targets) {
      let readCount = 0;
      try {
        const overview = await api('/api/feedback/versions/' + version.id);
        const sources = (overview.sources ?? []).filter(source => source.enabled);
        if (!sources.length) throw new ApiError(409, '未配置可用反馈来源，请在功能验收核对反馈来源。');
        for (const source of sources) {
          const result = await api('/api/feedback/read', {
            method: 'POST',
            body: { sourceId: source.id, versionId: version.id, reason: '顶部按钮手动获取最新反馈并核对当前 TB 事实' }
          });
          readCount += result.readCount;
        }
        results.push({ version, readCount });
      } catch (error) {
        results.push({ version, readCount, error });
        if ([401, 403].includes(error.status)) break;
      }
    }
    state.versions = null;
    state.management.clear();
    state.tasks.clear();
    await route();
    const succeeded = results.filter(item => !item.error);
    const errors = results.filter(item => item.error).map(item => item.version.displayName + '：' + item.error.message);
    const unfinished = targets.length - succeeded.length;
    const counts = succeeded.map(item => item.version.displayName + '读取 ' + item.readCount + ' 条来源记录').join('；');
    showMessage((unfinished ? '获取最新反馈未全部完成：' : '已获取最新反馈：') + succeeded.length + '/' + targets.length + ' 个版本完成。' + counts + (errors.length ? '。' + errors.join('；') : '') + '。记录包含已有提交；有效性校验和风险复核仍按现有规则执行。', unfinished ? 'error' : 'success');
  } catch (error) {
    if (error.status !== 401) showMessage('获取最新反馈失败：' + error.message, 'error');
  } finally {
    control.disabled = false;
    $('tb-sync').disabled = false;
    control.textContent = '获取最新反馈';
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
  document.body.classList.toggle('v2-page', ['versions', 'versionDetail', 'requirements', 'config'].includes(current.name));
  document.body.classList.toggle('config-page', current.name === 'config');
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
  const riskSummary = actionRiskSummary(facts);
  const overdue = facts.filter(item => item.due?.overdue);
  const dueSoon = facts.filter(item => item.due?.dueSoon);
  const scope = node('div', 'scope');
  scope.append(node('span', null, '当前范围：' + contexts.length + ' 个活跃版本'));
  const guide = node('details', 'scope-guide');
  guide.append(node('summary', null, '统计口径与说明'), node('p', null,
    '仅统计核心需求下的核心专业子单。三日内按公司工作日历计算；缺少计划时间或状态映射的工单无法判断到期。职能筛选不影响数据待处理。有效反馈“存在风险”为高风险；反馈比提交时的计划进度落后至少20个百分点为需关注。不把缺失数据填成正常，不按采集节点自动判断未反馈。'));
  scope.append(node('span', 'note', '仅统计核心需求下的核心专业子单'), guide);
  wrap.append(scope);
  if (failed) wrap.append(errorCard(failed + ' 个版本读取失败。以下仅列出读取成功的工单，总数未知。', () => route()));
  const unknownDue = facts.filter(item => item.due == null && !['delivered', 'non_delivery'].includes(item.semantic)).length;
  if (unknownDue) wrap.append(node('p', 'note', unknownDue + ' 张核心专业子单因计划、状态或来源问题无法判断到期，请在异常与审计核对。'));

  const metrics = node('div', 'metrics');
  metrics.append(
    metricCard('高风险需求', failed ? '未知' : riskSummary.groups.filter(g=>g.level==='high').length, '按需求内最高已知风险统计'+(riskSummary.unknown?'；另有 '+riskSummary.unknown+' 张工单风险未知':''), 'red'),
    metricCard('需关注需求', failed ? '未知' : riskSummary.groups.filter(g=>g.level==='watch').length, '不重复计入高风险需求；进度差额至少20个百分点', 'amber'),
    metricCard('风险工单', failed ? '未知' : riskSummary.riskItems.length, '已知高风险与需关注核心专业子单'+(riskSummary.unknown?'；另有 '+riskSummary.unknown+' 张未知':''), 'blue'),
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
  if(riskSummary.unknown)risk.append(node('p','note',riskSummary.unknown+' 张核心专业子单风险未知，保留有效反馈与提交时间；暂不自动判断本轮未反馈。'));
  for(const group of riskSummary.groups.filter(g=>['high','watch'].includes(g.level))){
    const detail=node('details','action-risk '+(group.level==='high'?'high':''));detail.open=true;
    const summary=node('summary');summary.append(riskPill(group),node('strong',null,group.title||'所属需求待核对'),node('span','cell-note',group.version.displayName));detail.append(summary);
    const rows=group.items.filter(i=>['high','watch'].includes(i.risk?.level)).map(item=>{
      const row=node('tr'),identity=node('td');identity.append(link(item.title,taskHash(item.version.id,0,item.sourceTaskId),'row-link'),riskPill(item.risk));
      const progress=node('td');progress.append(node('div',null,feedbackSummary(item)));
      const reason=node('td');reason.append(node('div',null,item.risk.reason),node('div','risk-feedback-note',item.risk.feedback?.note||''));
      row.append(identity,node('td',null,item.executorName||'身份待核对'),node('td',null,item.rawStatus||'状态未知'),progress,node('td',null,formatDate(item.plannedDueAt)),reason);return row;
    });
    detail.append(buildTable('风险核心专业子单',['工单','执行者','状态','反馈进度 / 提交时计划','截止时间','风险原因 / 所需协助'],rows,''));risk.append(detail);
  }
  if(!riskSummary.riskItems.length)risk.append(emptyCard(failed?'风险信息读取不完整，不能判断为零。':riskSummary.unknown?'已知范围暂无风险工单，其余工单风险未知。':'当前范围暂无已知高风险或需关注工单。'));
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
  executors.append(node('p','note','按风险核心专业子单的实际执行者汇总，不排名、不评分。'));
  for(const owner of riskSummary.owners){
    const card=node('details','action-risk-owner'),head=node('summary');head.append(node('strong',null,owner.name));card.append(head);
    const signals=node('div','action-owner-signals');for(const [label,count,tone] of [['风险',owner.items.length,'amber'],['逾期',owner.all.filter(i=>i.due?.overdue).length,'red'],['三日内',owner.all.filter(i=>i.due?.dueSoon).length,'blue']])signals.append(node('span','pill '+tone,count+' '+label));head.append(signals);
    for(const item of owner.items)card.append(link(item.title,taskHash(item.version.id,0,item.sourceTaskId),'owner-task-link'));executors.append(card);
  }
  if(!riskSummary.owners.length)executors.append(emptyCard(failed?'执行人风险信息读取不完整。':'当前已知范围没有风险工单执行人。'));
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
  const detailMain = node('div', 'version-detail-main');
  const detailSide = node('div', 'version-detail-side');
  detailLayout.append(detailMain, detailSide);
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
      metricCard('风险需求', management.requirements.filter(r=>['high','watch'].includes(r.risk?.level)).length, '按核心需求内最高已知风险汇总；未知 '+management.requirements.filter(r=>!r.risk||r.risk.level==='unknown'||r.risk.unknown>0).length+' 项', 'amber')
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
      const row = node('tr', 'version-requirement-row');
      row.addEventListener('click', event => {
        if (event.target.closest('a, button, input, select')) return;
        navigate(requirementsHash(version.id, requirement.id));
      });
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
      riskCell.append(riskPill(requirement.risk));
      if(requirement.risk?.unknown)riskCell.append(node('div','cell-note',requirement.risk.unknown+' 张工单风险未知'));
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
    detailMain.append(reqCard);
    detailSide.append(signalCard, changesCard);
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
  detailMain.append(taskCard);
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

function renderTaskPanel(version, tasks, management, current, onClose = () => navigate(taskHash(version.id, current.offset, null)), onActualSaved = null) {
  const panel = node('aside', 'task-panel');
  panel.setAttribute('aria-label', '任务详情');
  const close = button('关闭', onClose, 'button small');
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

  const facts = node('dl', 'facts');
  const addFact = (label, value) => {
    const item = node('div', 'fact');
    item.append(node('dt', null, label), node('dd', null, value || '未知'));
    facts.append(item);
  };
  addFact('来源工单 ID', task?.sourceTaskId || fact?.sourceTaskId);
  addFact('原始状态', task?.rawStatus || fact?.rawStatus);
  addFact('职能', (task?.functionName || fact?.functionName) || (task?.functionResolution === 'missing' ? '未填写' : '待配置'));
  addFact('来源可用性', PRESENCE_NAMES[task?.sourcePresence ?? fact?.sourcePresence] ?? '待核对');
  addFact('最近同步', formatDate(task?.lastSyncedAt ?? fact?.lastSyncedAt));
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
    if(fact.risk){add('业务风险',({high:'高风险',watch:'需关注',normal:'正常',unknown:'未知'})[fact.risk.level]);add('反馈与计划对比',feedbackSummary(fact));add('风险说明',fact.risk.reason);if(fact.risk.feedback?.note)add('风险原因 / 所需协助',fact.risk.feedback.note);}
    add('计划工作日', fact.planWorkingDays === null || fact.planWorkingDays === undefined ? '未知' : fact.planWorkingDays + ' 日');
    const terminalDue = fact.semantic === 'delivered' ? '已完成，无需到期提醒' : fact.semantic === 'non_delivery' ? '已结束，无需到期提醒' : null;
    add('到期判断', terminalDue ?? (fact.due?.overdue ? '已逾期 ' + fact.due.workingDays + ' 个工作日' : fact.due?.dueSoon ? '3 个工作日内到期' : fact.due ? '未逾期' : '不可判断'));
    add('开发计时', dev === null || dev === undefined ? '未知' : dev + ' 个工作日');
    add('测试计时', test === null || test === undefined ? '未知' : test + ' 个工作日');
    section.append(facts2);
    panel.append(section);
  }

  if (onActualSaved && fact && fact.kind !== 'requirement') {
    const section = node('section', 'panel-section');
    section.append(node('h3', null, '实际时间'));
    for (const correction of fact.timingCorrections ?? []) section.append(node('p', correction.conflicts.length ? 'notice' : 'note', correction.message || '已使用人工修正；未修改字段继续跟随 TB。'));
    const edit = button(['owner', 'admin'].includes(state.actor?.role) ? '修改实际时间' : '查看实际时间记录', () => openActualTimeEditor(version, fact, onActualSaved), 'button small');
    edit.disabled = !state.actualTimeReady;
    section.append(edit);
    if (!state.actualTimeReady) section.append(node('p', 'note', '实际时间修正尚未启用，请联系管理员完成服务更新。'));
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


export function actualTimeInput(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!dayKey(value)) return '';
  return dayKey(value) + 'T' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}
function actualTimeLabel(value) {
  const time = actualTimeInput(value);
  return time ? time.replace('T', ' ') + (time.length === 10 ? '（时分未提供）' : '') : '未知';
}
async function openActualTimeEditor(version, fact, onSaved) {
  const endpoint = '/api/management/versions/' + version.id + '/items/' + fact.id + '/actual-time';
  const editable = ['owner', 'admin'].includes(state.actor?.role);
  const dialog = node('dialog', 'actual-time-dialog'); dialog.setAttribute('aria-label', editable ? '修改实际时间' : '实际时间记录');
  const head = node('div', 'actual-time-head');
  head.append(node('h2', 'section-title', editable ? '修改实际时间' : '实际时间记录'), button('关闭', () => dialog.close(), 'button small'));
  const form = node('form'), body = node('div', 'actual-time-body'), actions = node('div', 'actual-time-actions section-actions');
  form.append(body, actions); dialog.append(head, form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
  const errorBox = node('div', 'error-box'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const fail = error => { errorBox.textContent = error?.message || '读取或保存失败，请重试'; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'nearest' }); };
  let data, stage = fact.typeName?.includes('测试') ? 'test' : 'development', selected, draft, reason = '', pendingCount;
  const drafts = new Map(), stageName = value => value === 'test' ? '测试' : '开发';
  const label = (text, control) => { const field = node('label', 'field'); field.append(node('span', null, text), control); return field; };
  const option = (select, value, text) => { const item = node('option', null, text); item.value = value; select.append(item); };
  const rawRounds = () => data.item.sourceTiming?.[stage]?.rounds ?? [];
  const choices = () => [ ...rawRounds().map((r, i) => ({ key: r.anchors?.[0] ?? 'empty', label: '第 ' + (i + 1) + ' 轮 · ' + actualTimeLabel(r.start) + ' 至 ' + actualTimeLabel(r.end), raw: r })), ...(rawRounds().length ? [] : [{ key: 'empty', label: '尚无来源轮次（可补充实际时间）', raw: { start: null, end: null } }]), ...(data.item.timingCorrections ?? []).filter(c => c.stage === stage && c.pending).map(c => ({ key: 'pending:' + c.id, label: '待核对修正 · ' + actualTimeLabel(c.lastValid?.start) + ' 至 ' + actualTimeLabel(c.lastValid?.end), correction: c })) ];
  const fieldChanged = (d, field) => JSON.stringify(d.fields[field]) !== JSON.stringify(d.initial[field]);
  const dirty = d => d.resolution || d.rebind || (d.correction?.pending && d.target !== d.initialTarget) || ['start', 'end'].some(f => fieldChanged(d, f));
  const modified = () => [...drafts.values()].filter(dirty);
  const updateCount = () => { if (pendingCount) pendingCount.textContent = '已修改 ' + modified().length + ' 个轮次'; };
  const choose = key => {
    selected = choices().find(c => c.key === key) ?? choices().at(-1);
    const correction = selected.correction ?? data.item.timingCorrections?.find(c => c.stage === stage && c.key === selected.key && !c.pending);
    const draftKey = stage + ':' + selected.key;
    if (!drafts.has(draftKey)) {
      const fields = Object.fromEntries(['start', 'end'].map(f => [f, { mode: correction?.fields[f]?.mode ?? 'inherit', value: actualTimeInput(correction?.fields[f]?.value) }]));
      const target = rawRounds()[0]?.anchors?.[0] ?? 'empty';
      drafts.set(draftKey, { stage, key: selected.key, label: selected.label, correction, fields, initial: structuredClone(fields), target, initialTarget: target, rebind: false, resolution: null, raw: selected.raw });
    }
    draft = drafts.get(draftKey); draw();
  };
  const load = async () => {
    body.replaceChildren(node('p', 'note', '正在读取实际时间…'));
    try { data = await api(endpoint); drafts.clear(); choose(choices().at(-1).key); }
    catch (error) { body.replaceChildren(errorBox); fail(error); actions.replaceChildren(button('重新读取', load, 'button')); }
  };
  const draw = () => {
    body.replaceChildren(errorBox); errorBox.hidden = true;
    body.append(node('p', 'task-number', formatTaskNumber(data.item.key, version.uniqueIdPrefix) + ' · ' + data.item.title));
    const pickers = node('div', 'actual-time-grid'), stageSelect = node('select'), roundSelect = node('select');
    stageSelect.setAttribute('aria-label', '计时阶段'); roundSelect.setAttribute('aria-label', '计时轮次');
    for (const value of ['development', 'test']) option(stageSelect, value, stageName(value)); stageSelect.value = stage;
    for (const choice of choices()) option(roundSelect, choice.key, choice.label); roundSelect.value = selected.key;
    stageSelect.addEventListener('change', () => { stage = stageSelect.value; choose(choices().at(-1).key); });
    roundSelect.addEventListener('change', () => choose(roundSelect.value));
    pickers.append(label('计时阶段', stageSelect), label('计时轮次', roundSelect)); body.append(pickers);
    if (draft.correction?.pending) {
      body.append(node('p', 'notice', '来源轮次发生变化，本条修正尚未套用。请核对后重新关联目标轮次，或恢复使用 TB 时间。'));
      const target = node('select'); target.setAttribute('aria-label', '重新关联目标轮次');
      for (const choice of choices().filter(c => c.raw)) option(target, choice.key, choice.label); target.value = draft.target;
      target.addEventListener('change', () => { draft.target = target.value; draw(); }); body.append(label('重新关联目标轮次', target));
      if (editable) { const check = node('input'); check.type = 'checkbox'; check.checked = draft.rebind; check.addEventListener('change', () => { draft.rebind = check.checked; updateCount(); }); body.append(label('已核对，确认将这条修正关联到所选轮次', check)); }
    } else if (draft.correction?.conflicts.length) body.append(node('p', 'notice', '来源时间有变化，待核对。当前继续保留人工值；时间倒置时保留上次有效结果。'));
    const raw = draft.correction?.pending ? choices().find(c => c.key === draft.target)?.raw : selected.raw;
    const comparison = node('dl', 'facts');
    for (const f of ['start', 'end']) {
      const item = node('div', 'fact'), override = draft.correction?.fields[f];
      const effective = draft.correction ? (draft.correction.effective ?? draft.correction.lastValid)?.[f] : raw?.[f];
      item.append(node('dt', null, f === 'start' ? '实际开始' : '实际结束'), node('dd', null, 'TB：' + actualTimeLabel(raw?.[f]) + ' ｜ 当前：' + actualTimeLabel(effective) + '（' + (override ? override.mode === 'unknown' ? '人工清空' : '人工修正' : '跟随 TB') + '）')); comparison.append(item);
    }
    body.append(comparison);
    if (editable) {
      const fields = node('div', 'actual-time-grid');
      for (const f of ['start', 'end']) {
        const box = node('div'), mode = node('select'), date = node('input'), time = node('input'), inputs = node('div', 'actual-time-inputs');
        const name = f === 'start' ? '实际开始' : '实际结束'; date.type = 'date'; time.type = 'time'; time.step = '60';
        date.value = draft.fields[f].value.slice(0, 10); time.value = draft.fields[f].value.includes('T') ? draft.fields[f].value.slice(11, 16) : '';
        mode.setAttribute('aria-label', name + '时间处理方式'); date.setAttribute('aria-label', name + '日期'); time.setAttribute('aria-label', name + '时分');
        for (const [value, text] of [['inherit', '跟随 TB'], ['date', '指定时间'], ['unknown', '清空为未知']]) option(mode, value, text); mode.value = draft.fields[f].mode;
        const update = () => { draft.fields[f].mode = mode.value; inputs.hidden = date.disabled = time.disabled = mode.value !== 'date'; date.required = time.required = mode.value === 'date' && fieldChanged(draft, f); updateCount(); };
        mode.addEventListener('change', update);
        for (const input of [date, time]) input.addEventListener('input', () => { draft.fields[f].value = date.value + (time.value ? 'T' + time.value : ''); update(); });
        update(); inputs.append(date, time); box.append(label(name + '时间', mode), inputs); fields.append(box);
      }
      body.append(fields);
      const reasonInput = node('textarea'); reasonInput.value = reason; reasonInput.required = true; reasonInput.maxLength = 2000; reasonInput.setAttribute('aria-label', '修改原因');
      reasonInput.addEventListener('input', () => { reason = reasonInput.value; }); body.append(label('修改原因（本次所有轮次共用）', reasonInput));
      body.append(node('p', 'note', '按北京时间保存到分钟，允许未来时间。确认保存即视为人工核实，按生效起止和公司日历计算工作日，并扣除本轮 TB 已知暂停及其他不计时区间。旧日期修正包含起止当天的工作时段。可切换阶段和轮次一起保存，未修改字段继续跟随 TB。'));
    }
    if (data.item.timing?.[stage]?.durationUnverified) body.append(node('p', 'note', '工作日暂不可计算：请检查实际开始时间是否缺失，以及起止范围是否有效。人工确认的有效起止可直接计算，无需再次核实。'));
    const history = node('details', 'actual-time-history'); history.append(node('summary', null, '修正记录（' + data.history.length + '）'));
    for (const event of data.history) {
      const entry = node('div', 'history-item'), after = event.after_value, before = event.before_value;
      entry.append(node('b', null, event.actor + ' · ' + formatDate(event.occurred_at) + ' · ' + stageName(after.stage)), node('p', null, '原因：' + event.reason));
      if (after.evidence) entry.append(node('p', 'note', '历史依据：' + after.evidence));
      for (const field of ['start', 'end']) entry.append(node('p', 'note', (field === 'start' ? '开始' : '结束') + '：' + actualTimeLabel(before ? before.effective?.[field] : after.source?.[field]) + ' → ' + actualTimeLabel(after.effective?.[field]) + ' · ' + (after.fields[field] ? after.fields[field].mode === 'unknown' ? '人工清空' : '人工修正' : '跟随 TB')));
      entry.append(node('p', 'note', '轮次来源事件：' + (after.anchors.join('、') || '无来源轮次') + (after.rebind ? ' · 人工重新关联' : '') + (after.active ? '' : ' · 已恢复来源'))); history.append(entry);
    }
    body.append(history);
    actions.replaceChildren(button('取消', () => dialog.close(), 'button'));
    if (editable) {
      pendingCount = node('span', 'note'); actions.append(pendingCount); updateCount();
      actions.append(button('预览修改', () => preview(), 'button primary'));
      if (draft.correction) {
        if (!draft.correction.pending && draft.correction.conflicts.length) actions.append(button('保留人工修正', () => preview('keep'), 'button'));
        actions.append(button('恢复使用 TB 时间', () => preview('restore'), 'button'));
      }
    }
  };
  const changeFor = d => {
    const fields = Object.fromEntries(['start', 'end'].map(f => {
      if (!fieldChanged(d, f)) {
        const previous = d.correction?.fields[f];
        return [f, previous ? { mode: previous.mode, ...(previous.mode === 'date' ? { value: previous.value } : {}) } : { mode: 'inherit' }];
      }
      const field = d.fields[f];
      return [f, { mode: field.mode, ...(field.mode === 'date' ? { value: field.value + ':00+08:00' } : {}) }];
    }));
    return { stage: d.stage, roundKey: d.correction?.pending ? d.target : d.key, ...(d.correction ? { correctionId: d.correction.id } : {}), rebind: Boolean(d.correction?.pending && d.rebind), fields, ...(d.resolution ? { resolution: d.resolution } : {}) };
  };
  const preview = resolve => {
    if (resolve) draft.resolution = resolve;
    const changed = modified();
    if (!changed.length) { fail(new Error('请先修改至少一个轮次')); return; }
    if (!reason.trim()) { fail(new Error('请填写修改原因')); return; }
    for (const d of changed) {
      if (d.correction?.pending && d.resolution !== 'restore' && !d.rebind) { fail(new Error(stageName(d.stage) + ' · ' + d.label + '：请确认重新关联或恢复来源')); return; }
      if (d.resolution !== 'restore') for (const f of ['start', 'end']) if (fieldChanged(d, f) && d.fields[f].mode === 'date' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.fields[f].value)) { fail(new Error(stageName(d.stage) + ' · ' + d.label + '：请补充' + (f === 'start' ? '开始' : '结束') + '日期和时分')); return; }
    }
    const changes = changed.map(changeFor), summary = node('section', 'actual-time-preview'); summary.append(node('h3', null, '确认修改内容（' + changes.length + ' 个轮次）'));
    for (const d of changed) {
      const group = node('div', 'actual-time-preview-round'); group.append(node('h4', null, stageName(d.stage) + ' · ' + d.label));
      for (const f of ['start', 'end']) {
        const field = d.fields[f], text = d.resolution === 'restore' || field.mode === 'inherit' ? '恢复／继续跟随 TB' : field.mode === 'unknown' ? '清空为未知' : field.value.replace('T', ' ');
        const before = d.correction ? (d.correction.effective ?? d.correction.lastValid)?.[f] : d.raw?.[f];
        group.append(node('p', null, (f === 'start' ? '实际开始：' : '实际结束：') + actualTimeLabel(before) + ' → ' + text));
      }
      if (d.resolution === 'keep') group.append(node('p', 'note', '保留人工修正，并确认本次 TB 来源。')); summary.append(group);
    }
    summary.append(node('p', null, '修改原因：' + reason), node('p', 'note', '本次修改一次提交、全部成功或全部不保存。预估时间、TB 状态和完成门槛保持现状；确认保存即视为人工核实；缺少开始时间或区间无效时不补造工作日数。'));
    body.replaceChildren(errorBox, summary); errorBox.hidden = true;
    const save = button('确认保存', async () => {
      save.disabled = true;
      try {
        await api(endpoint, { method: 'POST', body: { snapshot: data.snapshot, changes, reason, confirmed: true } });
        clearVersionCaches(version.id); dialog.close(); onSaved();
      } catch (error) { fail(error); save.disabled = false; if (error.status === 409) actions.append(button('重新读取并核对', load, 'button')); }
    }, 'button primary');
    actions.replaceChildren(button('返回编辑', draw, 'button'), button('取消', () => dialog.close(), 'button'), save);
  };
  form.addEventListener('submit', event => { event.preventDefault(); }); await load();
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
  const requirementHeader = node('div', 'requirement-header');
  const requirementToolbar = node('div', 'requirement-toolbar');
  const requirementPicker = node('label', 'requirement-picker');
  requirementPicker.append(node('span', null, '核心需求'));
  const requirementSelect = node('select', 'select');
  for (const candidate of management.requirements) {
    const option = node('option', null, candidate.title || '未命名需求');
    option.value = candidate.id;
    option.selected = candidate.id === requirement?.id;
    requirementSelect.append(option);
  }
  requirementSelect.disabled = management.requirements.length === 0;
  requirementSelect.addEventListener('change', event => navigate(requirementsHash(version.id, event.target.value)));
  requirementPicker.append(requirementSelect);
  requirementToolbar.append(requirementPicker);
  requirementHeader.append(breadcrumbs, requirementToolbar);
  wrap.append(requirementHeader);

  if (current.requirementId && !requirement) {
    wrap.append(errorCard('当前版本计算事实中没有该需求。', () => navigate(requirementsHash(version.id))));
  } else if (requirement) {
    const root = management.items.find(item => item.id === requirement.id);
    const direct = root ? management.items.filter(item => item.parentSourceTaskId === root.sourceTaskId) : [];
    const timelineItems = sortTimelineItems(direct.filter(item => item.kind === 'professional' || item.typeName?.includes('测试')));
    const otherItems = direct.filter(item => !timelineItems.includes(item));
    const plannedStarts = direct.map(item => dayValue(item.plannedStartAt)).filter(value => value !== null);
    const plannedEnds = direct.map(item => dayValue(item.plannedDueAt)).filter(value => value !== null);
    const plannedStart = plannedStarts.length ? Math.min(...plannedStarts) : null;
    const plannedEnd = plannedEnds.length ? Math.max(...plannedEnds) : null;
    const todayKey = dayKey(new Date());
    const actualSpans = new Map(timelineItems.map(item => [item.id, actualTimelineSpan(item, todayKey)]));
    const visibleActualSpans = [...actualSpans.values()].filter(span => span.state === 'doing' || span.state === 'done');
    const timelineStarts = [...plannedStarts, ...visibleActualSpans.map(span => dayValue(span.start))];
    const timelineEnds = [...plannedEnds, ...visibleActualSpans.map(span => dayValue(span.endKey))];
    const timelineStart = timelineStarts.length ? Math.min(...timelineStarts) : null;
    const timelineEnd = timelineEnds.length ? Math.max(...timelineEnds) : null;
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
    tags.append(node('span', 'pill blue', '核心需求'), node('span', 'pill', direct.length + ' 张直属工作单'), node('span', 'pill', '基础流程 ' + foundation.text), riskPill(requirement.risk));
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
      const days = requirementCalendar(timelineStart, timelineEnd, management.calendar);
      timelineInner.style.setProperty('--day-count', String(Math.max(1, days.length)));
      const axis = node('div', 'requirement-timeline-axis');
      axis.append(node('div', 'requirement-axis-corner', '工单 / 预估 / 实际'));
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
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', '查看任务详情：' + item.title);
        const openTask = () => {
          const dialog = node('dialog', 'requirement-task-dialog');
          dialog.setAttribute('aria-label', '任务详情');
          dialog.append(renderTaskPanel(version, { items: [] }, management, { ...current, taskId: item.sourceTaskId }, () => dialog.close(), () => { dialog.close(); route(); }));
          dialog.addEventListener('close', () => { dialog.remove(); row.focus(); }, { once: true });
          wrap.append(dialog);
          dialog.showModal();
        };
        row.addEventListener('click', openTask);
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTask(); }
        });
        const actual = actualSpans.get(item.id) ?? { state: 'unknown' };
        const label = node('div', 'requirement-timeline-label');
        label.append(node('b', null, item.title || '未命名工单'), node('span', 'gantt-estimate-label', timelineEstimateText(item)), node('span', 'gantt-actual-label ' + (actual.state === 'not_started' ? 'is-pending' : actual.state === 'unknown' ? 'is-unknown' : 'is-active'), timelineActualText(actual)));
        const track = node('div', 'requirement-track');
        const itemDays = requirementCalendar(item.plannedStartAt, item.plannedDueAt);
        const startIndex = days.findIndex(day => day.key === itemDays[0]?.key);
        const endIndex = days.findIndex(day => day.key === itemDays.at(-1)?.key);
        const actualStartIndex = actual.startKey ? days.findIndex(day => day.key === actual.startKey) : -1;
        const actualEndIndex = actual.endKey ? days.findIndex(day => day.key === actual.endKey) : -1;
        for (const day of days) track.append(node('span', 'requirement-day-cell' + (!day.working ? ' rest' : day.special ? ' special' : '')));
        if (todayIndex >= 0) {
          const marker = node('span', 'requirement-today');
          marker.style.left = ((todayIndex + .5) / days.length * 100) + '%';
          marker.title = '今天（北京时间）：' + today;
          track.append(marker);
        }
        const tone = timelineTone(item);
        if (startIndex >= 0 && endIndex >= startIndex) {
          const bar = node('div', 'requirement-bar ' + tone, item.rawStatus || '状态未知');
          bar.style.left = (startIndex / days.length * 100) + '%';
          bar.style.width = ((endIndex - startIndex + 1) / days.length * 100) + '%';
          bar.title = item.title + ' · ' + item.rawStatus + ' · ' + timelineEstimateText(item);
          track.append(bar);
        } else {
          track.append(node('div', 'requirement-unplanned', '周期未配置，不绘制预估时间条'));
        }
        if (actual.state === 'doing' || actual.state === 'done') {
          if (actualStartIndex >= 0 && actualEndIndex >= actualStartIndex) {
            const actualBar = node('div', 'requirement-actual-bar ' + tone);
            actualBar.style.left = (actualStartIndex / days.length * 100) + '%';
            actualBar.style.width = ((actualEndIndex - actualStartIndex + 1) / days.length * 100) + '%';
            actualBar.title = item.title + ' · ' + timelineActualText(actual);
            if (actual.completed) actualBar.append(node('i', null));
            track.append(actualBar);
          }
        }
        row.append(label, track);
        timelineInner.append(row);
      }
      timeline.append(timelineInner);
      const legend = node('div', 'requirement-timeline-legend');
      for (const [tone, text] of [['done', '终态'], ['active', '进行中 / 处理中'], ['pending', '未开始'], ['risk', '已逾期'], ['rest', '休息日（不计工作日）'], ['special', '特殊工作日（计工作日）']]) {
        const entry = node('span'); entry.append(node('i', 'requirement-legend-dot ' + tone), node('span', null, text)); legend.append(entry);
      }
      legend.append(node('span', null, '实线：实际执行起止（包含暂停间隔）；历时按有效计时累计；圆点：有实际结束且已进入终态；灰线：今天（北京时间）'));
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
  setTitle('配置库', '版本范围、三级规则和工作日历');
  const editable = ['admin', 'owner'].includes(state.actor.role);
  const params = new URLSearchParams(current.raw.split('?')[1] ?? '');
  const spaces = {
    version: { title: '版本与规则', sub: '版本范围、三级规则和工作日历', tabs: [['scope', '版本范围'], ['rules', '规则设置'], ['calendar', '工作日历']] },
    status: { title: '状态语义', sub: '按 Teambition 项目和工作流维护原始状态映射', tabs: [['mapping', '状态映射'], ['impact', '影响与恢复']] },
    people: { title: '人员与通知', sub: '人员身份、业务角色、系统权限与通知规则', tabs: [['people', '人员与权限'], ['notice', '通知对象']] }
  };
  let space = params.get('section') === 'status' ? 'status' : params.get('section') === 'people' ? 'people' : 'version';
  let tab = params.get('tab') || spaces[space].tabs[0][0];
  if (!spaces[space].tabs.some(([key]) => key === tab)) tab = spaces[space].tabs[0][0];
  let catalog, currentRules, currentScope, currentKey;
  let management;
  let calendarMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const response = await fetch('/management-forms.html');
  if (!response.ok) throw new Error('配置表单读取失败，请重试。');
  const template = new DOMParser().parseFromString(await response.text(), 'text/html');
  const forms = template.querySelector('#management-rules');
  if (!forms) throw new Error('配置表单不完整，请联系管理员。');
  forms.hidden = false;
  forms.className = 'config-forms config-v2-form-host';
  const control = id => forms.querySelector('#' + id);
  forms.querySelector('h2').remove();
  forms.querySelector(':scope > p').remove();
  control('mg-results').hidden = true;
  const versionLabel = forms.querySelector('[for="mg-version"]');
  versionLabel.textContent = '版本';
  const ruleForm = control('mg-rules-form');
  const ruleDetails = ruleForm.closest('details');
  const calendarForm = control('mg-calendar-form');
  const calendarDetails = calendarForm.closest('details');
  const mappingForm = control('mg-mapping-form');
  const mappingDetails = mappingForm.closest('details');
  const layout = node('div', 'config-layout config-v2-shell');
  const rail = node('aside', 'config-v2-rail');
  const main = node('div', 'config-v2-main');
  const header = node('header', 'config-v2-top');
  const heading = node('div');
  const mobile = node('select', 'select config-v2-mobile');
  mobile.setAttribute('aria-label', '配置工作区');
  const tabs = node('nav', 'config-v2-subtabs');
  tabs.setAttribute('aria-label', '工作区页面');
  const content = node('div', 'config-content config-v2-content');
  const pages = {};
  function panel(title, description) {
    const box = node('section', 'config-v2-section');
    const head = node('div', 'config-v2-section-head');
    const text = node('div');
    text.append(node('h2', 'section-title', title));
    if (description) text.append(node('p', 'note', description));
    const body = node('div', 'config-v2-section-body');
    head.append(text); box.append(head, body);
    return { box, head, body };
  }
  function createEditor(title, form) {
    const dialog = node('dialog', 'config-v2-dialog');
    dialog.setAttribute('aria-label', title);
    const head = node('div', 'config-v2-section-head');
    head.append(node('h2', 'section-title', title), button('关闭', () => dialog.close(), 'button small'));
    dialog.append(head, form);
    forms.append(dialog);
    return dialog;
  }
  const ruleEditor = createEditor('编辑配置', ruleForm);
  const calendarEditor = createEditor('日期配置', calendarForm);
  const mappingEditor = createEditor('编辑状态映射', mappingForm);
  mappingEditor.classList.add('status-dialog');
  mappingForm.classList.add('status-mapping-form');
  const editors = [ruleEditor, calendarEditor, mappingEditor];
  ruleDetails.remove();
  const calendarList = control('mg-calendar-list');
  calendarDetails.removeChild(calendarList);
  const calendarNote = calendarDetails.querySelector('p');
  calendarDetails.removeChild(calendarNote); calendarDetails.remove();
  const projectLabel = mappingDetails.querySelector('[for="mg-project"]');
  const workflowLabel = mappingDetails.querySelector('[for="mg-workflow"]');
  const projectSelect = control('mg-project'), workflowSelect = control('mg-workflow');
  mappingDetails.removeChild(projectSelect); mappingDetails.removeChild(workflowSelect);
  mappingDetails.removeChild(projectLabel); mappingDetails.removeChild(workflowLabel); mappingDetails.remove();
  const versionsPanel = panel('日常管理版本', '仅显示已批准来源；纳入和同步只读取 Teambition，保留当前事实。');
  versionsPanel.box.classList.add('version-scope-panel');
  pages['version/scope'] = versionsPanel.box;
  const rulesPage = node('div', 'config-rules-workspace');
  const objectPanel = panel('配置层级', '选择作用范围，查看配置或在一个窗口内编辑。');
  const scopeControls = node('div', 'config-rule-controls');
  scopeControls.classList.add('config-rule-object-controls');
  const scopeSelect = control('mg-scope');
  const scopeField = node('div', 'field config-rule-scope-field');
  const scopeLabel = ruleForm.querySelector('[for="mg-scope"]');
  scopeField.append(scopeLabel);
  const scopeButtons = node('div', 'config-rule-scope-buttons');
  const syncScopeButtons = () => scopeButtons.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === scopeSelect.value)));
  for (const option of scopeSelect.options) {
    const button = node('button', null, option.textContent);
    button.type = 'button'; button.dataset.scope = option.value;
    button.onclick = () => { scopeSelect.value = option.value; scopeSelect.dispatchEvent(new Event('change', { bubbles: true })); syncScopeButtons(); };
    scopeButtons.append(button);
  }
  scopeSelect.classList.add('config-rule-native-select');
  scopeSelect.addEventListener('change', syncScopeButtons);
  scopeField.append(scopeButtons, scopeSelect); scopeControls.append(scopeField);
  for (const [label, select] of [[versionLabel, control('mg-version')], [ruleForm.querySelector('[for="mg-requirement"]'), control('mg-requirement')]]) {
    const field = node('div', 'field'); field.append(label, select); scopeControls.append(field);
  }
  syncScopeButtons();
  objectPanel.body.append(scopeControls, control('mg-scope-note'));
  const editRules = button('编辑配置', () => {
    control('mg-scope').dispatchEvent(new Event('change'));
    control('mg-rule-reason').value = '';
    ruleEditor.showModal();
  }, 'button primary');
  editRules.hidden = !editable; objectPanel.head.append(editRules);
  const ruleSummary = node('div', 'config-rule-summary');
  rulesPage.append(objectPanel.box, ruleSummary);
  // Keep confirmed baseline and function-exemption operations accessible in this workspace.
  const extraDetails = [...forms.querySelectorAll(':scope > details')];
  for (const details of extraDetails) { details.classList.add('config-v2-section', 'config-extra'); rulesPage.append(details); }
  pages['version/rules'] = rulesPage;
  const calendarPanel = panel('公司工作日历', '点任意日期设置类型与说明。');
  calendarPanel.box.classList.add('cal-panel');
  calendarPanel.body.classList.add('cal-body');
  const calendarBoard = node('div', 'config-calendar');
  const calendarIntro = node('div', 'cal-intro');
  calendarIntro.append(node('b', null, '工作日是日期单位'), document.createTextNode('，不表示个人工时，也不录入半天。日期调整影响计划周期、到期判断和开发 / 测试历时；正式修改前须展示具体受影响对象，历史复盘保留上线时口径。'));
  const specialPanel = panel('本月特殊日期', '管理员可新增 / 修改。');
  specialPanel.box.classList.add('cal-panel');
  specialPanel.body.append(calendarList);
  const defaultPanel = panel('默认工作周');
  defaultPanel.box.classList.add('cal-panel');
  const defaults = node('div', 'cal-defaults');
  for (const [label, value] of [['默认工作日', '周一 ~ 周五'], ['默认休息日', '周六 / 周日'], ['历史口径', '历史复盘保留上线时口径']]) {
    const item = node('div'); item.append(node('span', null, label), node('b', null, value)); defaults.append(item);
  }
  defaultPanel.body.append(defaults);
  const calendarAside = node('aside', 'cal-aside'); calendarAside.append(specialPanel.box, defaultPanel.box);
  const calendarLayout = node('div', 'cal-layout'); calendarLayout.append(calendarPanel.box, calendarAside);
  const calendarWorkspace = node('div', 'cal-workspace'); calendarWorkspace.append(calendarIntro, calendarLayout);
  calendarPanel.body.append(calendarBoard);
  const editCalendar = button('编辑日期', () => openCalendarDate(), 'button primary');
  editCalendar.hidden = !editable; calendarPanel.head.append(editCalendar);
  pages['version/calendar'] = calendarWorkspace;
  const statusPanel = panel('状态语义映射', '保留 Teambition 原始状态，用统一语义驱动完成判断、历时和风险通知。');
  statusPanel.box.classList.add('status-mapping-panel');
  statusPanel.body.classList.add('status-mapping-body');
  const statusContext = node('div', 'config-rule-controls status-context');
  const projectField = node('div', 'field'), workflowField = node('div', 'field');
  projectField.append(projectLabel, projectSelect); workflowField.append(workflowLabel, workflowSelect);
  statusContext.append(projectField, workflowField);
  const statusSummary = node('div', 'status-summary-content'); statusPanel.body.append(statusContext, statusSummary);
  const editMapping = button('编辑映射', () => { management.discardMapping(); control('mg-mapping-reason').value = ''; mappingEditor.showModal(); }, 'button primary');
  editMapping.hidden = !editable; statusPanel.head.append(editMapping);
  pages['status/mapping'] = statusPanel.box;
  const impactPanel = panel('影响与恢复', '保存映射后仍需重新同步并验证；未恢复前，相关异常继续保留。');
  impactPanel.box.classList.add('status-impact-panel');
  impactPanel.body.classList.add('status-impact-body');
  const recoverySummary = node('div', 'status-current-summary');
  const currentCard = node('section', 'status-current-card');
  currentCard.append(node('div', 'status-eyebrow', '当前状态'), recoverySummary);
  const pendingCard = node('section', 'status-card status-pending-card');
  pendingCard.append(node('h2', null, '待处理问题'), node('div', 'status-pending-content'));
  const verify = control('mg-verify'); verify.classList.add('status-verify-button');
  const auditLink = link('打开异常与审计', '#/anomalies', 'row-link status-audit-link');
  const verifyCard = node('section', 'status-card status-verification-card');
  verifyCard.append(node('h2', null, '验证恢复'), node('div', 'status-verification-note', '保存映射后可验证；全部映射补齐后才可验证成功。'), verify, auditLink);
  const recoveryGrid = node('div', 'status-recovery-grid'); recoveryGrid.append(pendingCard, verifyCard);
  impactPanel.body.append(currentCard, recoveryGrid);
  pages['status/impact'] = impactPanel.box;
  const peoplePanel = panel('人员与权限', '业务角色与系统权限分别维护；权限和身份状态维护仅对所有者开放。');
  peoplePanel.box.classList.add('people-access-panel');
  peoplePanel.body.classList.add('people-access-body');
  const peopleBody = node('div', 'people-list'); peoplePanel.body.append(peopleBody, link('身份与权限维护', '/acceptance', 'button small people-acceptance-link'));
  pages['people/people'] = peoplePanel.box;
  const noticePanel = panel('通知节点与接收规则', '只读展示已确认规则；本页操作不会发送消息。');
  noticePanel.box.classList.add('people-notice-panel');
  noticePanel.body.classList.add('people-notice-body');
  const noticeRows = [['基础流程完成', '核心需求参与者中的测试、运营、策划、PM'], ['细节完整完成', '核心需求参与者中的测试、运营、策划、PM'], ['优化需求完成', '相关策划角色']].map(cells => { const row = node('tr'); for (const cell of cells) row.append(node('td', null, cell)); return row; });
  const noticeTable = buildTable('通知节点与接收规则', ['通知节点', '接收规则'], noticeRows, '');
  noticeTable.classList.add('cfg-table-notices'); noticeTable.querySelector('table')?.classList.add('people-notice-table');
  const noticeConditions = node('div', 'people-notice-conditions');
  for (const [label, value] of [['投递条件', '通知节点已触发、需求关系符合规则、身份映射已确认。'], ['权限边界', '系统权限不增加通知资格；无法投递时，不自动替换接收人。'], ['接收人核对', '在对应需求中查看具体接收人；本页不逐人模拟或推算人数。']]) { const line = node('div'); line.append(node('span', null, label), node('span', null, value)); noticeConditions.append(line); }
  noticePanel.body.append(noticeTable, noticeConditions);
  pages['people/notice'] = noticePanel.box;
  const feedback = control('mg-feedback');
  const refresh = control('mg-refresh'); refresh.textContent = '刷新配置'; refresh.className = 'button small';
  header.append(heading, refresh);
  const brand = node('div', 'config-v2-brand'); brand.append(node('span', 'mark', '配'), node('span', null, '项目配置库'));
  rail.append(brand, link('返回行动中心', '#/action', 'button small'), node('div', 'config-v2-label', '配置工作区'));
  for (const [key, info] of Object.entries(spaces)) {
    const entry = button('', () => selectSpace(key), 'config-v2-nav'); entry.dataset.workspace = key;
    entry.append(node('b', null, info.title), node('small', null, info.sub)); rail.append(entry);
    const option = node('option', null, info.title); option.value = key; mobile.append(option);
  }
  rail.append(node('p', 'config-v2-rail-note', '异常与审计留在主导航；配置库只处理规则和映射。'));
  mobile.addEventListener('change', () => selectSpace(mobile.value));
  content.append(tabs, feedback, forms); forms.append(...Object.values(pages));
  main.append(header, content); layout.append(rail, main); view.append(layout);
  function updateLocation() {
    const query = new URLSearchParams({ section: space, tab });
    history.replaceState(null, '', '#/config?' + query);
  }
  function renderTabs() {
    tabs.replaceChildren();
    for (const [key, title] of spaces[space].tabs) {
      const entry = button(title, () => { tab = key; showPage(); updateLocation(); }, 'config-v2-subtab');
      entry.classList.toggle('active', tab === key); if (tab === key) entry.setAttribute('aria-current', 'page');
      tabs.append(entry);
    }
  }
  function showPage() {
    layout.dataset.workspace = space;
    for (const [key, page] of Object.entries(pages)) page.hidden = key !== space + '/' + tab;
    heading.replaceChildren(node('h1', null, spaces[space].title), node('div', 'note', spaces[space].sub), mobile);
    mobile.value = space;
    for (const entry of rail.querySelectorAll('[data-workspace]')) {
      entry.classList.toggle('active', entry.dataset.workspace === space);
      if (entry.dataset.workspace === space) entry.setAttribute('aria-current', 'page'); else entry.removeAttribute('aria-current');
    }
    renderTabs();
  }
  function selectSpace(key) { space = key; tab = spaces[key].tabs[0][0]; showPage(); updateLocation(); }
  const sourceNames = { system: '系统默认', version: '版本覆盖', requirement: '需求级覆盖' };
  function renderRuleSummary() {
    if (!catalog || !currentRules) return;
    const own = catalog.rules.find(rule => rule.scope === currentScope && rule.scope_key === currentKey)?.values ?? {};
    const missing = currentScope !== 'system' && !currentKey;
    editRules.disabled = missing;
    const objectName = currentScope === 'system' ? '系统默认' : currentScope === 'version' ? control('mg-version').selectedOptions[0]?.textContent : control('mg-requirement').selectedOptions[0]?.textContent;
    objectPanel.head.querySelector('h2').textContent = '当前配置：' + (objectName || '暂无对象');
    ruleSummary.replaceChildren();
    if (missing) { ruleSummary.append(emptyCard('暂无可配置对象。版本启用并读取需求后，可在这里配置。')); return; }
    if (currentScope !== 'system' && !Object.keys(own).length) {
      const inherit = panel(currentScope === 'version' ? '继承系统默认' : '继承上层配置', '当前对象尚未设置特殊配置。未修改的配置项始终继承上层；点击编辑可从当前生效值开始调整。');
      ruleSummary.append(inherit.box); return;
    }
    const progress = panel('进度完成条件', '先确认基础流程，再累计细节，最后核对全部交付内容。');
    for (const [key, title, note] of [['foundation', '基础流程完成条件', '所选职能的工单全部处理完成后，可开始验收测试。'], ['detail', '细节完整完成条件', '基础流程与以下职能的工单全部处理完成后，开发内网才算全部完成。']]) {
      const row = node('div', 'config-rule-stage');
      const main = node('div', 'config-rule-stage-main');
      const source = node('span', 'pill blue config-rule-source', sourceNames[currentRules[key].source]);
      const chips = node('div', 'requirement-tags');
      for (const value of currentRules[key].value) chips.append(node('span', 'pill', value));
      main.append(node('h3', null, title), node('p', 'note', note), chips);
      row.append(main, source); progress.body.append(row);
    }
    const fixed = node('div', 'config-rule-stage config-rule-fixed');
    const fixedMain = node('div', 'config-rule-stage-main');
    const fixedValues = node('div', 'requirement-tags');
    for (const value of ['核心专业子单', '测试总单及缺陷', '验收总单及子任务', '辅助子单及其他后代']) fixedValues.append(node('span', 'pill', value));
    fixedMain.append(node('h3', null, '测试阶段完成条件 · 固定规则'), fixedValues, node('p', 'note', '全部应处理的后代工单满足终态要求后，才可进入上线确认；不代表已经上线。'), node('p', 'note config-rule-footnote', '非交付终态单独标记，不计实际交付。所选职能没有工单时待负责人确认不适用；未知状态或数据缺失不视为完成。'));
    fixed.append(fixedMain); progress.body.append(fixed);
    const follow = panel('进度采集与开发关注', '开发关注阈值只提示复核，不表示超载或绩效。');
    const schedule = node('div', 'config-rule-setting');
    const scheduleHead = node('div', 'config-rule-setting-head');
    scheduleHead.append(node('h3', null, '进度采集时间'), node('span', 'pill blue config-rule-source', sourceNames[currentRules.schedules.source]));
    schedule.append(scheduleHead, node('p', null, currentRules.schedules.value.map(point => '周' + ['','一','二','三','四','五','六','日'][point.day] + ' ' + point.time).join('、')), node('p', 'note', '北京时间，仅在公司工作日执行。调休和特殊工作日也须命中所选星期、时刻；休息日跳过，不补发。'));
    const concurrency = node('div', 'config-rule-setting');
    const concurrencyHead = node('div', 'config-rule-setting-head');
    concurrencyHead.append(node('h3', null, '开发关注阈值'), node('span', 'pill blue config-rule-source', '全部活跃版本'));
    concurrency.append(concurrencyHead, node('p', null, '同一执行者的核心专业子单计划区间重叠达到 ' + currentRules.concurrency.value + ' 张时提示关注。'), node('p', 'note', '只提示复核，不表示超载或绩效。版本与需求不能单独覆盖。'));
    follow.body.append(schedule, concurrency);
    ruleSummary.append(progress.box, follow.box);
  }
  function renderStatusSummary(){
    if(!catalog)return;
    const project=catalog.projects.find(item=>item.id===projectSelect.value)??catalog.projects[0];
    const statuses=(project?.statuses??[]).filter(item=>workflowSelect.value==='__used__'?item.usedCount:!workflowSelect.value||item.workflowId===workflowSelect.value);
    let mapped=0,verified=0;
    const rows=statuses.map(status=>{
      const mapping=catalog.mappings.find(item=>item.source_project_id===project?.id&&item.status_id===status.id);
      if(mapping?.semantic)mapped++; if(mapping?.recovery==='verified')verified++;
      const row=node('tr'); row.className=mapping?.recovery==='verified'?'status-row-verified':mapping?.semantic?'status-row-pending':'status-row-unmapped';
      const source=node('td','status-source-cell',status.name); source.title='状态 ID：'+status.id;
      const workflow=node('td','status-workflow-cell',status.workflowName||'工作流名称未获取'); workflow.title='工作流 ID：'+status.workflowId;
      const semantic=node('td','status-semantic-cell',catalog.semantics[mapping?.semantic]||'未映射');
      const timing=node('td','status-timing-cell');
      const timingValues=mapping?.markers?.map(value=>({development_start:['开发开始','start'],development_end:['开发结束','end'],test_start:['测试开始','start'],test_end:['测试结束','end']})[value]).filter(Boolean)??[];
      if(timingValues.length)for(const [label,type] of timingValues)timing.append(node('span','tag status-timing-'+type,label));else timing.append(node('span','status-no-timing','无计时节点'));
      const recovery=node('td','status-recovery-cell'); recovery.append(node('span','tag '+(mapping?.recovery==='verified'?'green':'amber'),mapping?.recovery==='verified'?'已验证':mapping?.semantic?'待验证恢复':'待映射'));
      row.append(source,workflow,semantic,timing,recovery); return row;
    });
    const summary=node('div','status-summary'); summary.append(node('span','tag',statuses.length+' 个原始状态'),node('span','tag green',mapped+' 个已映射'),node('span','tag amber',(statuses.length-mapped)+' 个待映射'));
    const tableWrap=buildTable('状态语义映射',['原始状态','工作流','统一管理语义','计时节点','映射结果'],rows,'当前筛选没有状态。'); tableWrap.classList.add('status-table-wrap'); tableWrap.querySelector('table')?.classList.add('status-table'); statusSummary.replaceChildren(summary,tableWrap);
    const missing=statuses.filter(status=>{const mapping=catalog.mappings.find(item=>item.source_project_id===project?.id&&item.status_id===status.id);return !mapping?.semantic;});
    const pending=statuses.filter(status=>{const mapping=catalog.mappings.find(item=>item.source_project_id===project?.id&&item.status_id===status.id);return mapping?.semantic&&mapping?.recovery!=='verified';});
    const currentTag=node('span','tag '+(missing.length?'amber':verified===statuses.length&&statuses.length?'green':'amber'),missing.length?missing.length+' 个状态未映射':verified===statuses.length&&statuses.length?'验证通过':'映射已补齐，仍需验证');
    const currentMessage=node('p','status-message',missing.length?'未映射工单继续同步，受影响的完成判断、历时、风险和通知暂停。':verified===statuses.length&&statuses.length?'映射恢复已验证，相关能力可继续使用。':'保存映射后，须经同步、计算或校验确认恢复。');
    const currentHead=node('div','status-current-head');
    currentHead.append(node('h2',null,missing.length?'需要补齐状态映射':verified===statuses.length&&statuses.length?'验证通过':'映射已补齐，仍需验证'),currentTag);
    const facts=node('div','status-facts');
    for(const [label,value] of [['关联异常',missing.length+' 个状态待处理'],['影响范围','当前筛选 · '+statuses.length+' 个原始状态'],['受影响能力',missing.length||pending.length?'完成判断、历时、风险和通知暂停':'已恢复'],['下一步',missing.length?'补齐映射并保存':verified===statuses.length&&statuses.length?'查看异常与审计':'验证恢复结果']]){const fact=node('div');fact.append(node('span','status-fact-label',label),node('b',null,value));facts.append(fact);}
    recoverySummary.replaceChildren(currentHead,currentMessage,facts);
    const pendingContent=pendingCard.querySelector('.status-pending-content'); pendingContent.replaceChildren();
    if(missing.length){const list=node('ul','status-missing-list');for(const status of missing){const li=node('li'),detail=node('div');detail.append(node('b',null,status.name),node('span','status-workflow-note',status.workflowName||'工作流名称未获取'));li.append(detail,node('span','tag amber','待映射'));list.append(li);}pendingContent.append(list,node('p','status-note','未映射工单继续同步，受影响能力暂停。'));} else pendingContent.append(node('div','status-empty',pending.length?'无未映射状态，等待验证恢复。':'映射与验证已完成。'));
    recoverySummary.dataset.verified=String(verified); recoverySummary.dataset.total=String(statuses.length);
    const verifyButton=control('mg-verify'); verifyButton.classList.toggle('status-action-primary',!missing.length); verifyButton.disabled=!editable||Boolean(missing.length); verifyButton.title=missing.length?'全部状态映射后才能验证恢复':'';
  }
  function openCalendarDate(day = control('mg-calendar-day').value) {
    control('mg-calendar-day').value = day || '';
    control('mg-calendar-reason').value = '';
    const entry = catalog?.calendar?.[day];
    control('mg-calendar-working').value = entry ? String(entry.working) : 'inherit';
    const intervals = entry?.intervals ?? [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '18:00' }];
    const container = control('mg-calendar-intervals');
    while (container.children.length < intervals.length) control('mg-calendar-add-interval').click();
    while (container.children.length > intervals.length) container.lastElementChild.remove();
    for (const [index, interval] of intervals.entries()) {
      container.children[index].querySelector('[aria-label="时段开始"]').value = interval.start;
      container.children[index].querySelector('[aria-label="时段结束"]').value = interval.end;
    }
    control('mg-calendar-working').dispatchEvent(new Event('change'));
    calendarEditor.showModal();
  }
  function renderCalendar() {
    if (!catalog) return;
    calendarBoard.replaceChildren();
    const controls = node('div', 'cal-calendar-head');
    const move = offset => {
      const date = new Date(calendarMonth + '-01T00:00:00Z'); date.setUTCMonth(date.getUTCMonth() + offset);
      calendarMonth = date.toISOString().slice(0, 7); renderCalendar();
    };
    const [year, month] = calendarMonth.split('-');
    const title = node('h3'); title.append(document.createTextNode(year + ' 年 ' + Number(month) + ' 月 '), node('span', 'note', '点任意日期设置类型与说明'));
    const actions = node('div', 'cal-month-actions'); actions.append(button('‹ 上月', () => move(-1), 'button small'), button('下月 ›', () => move(1), 'button small'));
    controls.append(title, actions);
    const legend = node('div', 'cal-legend'); legend.setAttribute('aria-label', '日期类型图例');
    for (const [className, label] of [['workday', '工作日'], ['weekend', '周末'], ['holiday', '节假日'], ['shift', '补班']]) {
      const item = node('span'); item.append(node('i', 'cal-swatch ' + className), document.createTextNode(label)); legend.append(item);
    }
    const weekdays = node('div', 'config-calendar-week cal-weekdays');
    for (const day of ['日','一','二','三','四','五','六']) weekdays.append(node('span', null, day));
    const days = node('div', 'config-calendar-days cal-days');
    const start = new Date(calendarMonth + '-01T00:00:00Z');
    for (let i = 0; i < start.getUTCDay(); i++) days.append(node('span'));
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    for (let date = 1; date <= end.getUTCDate(); date++) {
      const day = calendarMonth + '-' + String(date).padStart(2, '0');
      const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      const entry = catalog.calendar[day], working = entry?.working ?? !weekend;
      const holiday = Boolean(entry && !working);
      const shift = Boolean(entry && working);
      const stateClass = holiday ? ' holiday' : shift ? ' special shift' : weekend ? ' rest weekend' : ' workday';
      const label = holiday ? '节假日' : shift ? '补班' : weekend ? '周末' : '工作日';
      const cell = button('', () => openCalendarDate(day), 'config-calendar-day cal-day' + stateClass);
      cell.setAttribute('aria-label', day + ' ' + label); cell.disabled = !editable;
      cell.append(node('strong', null, date), node('span', 'cal-label', label)); days.append(cell);
    }
    calendarBoard.append(controls, legend, weekdays, days);
  }
  async function showVersions() {
    const loadingBox = loading('正在读取版本范围…'); versionsPanel.body.replaceChildren(loadingBox);
    try {
      const [versions, status] = await Promise.all([api('/api/versions'), api('/api/status').catch(() => null)]);
      const lifecycleNames = { enrolled: '已纳入', stopped: '停止纳入', ended: '已结束' };
      const lifecycleTone = { enrolled: 'green', stopped: 'amber', ended: 'amber' };
      const rows = versions.map(version => {
        const row = node('tr', 'version-scope-row');
        const versionCell = node('td');
        versionCell.append(node('b', null, version.displayName));
        const ownerCell = node('td');
        ownerCell.append(node('div', null, version.ownerName || '待确认'));
        if (!version.ownerConfirmed) ownerCell.append(node('div', 'note', '负责人身份待确认'));
        const lifecycleCell = node('td');
        lifecycleCell.append(node('span', 'pill ' + (lifecycleTone[version.lifecycle ?? 'enrolled'] || 'amber'), lifecycleNames[version.lifecycle ?? 'enrolled'] || '状态待核对'));
        const syncCell = node('td');
        syncCell.append(statusNode(version), node('div', 'note', formatDate(version.lastSuccessAt)));
        const automationCell = node('td');
        automationCell.append(node('div', null, !status ? '调度状态读取失败' : !status.pollingEnabled ? '自动轮询未启用' : !version.ownerConfirmed ? '负责人待确认' : '自动轮询已启用'), node('div', 'note', status?.pollingEnabled && version.ownerConfirmed ? '下次检查：' + formatDate(version.nextDueAt) : '需要人工核对后恢复'));
        const bindingCell = node('td');
        bindingCell.append(node('span', 'pill ' + (version.bindingVerifiedAt ? 'green' : 'amber'), version.bindingVerifiedAt ? '已核对' : '待首次核对'));
        const actions = node('td', 'config-row-actions'); actions.append(link('查看任务', versionHash(version.id), 'row-link'));
        if (editable && (!version.lifecycle || version.lifecycle === 'enrolled')) {
          const sync = button('读取来源并同步', async () => { sync.disabled = true; try { await syncOne(version); } finally { sync.disabled = false; } }, 'button small'); actions.append(sync);
        }
        row.append(versionCell, ownerCell, node('td', null, formatDate(version.syncStartAt)), lifecycleCell, syncCell, automationCell, bindingCell, actions); return row;
      });
      const table = buildTable('版本范围', ['版本', '负责人', 'Teambition 同步起点', '本系统状态', '最近同步', '自动同步', '来源绑定', '操作'], rows, '尚未纳入版本。');
      table.classList.add('version-scope-table-wrap');
      table.querySelector('table')?.classList.add('version-scope-table');
      versionsPanel.body.replaceChildren(table, node('p', 'note', '来源未提供的 TB 计划和状态不推测填写。移除、停止、恢复及结束管理尚无正式接口，本页保留当前事实。'));
    } catch (error) { versionsPanel.body.replaceChildren(errorCard(error.message, showVersions)); }
  }
  async function syncOne(version) {
    const reason = window.prompt('请填写本次同步原因。取消则不执行。'); if (!reason?.trim()) return;
    try {
      const result = await api('/api/versions/' + version.id + '/sync', { method: 'POST', body: { reason } });
      feedback.textContent = result.status === 'succeeded' ? '同步完成：' + result.importedCount + ' 张任务。' : '同步失败：' + result.errorCode + '。已有数据保留。';
      clearVersionCaches(version.id); await showVersions();
    } catch (error) { feedback.textContent = '同步未完成：' + error.message + '。请先刷新核对结果，不要重复提交。'; }
  }
  const refreshVersions = button('刷新版本列表', showVersions, 'button small'); versionsPanel.head.append(refreshVersions);
  const enrollment = node('dialog', 'config-v2-dialog'); enrollment.setAttribute('aria-label', '选择版本'); forms.append(enrollment);
  async function openEnrollment() {
    enrollment.replaceChildren(node('h2', 'section-title', '选择版本'), loading('正在读取已批准候选版本与负责人…'));
    enrollment.showModal();
    try {
      const [choices, people] = await Promise.all([api('/api/source-candidates'), api('/api/version-people')]);
      const form = node('form', 'config-enrollment');
      const candidate = node('select', 'select'), owner = node('select', 'select'), reason = node('textarea', 'input');
      const addField = (title, element) => { element.setAttribute('aria-label', title); const label = node('label', 'field'); label.append(node('span', null, title), element); form.append(label); };
      for (const [select, title] of [[candidate, '请选择版本'], [owner, '请选择负责人']]) { select.required = true; const option = node('option', null, title); option.value = ''; select.append(option); }
      for (const choice of choices) { const option = node('option', null, choice.projectName + ' · ' + choice.versionName); option.value = choice.versionId; option.dataset.project = choice.projectId; candidate.append(option); }
      for (const person of people) { const option = node('option', null, person.displayName); option.value = person.id; owner.append(option); }
      reason.required = true; reason.maxLength = 500;
      addField('Teambition 版本', candidate); addField('版本负责人', owner); addField('核对依据与纳入原因', reason);
      form.append(node('p', 'note', '启用时补齐当前工单结构与状态；起点前的流转和历时不自动追溯。同一版本重复确认仅核对负责人，不改变原同步起点。'));
      const errorText = node('p', 'error-box'); errorText.hidden = true; errorText.setAttribute('role', 'alert');
      const actions = node('div', 'section-actions');
      const save = button('核对来源并确认', () => {}, 'button primary'); save.type = 'submit'; save.disabled = !choices.length || !people.length;
      actions.append(button('取消', () => enrollment.close(), 'button small'), save); form.append(errorText, actions);
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (!form.reportValidity()) return; save.disabled = true;
        try {
          await api('/api/versions', { method: 'POST', body: { projectId: candidate.selectedOptions[0].dataset.project, versionId: candidate.value, ownerId: owner.value, reason: reason.value } });
          enrollment.close(); feedback.textContent = '已确认版本与负责人；请同步来源读取当前快照。'; state.versions = null;
          await showVersions();
          try { await management.refresh(); populateVersionSelect(await loadVersions(true)); }
          catch { feedback.textContent = '版本已确认，但配置刷新失败；请刷新配置核对，无需重复确认。'; }
        } catch (error) { errorText.hidden = false; errorText.textContent = '确认未完成：' + error.message + '。若请求中断，请先刷新列表核对保存结果。'; }
        finally { save.disabled = false; }
      });
      enrollment.replaceChildren(node('h2', 'section-title', '选择版本'), form);
    } catch (error) { enrollment.replaceChildren(errorCard(error.message), button('关闭', () => enrollment.close(), 'button small')); }
  }
  const enroll = button('选择版本', openEnrollment, 'button primary'); enroll.hidden = !editable; versionsPanel.head.append(enroll);
  const personEditor = node('dialog', 'config-v2-dialog person-dialog'); personEditor.setAttribute('aria-label', '编辑人员配置'); forms.append(personEditor);
  function openPersonEditor(person, kind) {
    const form = node('form', 'config-person-editor');
    const body = node('div', 'person-dialog-body');
    const field = (title, input) => { input.setAttribute('aria-label', title); const label = node('label', 'field'); label.append(node('span', null, title), input); body.append(label); };
    let role, active, mapping, name, identity, confirmed;
    if (!person) {
      name = node('input', 'input'); name.required = true; name.maxLength = 100; field('显示姓名', name);
      identity = node('input', 'input'); identity.required = true; identity.maxLength = 200; identity.autocomplete = 'off'; field('已核实的钉钉 Union ID', identity);
      confirmed = node('input'); confirmed.type = 'checkbox'; confirmed.required = true; field('已核对当前企业及该人员的可信身份', confirmed);
    } else if (kind === 'role') {
      role = node('select', 'select');
      for (const [value, title] of Object.entries(ROLE_NAMES)) { const option = node('option', null, title); option.value = value; role.append(option); }
      role.value = person.role; field('系统权限', role);
    } else {
      active = node('input'); active.type = 'checkbox'; active.checked = person.active; field('启用人员', active);
      mapping = node('input'); mapping.type = 'checkbox'; mapping.checked = person.mappingEnabled; field('启用身份映射', mapping);
    }
    const reason = node('textarea', 'input'); reason.required = true; reason.maxLength = 500; field('变更依据与原因', reason);
    body.append(node('p', 'note person-dialog-note', person ? '保存权限或身份变更会撤销该人员旧会话。最后一名有效所有者不能降级或停用。' : '登记后无后台权限，须由所有者明确授权。不按姓名自动匹配身份。'));
    const error = node('p', 'error-box'); error.hidden = true; error.setAttribute('role', 'alert');
    body.append(error); form.append(body);
    const actions = node('div', 'section-actions person-dialog-actions'); const save = button('确认保存', () => {}, 'button primary'); save.type = 'submit';
    actions.append(button('取消', () => personEditor.close(), 'button small'), save); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return; save.disabled = true;
      try {
        if (!person) await api('/api/identities', { method: 'POST', body: { displayName: name.value, unionId: identity.value, reason: reason.value, confirmed: confirmed.checked } });
        else {
          const changes = kind === 'role' ? { role: role.value } : { active: active.checked, mappingEnabled: mapping.checked };
          if (Object.entries(changes).every(([key, value]) => value === person[key])) throw new Error('没有修改配置。');
          await api('/api/' + (kind === 'role' ? 'access/' : 'identities/') + person.id, { method: 'PATCH', body: { ...changes, reason: reason.value } });
        }
        personEditor.close(); feedback.textContent = person ? '变更已保存，目标人员旧会话已撤销。' : '身份已登记，尚无后台权限。';
        if (person?.id === state.actor.id) { location.reload(); return; }
        await showPeople();
      } catch (failure) { error.hidden = false; error.textContent = failure.message + '；请求中断时请先刷新核对结果，不要重复提交。'; }
      finally { save.disabled = false; }
    });
    personEditor.replaceChildren(node('h2', 'section-title person-dialog-head', person ? person.displayName + (kind === 'role' ? ' · 系统权限' : ' · 身份配置') : '登记已核实身份'), form);
    personEditor.showModal();
  }
  const registerPerson = button('登记已核实身份', () => openPersonEditor(null), 'button primary');
  registerPerson.hidden = !editable; peoplePanel.head.append(registerPerson);
  async function showPeople() {
    try {
      if (state.actor.role !== 'owner') { peopleBody.replaceChildren(node('p', null, '当前身份：' + state.actor.displayName + ' · ' + (ROLE_NAMES[state.actor.role] || '权限未知')), node('p', 'note', '完整系统权限清单仅对所有者开放。')); return; }
      const records = await api('/api/access');
      const rows = records.map(person => {
        const row = node('tr'); const actions = node('td', 'config-row-actions');
        actions.classList.add('person-actions');
        const personCell = node('td', 'person-name-cell'); personCell.append(node('b', null, person.displayName), node('div', 'person-cell-note', person.active && person.mappingEnabled && person.confirmed ? '身份映射已确认' : '身份映射待核对'));
        const access = ROLE_NAMES[person.role] || '未知'; const accessClass = person.role === 'owner' || person.role === 'admin' ? person.role : 'neutral';
        const accessCell = node('td'); accessCell.append(node('span', 'person-access ' + accessClass, access));
        const valid = person.active && person.mappingEnabled && person.confirmed; const mapCell = node('td'); mapCell.append(node('span', 'person-map ' + (valid ? 'valid' : 'attention'), valid ? '身份有效' : '停用或未确认'));
        actions.append(button('编辑权限', () => openPersonEditor(person, 'role'), 'button small'), button('编辑身份', () => openPersonEditor(person, 'identity'), 'button small'));
        row.append(personCell, accessCell, mapCell, actions); return row;
      });
      const peopleTable = buildTable('人员与权限', ['人员', '系统权限', '身份状态', '操作'], rows, '暂无人员。'); peopleTable.classList.add('people-table-wrap'); peopleTable.querySelector('table')?.classList.add('people-table');
      peopleBody.replaceChildren(peopleTable, node('p', 'note people-access-note', '业务角色编辑和需求范围接收人预览尚未接入。系统权限不自动推定业务角色。'));
    } catch (error) { peopleBody.replaceChildren(errorCard(error.message, showPeople)); }
  }
  management = await setupManagement(state.actor, (path, method = 'GET', value) => api(path, { method, body: value }), layout, {
    onChange(value) { catalog = value.data; currentRules = value.rules; currentScope = value.scope; currentKey = value.key; renderRuleSummary(); renderStatusSummary(); renderCalendar(); },
    onSaved() { for (const editor of editors) editor.close(); }
  });
  for (const select of [projectSelect, workflowSelect]) select.addEventListener('change', renderStatusSummary);
  refresh.addEventListener('click', () => { void showVersions(); void showPeople(); });
  for (const input of [control('mg-scope'), control('mg-version'), control('mg-requirement')]) input.addEventListener('change', renderRuleSummary);
  // Status summaries use saved catalog values, never the unsaved editor draft.
  const updateStatus = () => renderStatusSummary();
  mappingEditor.addEventListener('close', () => { management.discardMapping(); updateStatus(); });
  control('mg-review').addEventListener('close', () => { renderRuleSummary(); renderStatusSummary(); });
  await Promise.all([showVersions(), showPeople()]); renderStatusSummary(); showPage();
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
    state.actualTimeReady = (await api('/api/status').catch(() => null))?.actualTimeBatch === true;
    if (!state.actor) return;
    $('boot').hidden = true;
    $('login-view').hidden = true;
    $('app').hidden = false;
    $('side-user').textContent = state.actor.displayName + ' · ' + (ROLE_NAMES[state.actor.role] ?? '权限未知');
    $('role-chip').textContent = ROLE_NAMES[state.actor.role] ?? '权限未知';
    const canSync = ['admin', 'owner'].includes(state.actor.role);
    $('source-sync-controls').hidden = !canSync;
    $('tb-sync').hidden = !canSync;
    $('feedback-sync').hidden = !canSync;
    if (canSync) {
      $('tb-sync').addEventListener('click', syncLatestTb);
      $('feedback-sync').addEventListener('click', syncLatestFeedback);
    }
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
