import {randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
import {Denied,requireCurrentRole} from './security.mjs';
import {objectKind} from './management-engine.mjs';
import {functions} from './function-catalog.mjs';
import {buildProgressFormUrl} from '../scripts/dingtalk-progress-form-link.mjs';

const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=v=>typeof v==='string'&&v.trim()!=='';
function eligible(row,bySource,mapping) {
  const parent=bySource.get(row.parent_source_task_id);
  return row.source_presence==='current'&&row.availability==='available'&&!row.structure_issues.length&&row.source_is_done===false&&objectKind(row,bySource)==='professional'&&functions.includes(row.function_name)&&row.function_resolution==='confirmed'&&parent?.source_presence==='current'&&!parent.structure_issues.length&&mapping?.enabled&&mapping.active&&mapping.identity_enabled&&mapping.confirmed;
}
export async function planNotifications(pool,actor,versionId,formBaseUrl) {
  if(!uuid(versionId)||!text(formBaseUrl))throw new Denied(400,'通知计划参数不合法');
  return transaction(pool,async client=>{
    await requireCurrentRole(client,actor.id,'admin');
    const version=(await client.query(`SELECT v.*,p.teambition_project_id,p.corp_id FROM managed_versions v JOIN source_projects p ON p.id=v.source_project_id WHERE v.id=$1`,[versionId])).rows[0];
    if(!version||version.lifecycle!=='enrolled')throw new Denied(409,'版本未处于纳入状态');
    const items=(await client.query('SELECT * FROM work_items WHERE managed_version_id=$1',[versionId])).rows,bySource=new Map(items.map(i=>[i.source_task_id,i]));
    const mappings=(await client.query(`SELECT e.executor_source_id,e.enabled,p.active,i.enabled AS identity_enabled,i.confirmed,i.union_id,e.person_id FROM executor_identity_mappings e JOIN people p ON p.id=e.person_id JOIN identity_mappings i ON i.person_id=p.id WHERE e.source_project_id=$1`,[version.source_project_id])).rows;
    const current=(await client.query('SELECT c.work_item_id,c.state FROM current_feedback c')).rows;
    const binding=(await client.query('SELECT unique_id_prefix FROM source_bindings WHERE source_project_id=$1',[version.source_project_id])).rows[0];
    if(!binding?.unique_id_prefix)throw new Denied(409,'当前项目编号前缀未确认，不能生成反馈链接');
    const currentMap=new Map(current.map(c=>[c.work_item_id,c]));let planned=0,cancelled=0;
    for(const item of items){const mapping=mappings.find(m=>m.executor_source_id===item.executor_source_id),currentValue=currentMap.get(item.id),ok=eligible(item,bySource,mapping)&&currentValue?.state!=='valid';
      const sourceKey=String(item.source_updated_at??item.last_synced_at??'unknown');
      if(ok){const url=buildProgressFormUrl(formBaseUrl,{taskId:`${binding.unique_id_prefix}-${item.visible_key}`,taskTitle:item.title});const inserted=await client.query(`INSERT INTO notification_jobs(id,work_item_id,kind,recipient_person_id,recipient_union_id,form_url,due_at,status,source_key) VALUES($1,$2,'initial',$3,$4,$5,$6,'planned',$7) ON CONFLICT(work_item_id,kind,recipient_person_id,source_key) DO NOTHING`,[randomUUID(),item.id,mapping.person_id,mapping.union_id,url,item.planned_due_at,sourceKey]);planned+=inserted.rowCount;}
      else {const result=await client.query("UPDATE notification_jobs SET status='cancelled',cancelled_at=clock_timestamp(),cancel_reason=$2 WHERE work_item_id=$1 AND status IN ('planned','unknown')",[item.id,currentValue?.state==='valid'?'已收到有效反馈':'任务或收件资格不再满足']);cancelled+=result.rowCount;}
    }
    await client.query('INSERT INTO audit_events(actor_id,action,after_value,reason) VALUES($1,$2,$3,$4)',[actor.id,'notification.plan',{versionId,planned,cancelled},'P07 本机通知计划；未发送外部消息']);
    return {planned,cancelled,sent:0,externalWrite:false};
  });
}
export async function recordNotificationAttempt(pool,actor,jobId,result,detail='') {
  if(!uuid(jobId)||!['sent','failed','unknown'].includes(result)||detail.length>500)throw new Denied(400,'通知结果不合法');
  return transaction(pool,async client=>{await requireCurrentRole(client,actor.id,'admin');const job=(await client.query('SELECT * FROM notification_jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];if(!job)throw new Denied(404,'通知任务不存在');if(job.status==='unknown'&&result!=='sent')throw new Denied(409,'未知结果任务不可自动重发');const status=result==='sent'?'sent':result==='unknown'?'unknown':'planned';await client.query('INSERT INTO notification_attempts(id,job_id,result,detail) VALUES($1,$2,$3,$4)',[randomUUID(),jobId,result,detail]);await client.query('UPDATE notification_jobs SET status=$2 WHERE id=$1',[jobId,status]);return {jobId,status};});
}
export async function notificationOverview(pool,actor,versionId) {if(!uuid(versionId))throw new Denied(400,'版本标识不合法');return transaction(pool,async client=>{await requireCurrentRole(client,actor.id,'viewer');return (await client.query(`SELECT n.id,n.work_item_id AS "workItemId",w.visible_key AS "taskNumber",w.title,n.kind,n.recipient_union_id AS "recipientUnionId",n.form_url AS "formUrl",n.due_at AS "dueAt",n.status,n.cancel_reason AS "cancelReason" FROM notification_jobs n JOIN work_items w ON w.id=n.work_item_id WHERE w.managed_version_id=$1 ORDER BY n.planned_at,n.id`,[versionId])).rows;});}

