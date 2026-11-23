import {revalidateFeedback} from './feedback-state.mjs';
import {resolveFunction} from './function-catalog.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import {validateHistory,persistHistory} from './source-history.mjs';
import { Denied, requireCurrentRole } from './security.mjs';

const scheduledActor=Symbol('scheduled-sync');
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f]/.test(value) ? value.trim() : null;
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function reason(value) { if (!text(value,500)) throw new Denied(400,'请填写操作原因'); }
async function audit(client, actorId, action, after, why) {
  await client.query('INSERT INTO audit_events(actor_id,action,after_value,reason) VALUES($1,$2,$3,$4)',[actorId===scheduledActor?null:actorId,action,after,why]);
}
export function normalizeWorkItem(input, knownIds = new Set()) {
  const issues = [];
  const sourceTaskId = text(input?.sourceTaskId, 200);
  const title = text(input?.title, 500);
  if (!sourceTaskId) issues.push('missing_source_task_id');
  if (!title) issues.push('missing_title');
  const parent = text(input?.parentSourceTaskId, 200);
  const functionState=resolveFunction(input?.functionName);
  if(functionState.issue)issues.push(functionState.issue);
  if (parent && parent === sourceTaskId) issues.push('self_parent');
  if (parent && parent !== sourceTaskId && !knownIds.has(parent)) issues.push('parent_missing');
  issues.push(...list(input?.structureIssues));
  return {
    sourceTaskId,
    executorSourceId:input?.executorSourceId ?? null,participantSourceIds:input?.participantSourceIds ?? null,
    plannedStartAt:input?.plannedStartAt ?? null,plannedDueAt:input?.plannedDueAt ?? null,sourceCompletedAt:input?.sourceCompletedAt ?? null,isDone:input?.isDone ?? null,
    visibleKey: text(input?.visibleKey, 200), title: title ?? '未识别标题',
    typeId: text(input?.typeId, 200), typeName: text(input?.typeName, 200),
    category: text(input?.category, 200), functionName: text(input?.functionName, 200), functionResolution: input?.functionResolution ?? functionState.resolution,
    parentSourceTaskId: parent, parentMissing: issues.includes('parent_missing'),
    sourceStatusId: text(input?.sourceStatusId,200), rawStatus: text(input?.status,200),
    availability: issues.length ? 'incomplete' : (input?.typeName || input?.category || input?.functionName || input?.status ? 'available' : 'unknown'),
    structureIssues: [...new Set(issues)], sourceUpdatedAt: input?.sourceUpdatedAt ?? null,
    rawSource: input?.rawSource ?? (input && typeof input === 'object' ? input : {})
  };
}
export function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length > 10000) throw new Error('来源快照不完整');
  const ids = new Set();
  for (const item of snapshot.items) {
    if (!text(item?.sourceTaskId,200) || item.sourceTaskId !== item.sourceTaskId.trim() || ids.has(item.sourceTaskId) || (item.sourceUpdatedAt != null && (typeof item.sourceUpdatedAt !== 'string' || !Number.isFinite(Date.parse(item.sourceUpdatedAt))))) throw new Error('来源任务标识、时间或去重校验失败');
    ids.add(item.sourceTaskId);
  }
  for(const item of snapshot.items)for(const key of ['plannedStartAt','plannedDueAt','sourceCompletedAt'])if(item[key]!=null && (typeof item[key]!=='string'||!Number.isFinite(Date.parse(item[key]))))throw new Error('来源计划或完成日期不合法');
  const items = snapshot.items.map(item => normalizeWorkItem(item,ids));
  const parents = new Map(items.map(item => [item.sourceTaskId,item.parentSourceTaskId]));
  const done = new Set();
  for (const start of parents.keys()) {
    const path = new Set(); let current = start;
    while (parents.has(current) && !done.has(current)) {
      if (path.has(current)) throw new Error('来源父子关系循环');
      path.add(current); current = parents.get(current);
    }
    for (const node of path) done.add(node);
  }
  return items;
}
export async function enrollVersion(pool, input, actorId) {
  const {corpId,projectId,projectName,versionId,versionName,ownerId,reason:why} = input;
  reason(why);
  if (!uuid(ownerId) || ![corpId,projectId,projectName,versionId,versionName].every(value=>text(value,200))) throw new Denied(400,'版本或来源信息不完整');
  return transaction(pool,async client => {
    await requireCurrentRole(client,actorId,'admin');
    const owner = await client.query('SELECT 1 FROM people p JOIN identity_mappings i ON i.person_id=p.id WHERE p.id=$1 AND p.active AND i.enabled AND i.confirmed AND i.corp_id=$2',[ownerId,corpId]);
    if (!owner.rowCount) throw new Denied(400,'请从已核实人员中选择版本负责人');
    const existing = (await client.query('SELECT id,corp_id FROM source_projects WHERE teambition_project_id=$1 FOR UPDATE',[projectId])).rows[0];
    if (existing && existing.corp_id !== corpId) throw new Denied(409,'来源企业绑定不匹配');
    const project = (await client.query(`INSERT INTO source_projects(id,corp_id,teambition_project_id,display_name) VALUES($1,$2,$3,$4)
      ON CONFLICT(teambition_project_id) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`,[randomUUID(),corpId,projectId,projectName])).rows[0];
    const previous = (await client.query('SELECT * FROM managed_versions WHERE source_project_id=$1 AND source_version_id=$2',[project.id,versionId])).rows[0];
    if (previous) {
      if (previous.lifecycle !== 'enrolled') throw new Denied(409,'该版本需要单独恢复纳入');
      if (previous.owner_id !== ownerId) {
        await client.query('UPDATE managed_versions SET owner_id=$2 WHERE id=$1',[previous.id,ownerId]);
        await client.query('UPDATE source_sync_states SET next_due_at=LEAST(next_due_at,now()) WHERE managed_version_id=$1',[previous.id]);
        await audit(client,actorId,'version.owner.confirm',{versionId:previous.id,previousOwnerId:previous.owner_id,ownerId},why);
      }
      return {...previous,owner_id:ownerId};
    }
    const version = (await client.query('INSERT INTO managed_versions(id,source_project_id,source_version_id,display_name,owner_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),project.id,versionId,versionName,ownerId])).rows[0];
    await client.query('INSERT INTO tracking_periods(id,managed_version_id,started_at,reason) VALUES($1,$2,$3,$4)',[randomUUID(),version.id,version.sync_start_at,why]);
    await client.query('INSERT INTO source_sync_states(managed_version_id) VALUES($1)',[version.id]);
    await audit(client,actorId,'version.enroll',{versionId:version.id,projectId,sourceVersionId:versionId,ownerId,syncStartAt:version.sync_start_at},why);
    return version;
  });
}
async function authorizeSync(client,versionId,actorId,lock=true) {
  if(actorId!==scheduledActor)return requireCurrentRole(client,actorId,'admin',lock);
  if(lock)await client.query('SELECT id FROM security_state WHERE id=1 FOR UPDATE');
  const owner=await client.query(`SELECT 1 FROM managed_versions v JOIN people p ON p.id=v.owner_id JOIN identity_mappings i ON i.person_id=p.id JOIN source_projects s ON s.id=v.source_project_id WHERE v.id=$1 AND v.lifecycle='enrolled' AND p.active AND i.enabled AND i.confirmed AND i.corp_id=s.corp_id`,[versionId]);
  if(!owner.rowCount)throw new Denied(409,'版本负责人尚未确认或身份无效，自动同步暂停');
}
export function syncScheduledVersion(pool,versionId,readSource,intervalSeconds) {
  return syncVersion(pool,versionId,readSource,{actorId:scheduledActor,reason:'系统轮询：受控来源同步与对账',intervalSeconds});
}
export async function syncVersion(pool, versionId, readSource, {actorId,reason:why,intervalSeconds=900} = {}) {
  if(!Number.isInteger(intervalSeconds)||intervalSeconds<60||intervalSeconds>86400)throw new Denied(400,'同步间隔不合法');
  if (!uuid(versionId)) throw new Denied(400,'版本标识不合法'); reason(why);
  return transaction(pool,async client => {
    const locked = (await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['version:'+versionId])).rows[0].locked;
    if (!locked) throw new Denied(409,'该版本正在同步，请稍后刷新');
    await authorizeSync(client,versionId,actorId,false);
    const version = (await client.query(`SELECT v.*,p.teambition_project_id AS "projectId",p.corp_id AS "corpId" FROM managed_versions v JOIN source_projects p ON p.id=v.source_project_id WHERE v.id=$1`,[versionId])).rows[0];
    if (!version) throw new Denied(404,'版本不存在');
    if (version.lifecycle !== 'enrolled') throw new Denied(409,'该版本未处于纳入状态');
    const knownIds=(await client.query('SELECT source_task_id FROM work_items WHERE managed_version_id=$1',[versionId])).rows.map(row=>row.source_task_id);
    // Source reads can outlast the polling interval; completion and retry clocks must not use transaction now().
    const runId=randomUUID();
    const startedAt = new Date(); let snapshot,items,errorCode;
    try { snapshot = await readSource({projectId:version.projectId,sourceVersionId:version.source_version_id,corpId:version.corpId,knownTaskIds:knownIds}); }
    catch { errorCode = 'SOURCE_READ_FAILED'; }
    if (!errorCode) { try { items = validateSnapshot(snapshot);validateHistory(snapshot,items,knownIds); } catch { errorCode = 'SOURCE_STRUCTURE_INVALID'; } }
    // Recheck under the same security lock as revocation before committing any source facts.
    await authorizeSync(client,versionId,actorId);
    if (errorCode) {
      await client.query("INSERT INTO source_sync_runs(id,managed_version_id,started_at,finished_at,status,error_code,error_detail) VALUES($1,$2,$3,clock_timestamp(),'failed',$4,$5)",[runId,versionId,startedAt,errorCode,'本次同步失败，已有事实保留']);
      await client.query("UPDATE source_sync_states SET last_attempt_at=$2,last_status='failed',last_error_code=$3,last_error_detail=$4 WHERE managed_version_id=$1",[versionId,startedAt,errorCode,'本次同步失败，已有事实保留']);
      await client.query("UPDATE source_sync_states SET next_due_at=clock_timestamp()+LEAST($2,60*power(2,LEAST(failure_count,8)))::integer * interval '1 second',failure_count=failure_count+1 WHERE managed_version_id=$1",[versionId,intervalSeconds]);
      await revalidateFeedback(client);
      await audit(client,actorId,'version.sync.failed',{versionId,errorCode},why);
      return {status:'failed',errorCode,importedCount:0};
    }
    if (snapshot.binding) {
      const b = snapshot.binding;
      await client.query(`UPDATE source_projects SET config_version=config_version+1 WHERE id=$1 AND EXISTS (SELECT 1 FROM source_bindings WHERE source_project_id=$1 AND (organization_id,category_field_id,function_field_id,type_names,status_names,function_options) IS DISTINCT FROM ($2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb))`,[version.source_project_id,b.organizationId,b.categoryFieldId,b.functionFieldId,b.typeNames,b.statusNames,JSON.stringify(b.functionOptions ?? [])]);
      await client.query(`INSERT INTO source_bindings(source_project_id,organization_id,category_field_id,function_field_id,type_names,status_names,function_options) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(source_project_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,category_field_id=EXCLUDED.category_field_id,function_field_id=EXCLUDED.function_field_id,type_names=EXCLUDED.type_names,status_names=EXCLUDED.status_names,function_options=EXCLUDED.function_options,verified_at=now()`,[version.source_project_id,b.organizationId,b.categoryFieldId,b.functionFieldId,b.typeNames,b.statusNames,JSON.stringify(b.functionOptions ?? [])]);
    }
    if(snapshot.binding?.statusDefinitions)await client.query('UPDATE source_bindings SET status_definitions=$2 WHERE source_project_id=$1',[version.source_project_id,JSON.stringify(snapshot.binding.statusDefinitions)]);
    if(snapshot.binding)await client.query('UPDATE source_bindings SET unique_id_prefix=$2 WHERE source_project_id=$1',[version.source_project_id,snapshot.binding.uniqueIdPrefix??null]);
    for (const item of items) await client.query(`INSERT INTO work_items(id,managed_version_id,source_task_id,visible_key,title,type_id,type_name,category,function_name,function_resolution,parent_source_task_id,parent_missing,source_status_id,raw_status,availability,structure_issues,source_updated_at,last_synced_at,raw_source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),$18)
      ON CONFLICT(managed_version_id,source_task_id) DO UPDATE SET visible_key=EXCLUDED.visible_key,title=EXCLUDED.title,type_id=EXCLUDED.type_id,type_name=EXCLUDED.type_name,category=EXCLUDED.category,function_name=EXCLUDED.function_name,function_resolution=EXCLUDED.function_resolution,parent_source_task_id=EXCLUDED.parent_source_task_id,parent_missing=EXCLUDED.parent_missing,source_status_id=EXCLUDED.source_status_id,raw_status=EXCLUDED.raw_status,availability=EXCLUDED.availability,structure_issues=EXCLUDED.structure_issues,source_updated_at=EXCLUDED.source_updated_at,last_synced_at=now(),raw_source=EXCLUDED.raw_source`,[randomUUID(),versionId,item.sourceTaskId,item.visibleKey,item.title,item.typeId,item.typeName,item.category,item.functionName,item.functionResolution,item.parentSourceTaskId,item.parentMissing,item.sourceStatusId,item.rawStatus,item.availability,JSON.stringify(item.structureIssues),item.sourceUpdatedAt,JSON.stringify(item.rawSource)]);
    await persistHistory(client,version,items,snapshot);
    await client.query("INSERT INTO source_sync_runs(id,managed_version_id,started_at,finished_at,status,imported_count) VALUES($1,$2,$3,clock_timestamp(),'succeeded',$4)",[runId,versionId,startedAt,items.length]);
    await client.query("UPDATE source_sync_states SET last_attempt_at=$2,last_success_at=clock_timestamp(),last_status='succeeded',last_error_code=NULL,last_error_detail=NULL WHERE managed_version_id=$1",[versionId,startedAt]);
    await client.query("UPDATE source_sync_states SET cursor=$2,failure_count=0,next_due_at=clock_timestamp()+$3::integer * interval '1 second' WHERE managed_version_id=$1",[versionId,runId,intervalSeconds]);
    const result = {status:'succeeded',importedCount:items.length,issueCount:items.filter(i=>i.structureIssues.length).length,...(snapshot.reconciliations?.length?{reconciledCount:snapshot.reconciliations.length}:{})};
    await revalidateFeedback(client);
    await audit(client,actorId,'version.sync.succeeded',{versionId,...result},why);
    return result;
  });
}
const fieldValue = (task, fieldId) => {
  if (!fieldId) return null;
  const field = Array.isArray(task?.customfields) ? task.customfields.find(item=>item.cfId===fieldId) : null;
  return field?.value?.[0]?.title ?? field?.value?.[0]?.value ?? null;
};
export function mapTeambitionTask(task, fieldMap = {}) {
  const typeName = fieldMap.typeNames ? fieldMap.typeNames[task?.sfcId] : task?.sfcName;
  const statusName = fieldMap.statusNames ? fieldMap.statusNames[task?.tfsId] : task?.tfsName;
  const functionName = fieldValue(task,fieldMap.function);
  return {
    executorSourceId:task?.executorId ?? null,participantSourceIds:task?.involveMembers ?? null,plannedStartAt:task?.startDate ?? null,plannedDueAt:task?.dueDate ?? null,sourceCompletedAt:task?.accomplishTime ?? null,isDone:typeof task?.isDone==='boolean'?task.isDone:null,
    sourceTaskId:task?.id,visibleKey:task?.uniqueId == null ? null : String(task.uniqueId),title:task?.content,
    typeId:task?.sfcId,typeName:typeName ?? null,category:fieldValue(task,fieldMap.category),functionName,
    parentSourceTaskId:task?.parentTaskId,sourceStatusId:task?.tfsId,status:statusName ?? task?.tfsId,
    sourceUpdatedAt:task?.updated,
    structureIssues:[
      ...(!typeName ? ['unknown_task_type'] : []),
      ...(typeName==='子需求' && !functionName ? ['missing_function'] : []),
      ...(functionName && resolveFunction(functionName).issue ? [resolveFunction(functionName).issue] : []),
      ...(!statusName ? ['unknown_status'] : []),
      ...(!Array.isArray(task?.customfields) ? ['customfields_missing'] : [])
    ],rawSource:task
  };
}
export function createTeambitionSourceReader({listTasks,projectId,versionId,fieldMap={},pageSize=100}) {
  if (typeof listTasks!=='function' || !text(projectId,100) || !text(versionId,100)) throw new Error('来源读取参数不完整');
  return async()=>{
    const items=[],cursors=new Set(),ids=new Set(); let pageToken;
    for (let pages=0;pages<100;pages++) {
      const page=await listTasks({projectId,pageSize,pageToken});
      if (!page || !Array.isArray(page.result) || (page.nextPageToken!=null && typeof page.nextPageToken!=='string')) throw new Error('来源响应结构错误');
      for (const task of page.result) {
        if (task?.projectId!==projectId || task?.sprintId!==versionId || task.isArchived!==false || !text(task.id,200) || ids.has(task.id)) throw new Error('来源范围或任务标识错误');
        ids.add(task.id); items.push(mapTeambitionTask(task,fieldMap));
      }
      pageToken=page.nextPageToken || '';
      if (!pageToken) return {items};
      if (cursors.has(pageToken) && !page.result.length) throw new Error('来源分页未前进');
      cursors.add(pageToken);
    }
    throw new Error('来源分页超过安全上限');
  };
}