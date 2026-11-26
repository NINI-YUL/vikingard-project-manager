import {revalidateFeedback} from './feedback-state.mjs';
import {digest,transaction} from './database.mjs';
import {Denied,requireRole,requireCurrentRole} from './security.mjs';
import {functions,semantics,markers,defaults,effectiveRules,validateRules,validateEffective,validDay,workingDays,dayOf,objectKind,stages,versionProgress,optimizationSummary,timing,concurrency,standardWorkIntervals} from './management-engine.mjs';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail=text=>{throw new Denied(400,text);};
const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('配置字段不合法');};
async function state(client){
  const queries=[
    'SELECT revision FROM management_state WHERE id=1','SELECT * FROM management_rules',"SELECT to_char(day,'YYYY-MM-DD') AS day,working,intervals FROM calendar_days ORDER BY day",'SELECT * FROM status_mappings',
    'SELECT v.*,s.last_success_at,s.last_status FROM managed_versions v JOIN source_sync_states s ON s.managed_version_id=v.id',
    "SELECT w.* FROM work_items w JOIN managed_versions v ON v.id=w.managed_version_id WHERE v.lifecycle='enrolled'",
    'SELECT b.source_project_id,b.status_names,b.status_definitions,p.display_name FROM source_bindings b JOIN source_projects p ON p.id=b.source_project_id','SELECT * FROM function_exemptions','SELECT * FROM plan_baselines'];
  const results=[];for(const query of queries)results.push(await client.query(query));
  const [revision,rules,calendar,mappings,versions,items,bindings,exemptions,baselines]=results;
  return {revision:revision.rows[0].revision,rules:rules.rows,calendar:Object.fromEntries(calendar.rows.map(r=>[r.day,{working:r.working,intervals:r.intervals}])),mappings:mappings.rows,versions:versions.rows,items:items.rows,bindings:bindings.rows,exemptions:exemptions.rows,baselines:baselines.rows};
}
function rulesFor(data,versionId,requirementId){return effectiveRules(['system','version','requirement'].flatMap(scope=>{const key=scope==='system'?'system':scope==='version'?versionId:requirementId;return data.rules.filter(r=>r.scope===scope&&r.scope_key===key);}));}
function mappingFor(data,projectId){return Object.fromEntries(data.mappings.filter(m=>m.source_project_id===projectId&&m.semantic).map(m=>[m.status_id,{semantic:m.semantic,markers:m.markers}]));}
function checkAllRules(data){validateEffective(rulesFor(data));for(const v of data.versions){validateEffective(rulesFor(data,v.id));for(const i of data.items.filter(i=>i.managed_version_id===v.id&&['需求','优化需求'].includes(i.type_name)))validateEffective(rulesFor(data,v.id,i.id));}}
function target(data,scope,key){if(scope==='system'&&key==='system')return null;if(scope==='version'&&uuid(key)){const v=data.versions.find(v=>v.id===key&&v.lifecycle==='enrolled');if(v)return v;}if(scope==='requirement'&&uuid(key)){const i=data.items.find(i=>i.id===key&&['需求','优化需求'].includes(i.type_name)&&i.source_presence==='current');if(i)return data.versions.find(v=>v.id===i.managed_version_id);}fail('配置对象不存在或当前不可管理');}
function impact(data,projectId,versionId,requirementId){const versions=data.versions.filter(v=>v.lifecycle==='enrolled'&&(!projectId||v.source_project_id===projectId)&&(!versionId||v.id===versionId));let items=data.items.filter(i=>versions.some(v=>v.id===i.managed_version_id));if(requirementId){const root=items.find(i=>i.id===requirementId);const ids=new Set([root.source_task_id]);let changed;do{changed=false;for(const i of items)if(ids.has(i.parent_source_task_id)&&!ids.has(i.source_task_id)){ids.add(i.source_task_id);changed=true;}}while(changed);items=items.filter(i=>ids.has(i.source_task_id));}return {versionCount:versions.length,taskCount:items.length};}
async function plan(client,data,input,actor){
  keys(input,['kind','scope','scopeKey','values','restoreKeys','projectId','requirementId','functionName','notApplicable','reason','expectedRevision','confirmed','previewToken']);
  if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)fail('请填写本次变更原因');
  let before,after,write,affected;
  if(input.kind==='rules'){
    const version=target(data,input.scope,input.scopeKey);validateRules(input.values??{},input.scope);
    if(!Array.isArray(input.restoreKeys??[])||(input.restoreKeys??[]).some(k=>!Object.hasOwn(defaults,k)))fail('恢复继承项不合法');
    if(input.scope!=='system'&&(Object.hasOwn(input.values??{},'concurrency')||(input.restoreKeys??[]).includes('concurrency')))fail('开发关注阈值仅允许系统默认修改');
    before=data.rules.find(r=>r.scope===input.scope&&r.scope_key===input.scopeKey)?.values??{};after={...before,...input.values};
    for(const key of input.restoreKeys??[])delete after[key];
    const parent=rulesFor({...data,rules:data.rules.filter(r=>!(r.scope===input.scope&&r.scope_key===input.scopeKey))},version?.id,input.scope==='requirement'?input.scopeKey:undefined);
    if(input.scope!=='system')for(const key of Object.keys(after))if(JSON.stringify(after[key])===JSON.stringify(parent[key].value))delete after[key];
    const changed={scope:input.scope,scope_key:input.scopeKey,values:after};data.rules=data.rules.filter(r=>!(r.scope===input.scope&&r.scope_key===input.scopeKey)).concat(changed);checkAllRules(data);
    affected=impact(data,null,input.scope==='version'?input.scopeKey:version?.id,input.scope==='requirement'?input.scopeKey:null);
    write=()=>client.query('INSERT INTO management_rules(scope,scope_key,values) VALUES($1,$2,$3) ON CONFLICT(scope,scope_key) DO UPDATE SET values=EXCLUDED.values',[input.scope,input.scopeKey,after]);
  }else if(input.kind==='calendar'){
    keys(input.values,['day','working','intervals']);const {day,working}=input.values;if(!validDay(day)||!(working===null||typeof working==='boolean')||!Array.isArray(input.values.intervals)||input.values.intervals.some(x=>!x||typeof x.start!=='string'||typeof x.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.end)||x.start>=x.end))fail('请填写有效日期、工作日和有效工作时段');
    before={day,...(data.calendar[day]??{working:null,intervals:null})};after={day,working,intervals:working===null?null:working===false?[]:input.values.intervals};affected=impact(data);
    write=()=>working===null?client.query('DELETE FROM calendar_days WHERE day=$1',[day]):client.query('INSERT INTO calendar_days(day,working,intervals) VALUES($1,$2,$3) ON CONFLICT(day) DO UPDATE SET working=EXCLUDED.working,intervals=EXCLUDED.intervals',[day,working,JSON.stringify(after.intervals)]);
  }else if(input.kind==='mapping'){
    const binding=data.bindings.find(b=>b.source_project_id===input.projectId);if(!binding)fail('来源项目不存在');
    if(!Array.isArray(input.values)||!input.values.length||input.values.length>500)fail('请选择需要调整的状态映射');
    const seen=new Set();for(const entry of input.values){keys(entry,['statusId','semantic','markers']);if(seen.has(entry.statusId)||!Object.hasOwn(binding.status_names,entry.statusId)||!(entry.semantic===null||Object.hasOwn(semantics,entry.semantic))||!Array.isArray(entry.markers)||new Set(entry.markers).size!==entry.markers.length||entry.markers.some(m=>!markers.includes(m))||(!entry.semantic&&entry.markers.length))fail('状态语义或计时节点不合法');seen.add(entry.statusId);for(const prefix of ['development','test'])if(entry.markers.includes(prefix+'_start')&&entry.markers.includes(prefix+'_end'))fail('同一状态不能同时开始和结束同一计时阶段');}
    before=data.mappings.filter(m=>m.source_project_id===input.projectId&&seen.has(m.status_id));after=input.values;affected=impact(data,input.projectId);
    write=async()=>{for(const m of after)await client.query("INSERT INTO status_mappings(source_project_id,status_id,semantic,markers) VALUES($1,$2,$3,$4) ON CONFLICT(source_project_id,status_id) DO UPDATE SET semantic=EXCLUDED.semantic,markers=EXCLUDED.markers,updated_at=now(),recovery='pending'",[input.projectId,m.statusId,m.semantic,JSON.stringify(m.markers)]);};
  }else if(input.kind==='baseline'){
    const version=target(data,'version',input.scopeKey);if(version.owner_id!==actor.id)throw new Denied(403,'首次计划须由已确认的版本负责人本人核对证据');
    before=data.baselines.filter(b=>data.items.some(i=>i.id===b.work_item_id&&i.managed_version_id===version.id));
    after=data.items.filter(i=>i.managed_version_id===version.id&&i.source_presence==='current'&&!data.baselines.some(b=>b.work_item_id===i.id)).map(i=>({workItemId:i.id,title:i.title,plannedStartAt:i.planned_start_at,plannedDueAt:i.planned_due_at,sourceSyncedAt:i.last_synced_at}));
    if(!after.length)fail('当前没有尚待确认的首次计划；已有基线不可覆盖');affected=impact(data,null,version.id);
    write=async()=>{for(const item of after)await client.query('INSERT INTO plan_baselines(work_item_id,planned_start_at,planned_due_at,confirmed_by,evidence,source_synced_at) VALUES($1,$2,$3,$4,$5,$6)',[item.workItemId,item.plannedStartAt,item.plannedDueAt,actor.id,input.reason,item.sourceSyncedAt]);};
  }else if(input.kind==='exemption'){

    const root=data.items.find(i=>i.id===input.requirementId&&i.type_name==='需求'&&i.source_presence==='current');if(!root||!functions.includes(input.functionName)||typeof input.notApplicable!=='boolean')fail('职能确认对象不合法');
    const v=data.versions.find(v=>v.id===root.managed_version_id);if(v.owner_id!==actor.id)throw new Denied(403,'须由已确认的版本负责人本人确认不适用；系统权限不能代替业务确认');
    const existing=data.items.some(i=>i.managed_version_id===root.managed_version_id&&i.parent_source_task_id===root.source_task_id&&i.type_name==='子需求'&&i.function_name===input.functionName);
    if(input.notApplicable&&existing)fail('该职能已有当前或历史工单，不能用不适用隐藏来源缺失或未完成事项');
    before=data.exemptions.find(e=>e.requirement_id===root.id&&e.function_name===input.functionName)??null;after={requirementId:root.id,functionName:input.functionName,notApplicable:input.notApplicable,confirmedBy:actor.id};affected=impact(data,null,v.id,root.id);
    write=()=>client.query('INSERT INTO function_exemptions(requirement_id,function_name,confirmed_by,applicable) VALUES($1,$2,$3,$4) ON CONFLICT(requirement_id,function_name) DO UPDATE SET confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now(),applicable=EXCLUDED.applicable',[root.id,input.functionName,actor.id,!input.notApplicable]);
  }else fail('未知管理操作');
  return {before,after,affected,write};
}
export async function changeManagement(pool,actor,input,save=false){
  requireRole(actor,'admin');return transaction(pool,async client=>{
    await requireCurrentRole(client,actor.id,'admin');await client.query('SELECT revision FROM management_state WHERE id=1 FOR UPDATE');const data=await state(client);
    if(save&&(input.confirmed!==true||input.expectedRevision!==data.revision))throw new Denied(409,'配置已变化或尚未复核，请重新预览影响后保存');
    const {expectedRevision,confirmed,previewToken,...change}=input;
    const token=digest(JSON.stringify({revision:data.revision,change,versions:data.versions.map(v=>[v.id,v.lifecycle,v.owner_id]).sort(),items:data.items.map(i=>[i.id,i.source_updated_at,i.last_synced_at,i.source_presence]).sort()}));
    if(save&&previewToken!==token)throw new Denied(409,'来源或配置已变化，请重新预览影响后保存');
    let result;try{result=await plan(client,data,input,actor);}catch(error){if(error instanceof Denied)throw error;throw new Denied(400,error.message);}
    if(!save)return {revision:data.revision,previewToken:token,before:result.before,after:result.after,affected:result.affected};
    await result.write();await revalidateFeedback(client);await client.query('UPDATE management_state SET revision=revision+1 WHERE id=1');
    await client.query('INSERT INTO audit_events(actor_id,action,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5)',[actor.id,'management.'+input.kind+'.saved',result.before,{...result.affected,value:result.after,scope:input.scope,scopeKey:input.scopeKey,projectId:input.projectId},input.reason.trim()]);
    return {saved:true,revision:data.revision+1,affected:result.affected,mappingRecovery:input.kind==='mapping'?'pending':undefined};
  });
}
async function readSnapshot(pool,read){return transaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return read(client);});}
export async function managementCatalog(pool){return readSnapshot(pool,async client=>{const data=await state(client);return {revision:data.revision,functions,semantics,markers,defaults,rules:data.rules,calendar:data.calendar,mappings:data.mappings,projects:data.bindings.map(b=>({id:b.source_project_id,functionOptions:b.function_options,name:b.display_name,statuses:Object.entries(b.status_names).map(([id,name])=>({id,name,usedCount:data.items.filter(i=>i.source_status_id===id&&i.source_presence==='current'&&data.versions.some(v=>v.id===i.managed_version_id&&v.source_project_id===b.source_project_id)).length,workflowId:b.status_definitions.find(d=>d.id===id)?.workflowId??'待重新读取来源',workflowName:b.status_definitions.find(d=>d.id===id)?.workflowName??null}))})),versions:data.versions.map(v=>({id:v.id,name:v.display_name,ownerId:v.owner_id,lifecycle:v.lifecycle})),requirements:data.items.filter(i=>['需求','优化需求'].includes(i.type_name)).map(i=>({id:i.id,versionId:i.managed_version_id,name:i.title,type:i.type_name}))};});}
export async function managementResults(pool,versionId,now=new Date()){return readSnapshot(pool,async client=>{
  if(!uuid(versionId))fail('版本标识不合法');const data=await state(client),version=data.versions.find(v=>v.id===versionId&&v.lifecycle==='enrolled');if(!version)throw new Denied(404,'活跃版本不存在');
  const items=data.items.filter(i=>i.managed_version_id===versionId),bySource=new Map(items.map(i=>[i.source_task_id,i])),mappings=mappingFor(data,version.source_project_id);
  const executorNames=new Map((await client.query('SELECT e.executor_source_id,p.display_name FROM executor_identity_mappings e JOIN people p ON p.id=e.person_id WHERE e.source_project_id=$1 AND e.enabled AND p.active',[version.source_project_id])).rows.map(row=>[row.executor_source_id,row.display_name]));
  const histories=(await client.query('SELECT source_task_id,source_activity_id,source_updated_at,fetched_at,raw_source FROM source_activities WHERE source_project_id=$1 ORDER BY source_updated_at NULLS FIRST,fetched_at,revision_hash',[version.source_project_id])).rows;
  const latest=new Map();for(const h of histories)latest.set(h.source_task_id+':'+h.source_activity_id,h);
  const events=new Map();for(const h of latest.values()){const a=h.raw_source;if(a.action!=='update.taskflowstatus')continue;let content;try{content=typeof a.content==='string'?JSON.parse(a.content):a.content;}catch{continue;}if(typeof content?.tfsId!=='string')continue;if(!events.has(h.source_task_id))events.set(h.source_task_id,[]);events.get(h.source_task_id).push({at:a.createTime,statusId:content.tfsId,fromStatusId:content.oldTfsId});}
  const requirements=items.filter(i=>objectKind(i,bySource)==='requirement').map(root=>{const rules=rulesFor(data,version.id,root.id);return {id:root.id,title:root.title,rules,stages:stages(root,items,rules,mappings,data.exemptions.filter(e=>e.requirement_id===root.id&&!e.applicable).map(e=>e.function_name))};});
  const facts=items.map(item=>{const mapping=mappings[item.source_status_id],kind=objectKind(item,bySource),issues=[];if(!mapping)issues.push('状态未映射，完成、计时、风险及通知判断暂停');if(item.source_presence!=='current')issues.push('来源当前不可读或不在范围，保留事实并暂停判断');if(kind==='unknown')issues.push('结构不能识别');if(kind==='professional'&&(item.function_resolution!=='confirmed'||!functions.includes(item.function_name)))issues.push(item.function_resolution==='legacy_unresolved'?'旧职能值待配置':'职能待配置');
    let planDays=null,due=null;const start=dayOf(item.planned_start_at),end=dayOf(item.planned_due_at);if(kind==='professional'&&(!start||!end))issues.push('核心专业子单计划时间缺失');
    if(start&&end){if(start>end)issues.push('计划截止早于开始');else try{planDays=workingDays(start,end,data.calendar);}catch{issues.push('计划跨度超过当前计算上限');}}
    if(mapping&&item.source_presence==='current'&&!['delivered','non_delivery'].includes(mapping.semantic)&&end){try{const today=dayOf(now);if(end<today)due={overdue:true,workingDays:workingDays(end,today,data.calendar)-workingDays(end,end,data.calendar)};else {const workingDaysUntil=workingDays(today,end,data.calendar)-workingDays(today,today,data.calendar);due={overdue:false,dueSoon:workingDaysUntil<=3,workingDaysUntil,deadlineDate:end,today};}}catch{issues.push('日期范围异常，到期判断暂停');}}

    let times;try{times=timing((events.get(item.source_task_id)??[]).sort((a,b)=>new Date(a.at)-new Date(b.at)),mappings,{syncStartAt:version.sync_start_at,now,calendar:data.calendar});}catch{times={development:{workingDays:null,unknown:true,rounds:[]},test:{workingDays:null,unknown:true,rounds:[]}};}
    const lastEvent=(events.get(item.source_task_id)??[]).sort((a,b)=>new Date(a.at)-new Date(b.at)).at(-1);
    if(!mapping||item.source_presence!=='current'||(lastEvent&&lastEvent.statusId!==item.source_status_id))times={development:{workingDays:null,unknown:true,rounds:[]},test:{workingDays:null,unknown:true,rounds:[]}};
    return {id:item.id,sourceTaskId:item.source_task_id,parentSourceTaskId:item.parent_source_task_id,key:item.visible_key,title:item.title,typeName:item.type_name,kind,requirementTitle:kind==='professional'?bySource.get(item.parent_source_task_id)?.title??null:null,executorSourceId:item.executor_source_id,executorName:executorNames.get(item.executor_source_id)??null,plannedStartAt:item.planned_start_at,plannedDueAt:item.planned_due_at,functionName:item.function_name,functionResolution:item.function_resolution,rawStatus:item.raw_status,semantic:mapping?.semantic??null,markers:mapping?.markers??[],issues,planWorkingDays:planDays,baseline:data.baselines.find(b=>b.work_item_id===item.id)??null,due,timing:times};});
  const system=rulesFor(data);let concurrent;try{concurrent=concurrency(data.items,system.concurrency.value,data.calendar);}catch{concurrent={threshold:system.concurrency.value,attention:[],unknown:true,reason:'存在超长计划范围，需先核对日期'};}
  const optimizations=optimizationSummary(items,mappings);
  return {calendar:data.calendar,progress:versionProgress(requirements,optimizations),revision:data.revision,versionId,sourceSnapshotAt:version.last_success_at,sourceSyncStatus:version.last_status,rules:rulesFor(data,versionId),requirements,items:facts,optimizations,concurrency:concurrent,calculatedAt:now,notice:'状态时间来自可核对的来源动态；观察时间和计划时间不作为实际计时起点。'};
});}

export async function verifyMappings(pool,actor,input){
  requireRole(actor,'admin');if(!uuid(input.projectId)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)fail('请核对项目并填写验证原因');
  return transaction(pool,async client=>{await requireCurrentRole(client,actor.id,'admin');await client.query('SELECT revision FROM management_state WHERE id=1 FOR UPDATE');const data=await state(client),maps=mappingFor(data,input.projectId),versions=data.versions.filter(v=>v.source_project_id===input.projectId&&v.lifecycle==='enrolled');if(!versions.length)fail('项目没有活跃版本');
    const latest=data.mappings.filter(m=>m.source_project_id===input.projectId).reduce((date,m)=>Math.max(date,new Date(m.updated_at).getTime()),0);const reread=versions.every(v=>v.last_success_at&&new Date(v.last_success_at).getTime()>=latest);
    const blockers=data.items.filter(i=>versions.some(v=>v.id===i.managed_version_id)&&(!maps[i.source_status_id]||i.source_presence!=='current'||i.structure_issues.length));const verified=reread&&blockers.length===0;
    if(verified)await client.query("UPDATE status_mappings SET recovery='verified' WHERE source_project_id=$1 AND semantic IS NOT NULL",[input.projectId]);
    await revalidateFeedback(client);await client.query('UPDATE management_state SET revision=revision+1 WHERE id=1');await client.query('INSERT INTO audit_events(actor_id,action,after_value,reason) VALUES($1,$2,$3,$4)',[actor.id,'management.mapping.verification',{projectId:input.projectId,verified,reread,blockedTaskCount:blockers.length},input.reason]);return {verified,reread,blockedTaskCount:blockers.length};
  });
}
