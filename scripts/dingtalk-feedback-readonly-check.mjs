import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnvFile } from './dingtalk-progress-form-link.mjs';

export function validateFeedback(records, { task, project, mapping }) {
  assert(task && project && mapping, '缺少任务、项目或已确认身份对应关系');
  assert(task.projectId === project.id && typeof project.uniqueIdPrefix === 'string' && project.uniqueIdPrefix, '项目范围不匹配');
  assert(Number.isSafeInteger(task.uniqueId) && task.uniqueId > 0 && typeof task.content === 'string' && task.content, '任务编号或标题缺失');
  assert(typeof task.executorId === 'string' && task.executorId && mapping.confirmed === true && mapping.tbUserId === task.executorId && typeof mapping.unionId === 'string' && mapping.unionId, '缺少当前执行者的已确认身份映射');
  const number = project.uniqueIdPrefix + '-' + task.uniqueId;
  const seen = new Set();
  for (const r of records) {
    assert(typeof r.id === 'string' && r.id && !seen.has(r.id), '记录 ID 缺失或重复，停止判定');
    seen.add(r.id);
  }
  const results = records.map(r => {
    const f = r.fields || {}, reasons = [], reviews = [];
    if (f['TB工单id'] !== number) reasons.push('任务编号不匹配本次受控测试任务');
    if (f['任务'] !== task.content) reasons.push('任务标题与当前 Teambition 标题不匹配');
    if (r.createdBy?.unionId !== mapping.unionId || f['提交人']?.unionId !== mapping.unionId) reasons.push('平台创建人或提交人不是已确认执行者');
    if (task.isDone !== false || task.isArchived !== false) reasons.push('任务已终态、归档或状态未知');
    if (!Number.isSafeInteger(r.createdTime) || r.createdTime <= 0) reasons.push('平台提交时间无效');
    const value = f['当前进度百分比'];
    const numeric = typeof value === 'number' || (typeof value === 'string' && /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value));
    const raw = numeric ? Number(value) : NaN, percent = Math.round(raw * 100);
    if (!Number.isFinite(raw) || raw < 0 || raw > 1 || Math.abs(raw * 100 - percent) > 1e-8) reasons.push('进度必须能换算为 0–100 的整数百分比');
    const situation = f['当前情况']?.name;
    if (!['进度正常', '存在风险', '已阻塞'].includes(situation)) {
      if (situation === '已暂停') reviews.push('已暂停与已阻塞的对应含义未确认');
      else reasons.push('当前情况缺失或不支持');
    }
    const risk = f['风险原因与所需协助']?.markdown;
    if (['存在风险', '已阻塞'].includes(situation)) {
      if (typeof risk !== 'string' || !risk.trim()) reasons.push('风险或阻塞说明必填');
      else reviews.push('风险原因、影响及所需协助是否充分，需人工复核');
    }
    return {
      recordId: r.id, submittedAt: Number.isSafeInteger(r.createdTime) ? r.createdTime : null,
      taskNumber: typeof f['TB工单id'] === 'string' ? f['TB工单id'] : null,
      progressPercent: Number.isFinite(raw) && raw >= 0 && raw <= 1 && Math.abs(raw * 100 - percent) <= 1e-8 ? percent : null,
      verdict: reasons.length ? 'reject' : reviews.length ? 'review' : 'passes_checked_rules',
      reasons, reviews,
    };
  });
  const candidates = results.filter(r => r.verdict === 'passes_checked_rules').sort((a, b) => b.submittedAt - a.submittedAt);
  const tied = candidates.length > 1 && candidates[0].submittedAt === candidates[1].submittedAt;
  return {
    mode: 'read_only_test', selectionPolicy: 'latest_valid_submission_per_task', taskNumber: number, results,
    latestCheckedCandidate: tied ? null : candidates[0]?.recordId || null,
    blockers: ['尚未校验活跃版本、同步起点及正式反馈处理，不能更新正式当前进度', '身份映射为本次人工确认，不代表正式权限系统已实现', ...(tied ? ['最新候选提交时间相同，需消歧'] : [])],
    writesPerformed: false,
  };
}

// shortcut: this reader is limited to the known Notable 1.0 test table; validate other versions separately.
export async function readRawFeedback(values, { baseId, sheetId }, fetchImpl = fetch) {
  assert(baseId && sheetId && values.DINGTALK_OPERATOR_UNION_ID, '缺少测试表及操作者配置');
  async function json(url, options) {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('钉钉只读请求失败，HTTP ' + response.status);
    return response.json();
  }
  const token = await json('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: values.DINGTALK_CLIENT_ID, appSecret: values.DINGTALK_CLIENT_SECRET }),
  });
  assert(typeof token.accessToken === 'string' && token.accessToken, '未取得应用令牌');
  const url = new URL('https://api.dingtalk.com/v1.0/notable/bases/' + encodeURIComponent(baseId) + '/sheets/' + encodeURIComponent(sheetId) + '/records/list');
  url.searchParams.set('operatorId', values.DINGTALK_OPERATOR_UNION_ID);
  const all = [], tokens = new Set();
  let nextToken;
  do {
    const data = await json(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token.accessToken },
      body: JSON.stringify({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }),
    });
    assert(Array.isArray(data.records) && typeof data.hasMore === 'boolean', '记录响应不完整，停止而非当作空表');
    all.push(...data.records);
    if (!data.hasMore) break;
    assert(typeof data.nextToken === 'string' && data.nextToken && !tokens.has(data.nextToken), '分页游标缺失或重复，停止读取');
    tokens.add(data.nextToken);
    nextToken = data.nextToken;
    assert(tokens.size < 100, '测试读取超出分页上限，停止而非截断');
  } while (true);
  return all;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const context = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const age = Date.now() - Date.parse(context.capturedAt);
    assert(Number.isFinite(age) && age >= 0 && age <= 10 * 60 * 1000, '测试任务快照超过 10 分钟，请重新只读获取');
    assert(Array.isArray(context.sampleRecordIds) && context.sampleRecordIds.length > 0 && new Set(context.sampleRecordIds).size === context.sampleRecordIds.length, '需要明确非空且不重复的样本记录');
    const values = parseEnvFile(join(process.env.LOCALAPPDATA, 'VikingPM', 'dingtalk.env'));
    const all = await readRawFeedback(values, context.table);
    const samples = all.filter(r => context.sampleRecordIds.includes(r.id));
    assert(samples.length === context.sampleRecordIds.length, '样本缺失或重复，停止判定');
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...validateFeedback(samples, context) }, null, 2));
  } catch {
    console.error('只读校验未完成：请检查授权、测试快照、样本和接口响应；未写入业务数据，未输出凭证。');
    process.exitCode = 1;
  }
}
