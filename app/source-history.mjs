import {randomUUID} from 'node:crypto';
import {digest} from './database.mjs';
export const presences = ['current','archived','out_of_scope','access_restricted','missing_unknown','deleted_confirmed'];
export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function validateHistory(snapshot,items,knownIds) {
  const current=new Set(items.map(item=>item.sourceTaskId)),seen=new Set();
  for (const entry of snapshot.reconciliations ?? []) {
    if (!entry || !knownIds.includes(entry.sourceTaskId) || current.has(entry.sourceTaskId) || seen.has(entry.sourceTaskId) || !presences.includes(entry.presence) || entry.presence==='current') throw new Error('来源对账记录不合法');
    seen.add(entry.sourceTaskId);
  }
  if (knownIds.some(id=>!current.has(id)&&!seen.has(id))) throw new Error('来源缺失任务尚未对账');
  for(const entry of snapshot.activities ?? []) {
    const a=entry?.activity;
    if (!current.has(entry?.sourceTaskId) || typeof a?.id!=='string' || !a.id || a.boundToObjectId!==entry.sourceTaskId || a.boundToObjectType!=='task' || typeof a.action!=='string' || !a.action || !Number.isFinite(Date.parse(a.createTime)) || (a.updateTime!=null && !Number.isFinite(Date.parse(a.updateTime)))) throw new Error('来源动态标识或时间不合法');
  }
}
export async function persistHistory(client,version,items,snapshot) {
  for(const r of snapshot.reconciliations ?? [])await client.query('UPDATE work_items SET source_presence=$3,presence_checked_at=now() WHERE managed_version_id=$1 AND source_task_id=$2',[version.id,r.sourceTaskId,r.presence]);
  for(const item of items) {
    await client.query(`UPDATE work_items SET source_presence='current',presence_checked_at=now(),executor_source_id=$3,participant_source_ids=$4,planned_start_at=$5,planned_due_at=$6,source_completed_at=$7,source_is_done=$8,history_status=CASE WHEN $9 THEN 'visible_read' ELSE history_status END WHERE managed_version_id=$1 AND source_task_id=$2`,[version.id,item.sourceTaskId,item.executorSourceId??null,item.participantSourceIds==null?null:JSON.stringify(item.participantSourceIds),item.plannedStartAt??null,item.plannedDueAt??null,item.sourceCompletedAt??null,item.isDone??null,Array.isArray(snapshot.activities)]);
  }
  for(const entry of snapshot.activities ?? []) {
    const a=entry.activity,hash=digest(JSON.stringify(canonical(a)));
    await client.query('INSERT INTO source_activities(source_project_id,source_task_id,source_activity_id,revision_hash,action,occurred_at,source_updated_at,raw_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[version.source_project_id,entry.sourceTaskId,a.id,hash,a.action,a.createTime,a.updateTime??null,a]);
  }
  const rows=(await client.query(`SELECT id,fact_digest,source_updated_at,title,type_id,type_name,category,function_name,parent_source_task_id,source_status_id,raw_status,source_presence,executor_source_id,participant_source_ids,planned_start_at,planned_due_at,source_completed_at,source_is_done,structure_issues FROM work_items WHERE managed_version_id=$1`,[version.id])).rows;
  for(const row of rows) {
    const {id,fact_digest,source_updated_at,...facts}=row;
    if (Array.isArray(facts.participant_source_ids)) facts.participant_source_ids.sort();
    const hash=digest(JSON.stringify(canonical(facts)));
    if(hash===fact_digest)continue;
    await client.query('INSERT INTO source_observations(id,work_item_id,source_updated_at,facts) VALUES($1,$2,$3,$4)',[randomUUID(),id,source_updated_at,facts]);
    await client.query('UPDATE work_items SET fact_digest=$2 WHERE id=$1',[id,hash]);
  }
}