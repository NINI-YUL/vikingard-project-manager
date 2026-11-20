import {randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
import {Denied,requireCurrentRole} from './security.mjs';
import {persistFeedback,revalidateFeedback} from './feedback-state.mjs';
import {syncVersion} from './version-source.mjs';
import {parseEnvFile} from '../scripts/dingtalk-progress-form-link.mjs';
import {readRawFeedback} from '../scripts/dingtalk-feedback-readonly-check.mjs';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
export async function configureFeedback(pool,actor,input,allowedProjectIds) {
  if(!input||input.confirmed!==true||!text(input.reason,500)||!uuid(input.projectId)||!['source','executor'].includes(input.kind))throw new Denied(400,'请核对反馈来源或执行者映射并明确确认');
  const allowed=input.kind==='source'?['kind','projectId','baseId','sheetId','enabled','confirmed','reason']:['kind','projectId','executorId','personId','enabled','confirmed','reason'];
  if(Object.keys(input).some(k=>!allowed.includes(k))||typeof input.enabled!=='boolean')throw new Denied(400,'反馈配置字段不合法');
  if(input.kind==='source'&&(!text(input.baseId)||!text(input.sheetId)))throw new Denied(400,'需要明确 AI 表格和数据表 ID');
  if(input.kind==='executor'&&(!text(input.executorId)||!uuid(input.personId)))throw new Denied(400,'需要明确执行者稳定 ID 和已确认人员');
  return transaction(pool,async client=>{
    await requireCurrentRole(client,actor.id,'admin');
    const project=(await client.query('SELECT * FROM source_projects WHERE id=$1',[input.projectId])).rows[0];
    if(!project||!allowedProjectIds.includes(project.teambition_project_id))throw new Denied(400,'项目不在已批准来源范围');
    let before,after;
    if(input.kind==='source') {
      before=(await client.query('SELECT * FROM feedback_sources WHERE base_id=$1 AND sheet_id=$2',[input.baseId,input.sheetId])).rows[0];
      if(before&&before.source_project_id!==project.id)throw new Denied(409,'该表已绑定其他项目，不能改绑');
      after=(await client.query(`INSERT INTO feedback_sources(id,source_project_id,base_id,sheet_id,confirmed_by,enabled) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(base_id,sheet_id) DO UPDATE SET enabled=EXCLUDED.enabled,confirmed_by=EXCLUDED.confirmed_by RETURNING id,base_id,sheet_id,confirmed_at,enabled`,[randomUUID(),project.id,input.baseId,input.sheetId,actor.id,input.enabled])).rows[0];
    } else {
      const person=(await client.query('SELECT p.id FROM people p JOIN identity_mappings i ON i.person_id=p.id WHERE p.id=$1 AND p.active AND i.enabled AND i.confirmed AND i.corp_id=$2',[input.personId,project.corp_id])).rows[0];
      if(!person)throw new Denied(400,'人员身份未确认、停用或企业不匹配');
      if(!(await client.query('SELECT 1 FROM work_items w JOIN managed_versions v ON v.id=w.managed_version_id WHERE v.source_project_id=$1 AND w.executor_source_id=$2',[project.id,input.executorId])).rowCount)throw new Denied(400,'该执行者不在当前已同步范围');
      before=(await client.query('SELECT person_id,enabled FROM executor_identity_mappings WHERE source_project_id=$1 AND executor_source_id=$2',[project.id,input.executorId])).rows[0];
      if((await client.query('SELECT 1 FROM executor_identity_mappings WHERE source_project_id=$1 AND person_id=$2 AND executor_source_id<>$3',[project.id,input.personId,input.executorId])).rowCount)throw new Denied(409,'同一人员已关联其他执行者，请先核对身份');
      after=(await client.query(`INSERT INTO executor_identity_mappings(source_project_id,executor_source_id,person_id,confirmed_by,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_project_id,executor_source_id) DO UPDATE SET person_id=EXCLUDED.person_id,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=clock_timestamp(),enabled=EXCLUDED.enabled RETURNING executor_source_id,person_id,enabled`,[project.id,input.executorId,input.personId,actor.id,input.enabled])).rows[0];
    }
    await revalidateFeedback(client);
    await client.query('INSERT INTO audit_events(actor_id,action,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5)',[actor.id,'feedback.'+input.kind+'.confirmed',before??null,after,input.reason]);
    return {saved:true,...after};
  });
}
export async function refreshFeedback(pool,actor,{sourceId,versionId,reason},source,readRecords) {
  if(!uuid(sourceId)||!uuid(versionId)||!text(reason,500))throw new Denied(400,'需要明确来源、版本及读取原因');
  return transaction(pool,async client=>{
    const locked=(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['feedback-import:'+sourceId])).rows[0].locked;
    if(!locked)throw new Denied(409,'该反馈来源正在读取，请稍后核对结果');
    await requireCurrentRole(client,actor.id,'admin',false);
    const target=(await client.query(`SELECT f.*,v.source_version_id,p.teambition_project_id,p.corp_id FROM feedback_sources f JOIN managed_versions v ON v.source_project_id=f.source_project_id JOIN source_projects p ON p.id=v.source_project_id WHERE f.id=$1 AND v.id=$2 AND f.enabled AND v.lifecycle='enrolled'`,[sourceId,versionId])).rows[0];
    if(!target||!source||!readRecords)throw new Denied(409,'反馈来源或受控版本尚未配置');
    const records=await readRecords({baseId:target.base_id,sheetId:target.sheet_id});
    // Re-read TB after the platform records. Only current source facts can validate formal feedback.
    const synced=await syncVersion(pool,versionId,binding=>{
      if(binding.corpId!==target.corp_id||binding.projectId!==target.teambition_project_id)throw new Error('来源范围不匹配');
      return source.read(binding);
    },{actorId:actor.id,reason:'反馈入库前重新核对当前 Teambition 事实'});
    if(synced.status!=='succeeded')throw new Denied(409,'当前任务来源读取失败，未导入本轮反馈');
    await requireCurrentRole(client,actor.id,'admin');
    const current=(await client.query('SELECT * FROM feedback_sources WHERE id=$1',[sourceId])).rows[0];
    if(!current?.enabled)throw new Denied(409,'反馈来源已停用，未导入');
    const result=await persistFeedback(client,current,records);
    await client.query('INSERT INTO audit_events(actor_id,action,after_value,reason) VALUES($1,$2,$3,$4)',[actor.id,'feedback.read',{sourceId,versionId,...result},reason]);
    return result;
  });
}
export function createFeedbackReader(config) {
  return async table=>{
    try {return await readRawFeedback(parseEnvFile(config.dingtalk.envPath),table);}
    catch {throw new Denied(503,'钉钉反馈读取未完成；未导入本轮记录，请核对来源、授权和分页');}
  };
}
export async function feedbackOverview(pool,actor,versionId,offset=0) {
  if(!uuid(versionId)||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new Denied(400,'反馈查询参数不合法');
  return transaction(pool,async client=>{
    await requireCurrentRole(client,actor.id,'viewer');
    const version=(await client.query('SELECT source_project_id FROM managed_versions WHERE id=$1',[versionId])).rows[0];
    if(!version)throw new Denied(404,'版本不存在');
    await revalidateFeedback(client,versionId);
    const items=(await client.query(`SELECT w.id,w.source_task_id AS "sourceTaskId",w.visible_key AS "visibleKey",w.title,c.state,c.reasons,h.progress_percent AS "progressPercent",h.submitted_at AS "submittedAt",h.situation,h.note FROM work_items w LEFT JOIN current_feedback c ON c.work_item_id=w.id LEFT JOIN valid_feedback_history h ON h.id=c.history_id WHERE w.managed_version_id=$1 ORDER BY w.source_task_id LIMIT 100 OFFSET $2`,[versionId,offset])).rows;
    const total=(await client.query('SELECT count(*)::int AS n FROM work_items WHERE managed_version_id=$1',[versionId])).rows[0].n;
    const validations=(await client.query(`SELECT r.source_record_id AS "recordId",COALESCE(w.title,v.raw_source->'fields'->>'任务','未知任务') AS "taskTitle",w.visible_key AS "taskNumber",v.revision_hash AS "revisionHash",v.observed_at AS "observedAt",f.id AS "validationId",EXISTS(SELECT 1 FROM feedback_reviews WHERE validation_id=f.id) AS approved,v.raw_source->'fields'->'当前情况'->>'name' AS situation,f.verdict,f.reasons,f.progress_percent AS "progressPercent",r.created_time AS "platformCreatedTime" FROM feedback_records r JOIN feedback_sources s ON s.id=r.source_id JOIN feedback_revisions v ON v.record_id=r.id LEFT JOIN work_items w ON w.id=r.work_item_id LEFT JOIN LATERAL(SELECT * FROM feedback_validations f WHERE f.revision_id=v.id ORDER BY (f.id=r.current_validation_id) DESC,checked_at DESC,id DESC LIMIT 1) f ON true WHERE s.source_project_id=$1 ORDER BY v.observed_at DESC,v.id LIMIT 100 OFFSET $2`,[version.source_project_id,offset])).rows;
    const history=(await client.query(`SELECT h.id,w.source_task_id AS "sourceTaskId",h.progress_percent AS "progressPercent",h.submitted_at AS "submittedAt",h.recorded_at AS "recordedAt",h.situation,h.note,p.display_name AS "submitterName" FROM valid_feedback_history h JOIN work_items w ON w.id=h.work_item_id JOIN people p ON p.id=h.submitter_id WHERE w.managed_version_id=$1 ORDER BY h.submitted_at DESC,h.id LIMIT 100 OFFSET $2`,[versionId,offset])).rows;
    const validationTotal=(await client.query('SELECT count(*)::int AS n FROM feedback_revisions r JOIN feedback_records f ON f.id=r.record_id JOIN feedback_sources s ON s.id=f.source_id WHERE s.source_project_id=$1',[version.source_project_id])).rows[0].n;
    const historyTotal=(await client.query('SELECT count(*)::int AS n FROM valid_feedback_history h JOIN work_items w ON w.id=h.work_item_id WHERE w.managed_version_id=$1',[versionId])).rows[0].n;
    const pendingReviews=(await client.query(`SELECT DISTINCT ON (w.id) w.id AS "workItemId",w.title AS "taskTitle",f.id AS "validationId",f.progress_percent AS "progressPercent",f.reasons,r.created_time AS "platformCreatedTime" FROM feedback_records r JOIN feedback_revisions v ON v.id=r.latest_revision_id JOIN feedback_validations f ON f.id=r.current_validation_id JOIN work_items w ON w.id=r.work_item_id WHERE w.managed_version_id=$1 AND r.source_present AND f.verdict='review' AND v.raw_source->'fields'->'当前情况'->>'name'='存在风险' AND NOT EXISTS(SELECT 1 FROM feedback_reviews WHERE validation_id=f.id) ORDER BY w.id,r.created_time DESC,r.source_record_id`,[versionId])).rows;
    const result={pendingReviews,items,total,validationTotal,historyTotal,nextOffset:offset+100<Math.max(total,validationTotal,historyTotal)?offset+100:null,validations,history};
    const currentRole=(await client.query('SELECT role FROM access_grants WHERE person_id=$1',[actor.id])).rows[0]?.role;
    if(['admin','owner'].includes(currentRole)) {
      result.sources=(await client.query('SELECT id,base_id AS "baseId",sheet_id AS "sheetId",confirmed_at AS "confirmedAt",enabled FROM feedback_sources WHERE source_project_id=$1',[version.source_project_id])).rows;
      result.projectId=version.source_project_id;
      result.people=(await client.query('SELECT p.id,p.display_name AS name FROM people p JOIN identity_mappings i ON i.person_id=p.id WHERE p.active AND i.enabled AND i.confirmed AND i.corp_id=(SELECT corp_id FROM source_projects WHERE id=$1)',[version.source_project_id])).rows;
      result.executors=(await client.query(`SELECT DISTINCT w.executor_source_id AS id,p.display_name AS name,e.person_id AS "personId",e.enabled FROM work_items w JOIN managed_versions v ON v.id=w.managed_version_id LEFT JOIN executor_identity_mappings e ON e.source_project_id=v.source_project_id AND e.executor_source_id=w.executor_source_id LEFT JOIN people p ON p.id=e.person_id WHERE v.id=$1 AND w.executor_source_id IS NOT NULL`,[versionId])).rows;
    }
    return result;
  });
}

export async function approveFeedbackReview(pool,actor,input) {
  if(!input||Object.keys(input).some(k=>!['validationId','confirmed','reason'].includes(k))||!uuid(input.validationId)||input.confirmed!==true||!text(input.reason,500))throw new Denied(400,'需要明确待复核记录及复核依据');
  return transaction(pool,async client=>{
    await requireCurrentRole(client,actor.id,'admin');await revalidateFeedback(client);
    const row=(await client.query("SELECT f.id FROM feedback_validations f JOIN feedback_records r ON r.latest_revision_id=f.revision_id JOIN feedback_revisions v ON v.id=f.revision_id WHERE v.raw_source->'fields'->'当前情况'->>'name' = '存在风险' AND f.id=$1 AND f.verdict='review' AND r.current_validation_id=f.id",[input.validationId])).rows[0];
    if(!row)throw new Denied(409,'该复核结果已变化或不可人工放行，请重新读取');
    await client.query('INSERT INTO feedback_reviews(validation_id,approved_by,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,actor.id,input.reason]);
    await revalidateFeedback(client);
    await client.query('INSERT INTO audit_events(actor_id,action,after_value,reason) VALUES($1,$2,$3,$4)',[actor.id,'feedback.review.approved',{validationId:row.id},input.reason]);
    return {saved:true};
  });
}
