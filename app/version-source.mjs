import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';

const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];

export function normalizeWorkItem(input, knownIds = new Set()) {
  const issues = [];
  const sourceTaskId = text(input?.sourceTaskId, 200);
  const title = text(input?.title, 500);
  if (!sourceTaskId) issues.push('missing_source_task_id');
  if (!title) issues.push('missing_title');
  const parent = text(input?.parentSourceTaskId, 200);
  if (parent && parent === sourceTaskId) issues.push('self_parent');
  if (parent && knownIds.size && !knownIds.has(parent)) issues.push('parent_missing');
  issues.push(...list(input?.structureIssues));
  const availability = issues.length ? 'incomplete' : (input?.typeName || input?.category || input?.functionName || input?.status ? 'available' : 'unknown');
  return {
    sourceTaskId: sourceTaskId ?? `unknown-${randomUUID()}`,
    visibleKey: text(input?.visibleKey, 200),
    title: title ?? '未识别标题',
    typeId: text(input?.typeId, 200),
    typeName: text(input?.typeName, 200),
    category: text(input?.category, 200),
    functionName: text(input?.functionName, 200),
    parentSourceTaskId: parent,
    parentMissing: issues.includes('parent_missing'),
    rawStatus: text(input?.status, 200),
    availability,
    structureIssues: [...new Set(issues)],
    sourceUpdatedAt: input?.sourceUpdatedAt ?? null,
    rawSource: input?.rawSource ?? (input && typeof input === 'object' ? input : {})
  };
}

export async function enrollVersion(pool, { corpId, projectId, projectName, versionId, versionName, ownerId }) {
  if (!text(corpId, 200) || !text(projectId, 100) || !text(projectName, 200) || !text(versionId, 100) || !text(versionName, 200)) throw new Error('版本或来源信息不完整');
  return transaction(pool, async client => {
    const project = (await client.query(`INSERT INTO source_projects(id,corp_id,teambition_project_id,display_name) VALUES($1,$2,$3,$4)
      ON CONFLICT(teambition_project_id) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`, [randomUUID(), corpId, projectId, projectName])).rows[0];
    const version = (await client.query(`INSERT INTO managed_versions(id,source_project_id,source_version_id,display_name,owner_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_project_id,source_version_id) DO UPDATE SET display_name=EXCLUDED.display_name,owner_id=EXCLUDED.owner_id RETURNING *`, [randomUUID(), project.id, versionId, versionName, ownerId ?? null])).rows[0];
    await client.query(`INSERT INTO tracking_periods(id,managed_version_id,started_at,reason) VALUES($1,$2,$3,$4)
      ON CONFLICT DO NOTHING`, [randomUUID(), version.id, version.sync_start_at, '首次纳入']);
    await client.query(`INSERT INTO source_sync_states(managed_version_id) VALUES($1) ON CONFLICT DO NOTHING`, [version.id]);
    return version;
  });
}

export async function syncVersion(pool, versionId, readSource) {
  const runId = randomUUID();
  const startedAt = new Date();
  let snapshot;
  try { snapshot = await readSource(); }
  catch { await recordFailure(pool, versionId, runId, startedAt, 'SOURCE_READ_FAILED'); return { status: 'failed', errorCode: 'SOURCE_READ_FAILED', importedCount: 0 }; }
  if (!snapshot || !Array.isArray(snapshot.items)) { await recordFailure(pool, versionId, runId, startedAt, 'SOURCE_STRUCTURE_INVALID'); return { status: 'failed', errorCode: 'SOURCE_STRUCTURE_INVALID', importedCount: 0 }; }
  return transaction(pool, async client => {
    const ids = new Set(snapshot.items.map(item => text(item?.sourceTaskId, 200)).filter(Boolean));
    const items = snapshot.items.map(item => normalizeWorkItem(item, ids));
    await client.query(`INSERT INTO source_sync_runs(id,managed_version_id,started_at,finished_at,status,imported_count) VALUES($1,$2,$3,now(),'succeeded',$4)`, [runId, versionId, startedAt, items.length]);
    for (const item of items) await client.query(`INSERT INTO work_items(id,managed_version_id,source_task_id,visible_key,title,type_id,type_name,category,function_name,parent_source_task_id,parent_missing,raw_status,availability,structure_issues,source_updated_at,last_synced_at,raw_source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16)
      ON CONFLICT(managed_version_id,source_task_id) DO UPDATE SET visible_key=EXCLUDED.visible_key,title=EXCLUDED.title,type_id=EXCLUDED.type_id,type_name=EXCLUDED.type_name,category=EXCLUDED.category,function_name=EXCLUDED.function_name,parent_source_task_id=EXCLUDED.parent_source_task_id,parent_missing=EXCLUDED.parent_missing,raw_status=EXCLUDED.raw_status,availability=EXCLUDED.availability,structure_issues=EXCLUDED.structure_issues,source_updated_at=EXCLUDED.source_updated_at,last_synced_at=now(),raw_source=EXCLUDED.raw_source`, [randomUUID(), versionId, item.sourceTaskId, item.visibleKey, item.title, item.typeId, item.typeName, item.category, item.functionName, item.parentSourceTaskId, item.parentMissing, item.rawStatus, item.availability, JSON.stringify(item.structureIssues), item.sourceUpdatedAt, JSON.stringify(item.rawSource)]);
    await client.query(`UPDATE source_sync_states SET last_attempt_at=now(),last_success_at=now(),last_status='succeeded',last_error_code=NULL,last_error_detail=NULL WHERE managed_version_id=$1`, [versionId]);
    return { status: 'succeeded', importedCount: items.length };
  });
}

async function recordFailure(pool, versionId, runId, startedAt, code) {
  await transaction(pool, async client => {
    await client.query(`INSERT INTO source_sync_runs(id,managed_version_id,started_at,finished_at,status,error_code,error_detail) VALUES($1,$2,$3,now(),'failed',$4,$5)`, [runId, versionId, startedAt, code, '来源读取失败，已有工作事实保留']);
    await client.query(`UPDATE source_sync_states SET last_attempt_at=now(),last_status='failed',last_error_code=$2,last_error_detail=$3 WHERE managed_version_id=$1`, [versionId, code, '来源读取失败，已有工作事实保留']);
  });
}

const fieldValue = (task, fieldId) => {
  if (!fieldId) return null;
  const field = Array.isArray(task?.customfields) ? task.customfields.find(item => item.cfId === fieldId) : null;
  const value = field?.value?.[0];
  return value?.title ?? value?.value ?? null;
};

export function mapTeambitionTask(task, fieldMap = {}) {
  const typeName = task?.sfcName ?? fieldMap.typeNames?.[task?.sfcId] ?? null;
  const functionName = fieldValue(task, fieldMap.function);
  return {
    sourceTaskId: task?.id,
    visibleKey: task?.uniqueId == null ? null : String(task.uniqueId),
    title: task?.content,
    typeId: task?.sfcId,
    typeName,
    category: fieldValue(task, fieldMap.category),
    functionName,
    parentSourceTaskId: task?.parentTaskId,
    status: task?.tfsName ?? task?.tfsId,
    sourceUpdatedAt: task?.updated,
    structureIssues: [
      ...(task?.sfcId && !typeName ? ['unknown_task_type'] : []),
      ...(typeName === '子需求' && !functionName ? ['missing_function'] : []),
      ...(task?.tfsId && !task?.tfsName ? ['unknown_status'] : []),
      ...(!Array.isArray(task?.customfields) ? ['customfields_missing'] : [])
    ],
    rawSource: task
  };
}

export function createTeambitionSourceReader({ listTasks, projectId, versionId, fieldMap = {}, pageSize = 100 }) {
  if (typeof listTasks !== 'function' || !text(projectId, 100) || !text(versionId, 100)) throw new Error('来源读取参数不完整');
  return async () => {
    const items = [];
    let pageToken;
    do {
      const page = await listTasks({ projectId, pageSize, pageToken, fields: 'all' });
      if (!page || !Array.isArray(page.result)) throw new Error('来源响应结构错误');
      items.push(...page.result.filter(task => task?.sprintId === versionId).map(task => mapTeambitionTask(task, fieldMap)));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return { items };
  };
}
