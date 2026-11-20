import {randomUUID} from 'node:crypto';
import {digest} from './database.mjs';
import {canonical} from './source-history.mjs';
import {objectKind,terminal} from './management-engine.mjs';
import {functions} from './function-catalog.mjs';
import {validateFeedback} from '../scripts/dingtalk-feedback-readonly-check.mjs';

const hash=value=>digest(JSON.stringify(canonical(value)));
const milliseconds=value=>value == null ? null : new Date(value).getTime();
export function evaluateFeedback(record,raw,context) {
  const {task,items,version,sync,prefix,mapping,source,periods,status}=context;
  const reasons=[];
  if(!record.source_present)reasons.push('原始来源记录当前缺失，待复核');
  if(!task)reasons.push('任务编号未唯一关联受控范围内的稳定任务');
  if(!source.enabled)reasons.push('反馈来源已停用');
  if(!Number.isSafeInteger(record.created_time)||record.created_time<=0||raw.createdTime!==record.created_time)reasons.push('平台创建时间缺失或原记录创建时间发生变化');
  if(raw.createdBy?.unionId!==record.created_by_union_id)reasons.push('平台创建人发生变化');
  if(record.created_time>Date.now())reasons.push('平台创建时间晚于本次读取');
  if(task) {
    const bySource=new Map(items.filter(i=>i.managed_version_id===task.managed_version_id).map(i=>[i.source_task_id,i]));
    const parent=bySource.get(task.parent_source_task_id);
    if(version?.lifecycle!=='enrolled'||!version.owner_id)reasons.push('版本未活跃或负责人未确认');
    if(sync?.last_status!=='succeeded')reasons.push('当前来源读取未成功，反馈资格待重新核对');
    if(!periods.some(p=>p.managed_version_id===version?.id&&!p.ended_at&&record.created_time>=milliseconds(p.started_at)))reasons.push('提交不在当前已确认跟踪区间');
    if(objectKind(task,bySource)!=='professional'||!functions.includes(task.function_name)||task.function_resolution!=='confirmed')reasons.push('不属于已确认职能的核心专业子单');
    if(task.source_presence!=='current'||task.availability!=='available'||task.structure_issues.length||parent?.source_presence!=='current'||parent?.structure_issues.length)reasons.push('任务或父需求来源结构待核对');
    if(!status||status.recovery!=='verified'||!status.semantic||terminal(status.semantic))reasons.push('任务状态未确认、映射待恢复验证或已终态');
    if(task.source_is_done!==false||task.raw_source.isArchived!==false)reasons.push('任务完成或归档状态不允许反馈');
    if(task.raw_source.id!==task.source_task_id||task.raw_source.projectId!==version?.teambition_project_id||(!Number.isSafeInteger(task.raw_source.uniqueId)||task.raw_source.uniqueId<=0)||String(task.raw_source.uniqueId)!==task.visible_key||!prefix)reasons.push('稳定任务身份、项目或可见编号证据不完整');
    if(!mapping?.enabled||!mapping.active||!mapping.identity_enabled||!mapping.confirmed||mapping.corp_id!==version?.corp_id)reasons.push('当前执行者的跨平台身份映射未确认或已停用');
    if(!reasons.length) {
      const result=validateFeedback([raw],{task:{projectId:version.teambition_project_id,uniqueId:task.raw_source.uniqueId,content:task.title,executorId:task.executor_source_id,isDone:task.source_is_done,isArchived:task.raw_source.isArchived},project:{id:version.teambition_project_id,uniqueIdPrefix:prefix},mapping:{confirmed:true,tbUserId:task.executor_source_id,unionId:mapping.union_id}}).results[0];
      return {verdict:result.verdict==='passes_checked_rules'?'valid':result.verdict,reasons:[...result.reasons,...result.reviews],progressPercent:result.progressPercent};
    }
  }
  return {verdict:'reject',reasons,progressPercent:null};
}
export function chooseCurrent(candidates,previous) {
  if(!candidates.length)return {historyId:null,state:'unknown',reasons:['尚无通过当前资格校验的有效反馈']};
  const latest=Math.max(...candidates.map(c=>milliseconds(c.submitted_at)));
  const tied=candidates.filter(c=>milliseconds(c.submitted_at)===latest);
  if(new Set(tied.map(c=>c.contentHash)).size>1) {
    const retained=candidates.find(c=>c.id===previous?.history_id);
    return {historyId:retained?.id??null,state:'review',reasons:['平台创建时间完全相同且内容冲突，保留上次仍有效的确定值，待复核']};
  }
  const selected=tied.find(c=>c.id===previous?.history_id)??tied.sort((a,b)=>a.recordId.localeCompare(b.recordId))[0];
  return {historyId:selected.id,state:'valid',reasons:[]};
}

// Call only inside the writer transaction, after acquiring security_state. All writers share this lock order.
export async function revalidateFeedback(client) {
  await client.query('SELECT pg_advisory_xact_lock(184112,6)');
  const items=(await client.query('SELECT * FROM work_items')).rows;
  const versions=(await client.query('SELECT v.*,p.corp_id,p.teambition_project_id FROM managed_versions v JOIN source_projects p ON p.id=v.source_project_id')).rows;
  const syncs=(await client.query('SELECT * FROM source_sync_states')).rows;
  const periods=(await client.query('SELECT * FROM tracking_periods')).rows;
  const sources=(await client.query('SELECT * FROM feedback_sources')).rows;
  const prefixes=(await client.query('SELECT source_project_id,unique_id_prefix FROM source_bindings')).rows;
  const mappings=(await client.query(`SELECT e.*,p.active,i.enabled AS identity_enabled,i.confirmed,i.corp_id,i.union_id FROM executor_identity_mappings e JOIN people p ON p.id=e.person_id JOIN identity_mappings i ON i.person_id=p.id`)).rows;
  const statuses=(await client.query('SELECT * FROM status_mappings')).rows;
  const records=(await client.query('SELECT r.*,r.created_time::double precision AS created_time,v.raw_source FROM feedback_records r JOIN feedback_revisions v ON v.id=r.latest_revision_id')).rows;
  const candidates=new Map();
  for(const record of records) {
    const raw=record.raw_source,source=sources.find(s=>s.id===record.source_id);
    const prefix=prefixes.find(p=>p.source_project_id===source.source_project_id)?.unique_id_prefix;
    let task=items.find(i=>i.id===record.work_item_id);
    if(!record.work_item_id&&prefix) {
      const matches=items.filter(i=>versions.some(v=>v.id===i.managed_version_id&&v.source_project_id===source.source_project_id)&&prefix+'-'+i.visible_key===raw.fields?.['TB工单id']);
      if(matches.length===1){task=matches[0];await client.query('UPDATE feedback_records SET work_item_id=$2 WHERE id=$1',[record.id,task.id]);}
    }
    const version=versions.find(v=>v.id===task?.managed_version_id);
    const mapping=mappings.find(m=>m.source_project_id===source.source_project_id&&m.executor_source_id===task?.executor_source_id);
    const context={task,items,version,sync:syncs.find(s=>s.managed_version_id===version?.id),prefix,mapping,source,periods,status:statuses.find(s=>s.source_project_id===source.source_project_id&&s.status_id===task?.source_status_id)};
    const evaluation=evaluateFeedback(record,raw,context);
    const {last_synced_at,presence_checked_at,...taskEvidence}=task??{};
    const parent=items.find(i=>i.managed_version_id===task?.managed_version_id&&i.source_task_id===task?.parent_source_task_id);
    const {last_synced_at:parentSync,presence_checked_at:parentCheck,...parentEvidence}=parent??{};
    const contextHash=hash({task:taskEvidence,version,syncStatus:context.sync?.last_status,mapping,source,periods,status:context.status,prefix,parent:parentEvidence,evaluation});
    let validation=(await client.query('SELECT id FROM feedback_validations WHERE revision_id=$1 AND context_hash=$2',[record.latest_revision_id,contextHash])).rows[0];
    if(!validation)validation=(await client.query('INSERT INTO feedback_validations(id,revision_id,context_hash,verdict,reasons,progress_percent) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[randomUUID(),record.latest_revision_id,contextHash,evaluation.verdict,JSON.stringify(evaluation.reasons),evaluation.progressPercent])).rows[0];
    await client.query('UPDATE feedback_records SET current_validation_id=$2 WHERE id=$1',[record.id,validation.id]);
    const approved=evaluation.verdict==='review'&&(await client.query('SELECT 1 FROM feedback_reviews WHERE validation_id=$1',[validation.id])).rowCount>0;
    if(evaluation.verdict==='valid'||approved) {
      const situation=raw.fields['当前情况'].name,note=['风险原因','预估延期时间','所需协助'].map(name=>name+'：'+(raw.fields[name]??'')).join('\n');
      await client.query('INSERT INTO valid_feedback_history(id,work_item_id,validation_id,submitted_at,progress_percent,situation,note,submitter_id,revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(revision_id) DO NOTHING',[randomUUID(),task.id,validation.id,new Date(record.created_time),evaluation.progressPercent,situation,note,mapping.person_id,record.latest_revision_id]);
      const history=(await client.query('SELECT * FROM valid_feedback_history WHERE revision_id=$1',[record.latest_revision_id])).rows[0];
      if(!candidates.has(task.id))candidates.set(task.id,[]);
      candidates.get(task.id).push({...history,recordId:record.source_record_id,contentHash:hash({progress:evaluation.progressPercent,situation,note,person:mapping.person_id})});
    }
  }
  const previous=(await client.query('SELECT * FROM current_feedback')).rows;
  for(const item of items) {
    const choice=chooseCurrent(candidates.get(item.id)??[],previous.find(p=>p.work_item_id===item.id));
    await client.query(`INSERT INTO current_feedback(work_item_id,history_id,state,reasons) VALUES($1,$2,$3,$4) ON CONFLICT(work_item_id) DO UPDATE SET history_id=EXCLUDED.history_id,state=EXCLUDED.state,reasons=EXCLUDED.reasons,checked_at=clock_timestamp()`,[item.id,choice.historyId,choice.state,JSON.stringify(choice.reasons)]);
  }
}
export async function persistFeedback(client,source,records) {
  if(!Array.isArray(records)||records.length>10000||Buffer.byteLength(JSON.stringify(records))>8*1024*1024)throw new Error('反馈读取范围不合法');
  await client.query('UPDATE feedback_records SET source_present=false WHERE source_id=$1',[source.id]);
  const ids=new Set();
  for(const raw of records) {
    if(typeof raw?.id!=='string'||!raw.id||raw.id.length>200||ids.has(raw.id))throw new Error('反馈记录标识缺失或重复');
    ids.add(raw.id);
    const created=Number.isSafeInteger(raw.createdTime)&&raw.createdTime>0?raw.createdTime:null;
    await client.query('INSERT INTO feedback_records(id,source_id,source_record_id,created_time,created_by_union_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,source_record_id) DO NOTHING',[randomUUID(),source.id,raw.id,created,raw.createdBy?.unionId??null]);
    const record=(await client.query('SELECT id FROM feedback_records WHERE source_id=$1 AND source_record_id=$2',[source.id,raw.id])).rows[0];
    const revisionHash=hash(raw);
    await client.query('INSERT INTO feedback_revisions(id,record_id,revision_hash,raw_source) VALUES($1,$2,$3,$4) ON CONFLICT(record_id,revision_hash) DO NOTHING',[randomUUID(),record.id,revisionHash,raw]);
    const revision=(await client.query('SELECT id FROM feedback_revisions WHERE record_id=$1 AND revision_hash=$2',[record.id,revisionHash])).rows[0];
    await client.query('UPDATE feedback_records SET latest_revision_id=$2,source_present=true WHERE id=$1',[record.id,revision.id]);
  }
  await revalidateFeedback(client);
  return {readCount:records.length};
}
