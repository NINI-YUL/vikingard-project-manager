import {functions,foundationFunctions,detailFunctions} from './function-catalog.mjs';
export {functions};

export const semantics={not_started:'未开始',developing:'开发中',testing:'测试中',processing:'处理中，但不计时',paused:'暂停',delivered:'交付完成',non_delivery:'非交付终态'};
export const markers=['development_start','development_end','test_start','test_end'];
export const defaults={foundation:[...foundationFunctions],detail:[...detailFunctions],schedules:[{day:2,time:'10:00'},{day:4,time:'10:00'}],concurrency:3};
export function effectiveRules(layers){
  const result=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,{value:structuredClone(value),source:'system'}]));
  for(const {scope,values} of layers)for(const [key,value] of Object.entries(values))result[key]={value:structuredClone(value),source:scope};
  return result;
}
export function validateRules(values,scope){
  if(!values||Array.isArray(values)||typeof values!=='object')throw new Error('规则格式不合法');
  for(const [key,value] of Object.entries(values)){
    if(!Object.hasOwn(defaults,key))throw new Error('未知规则项');
    if(['foundation','detail'].includes(key)&&(!Array.isArray(value)||new Set(value).size!==value.length||value.some(f=>!functions.includes(f))))throw new Error('职能范围不合法');
    if(key==='concurrency'&&(scope!=='system'||!Number.isInteger(value)||value<1||value>100))throw new Error('开发关注阈值仅允许在系统默认设置为 1–100 的整数');
    if(key==='schedules'&&(!Array.isArray(value)||value.length<1||value.length>21||value.some(x=>!x||Object.keys(x).some(k=>!['day','time'].includes(k))||!Number.isInteger(x.day)||x.day<1||x.day>7||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time))||new Set(value.map(x=>x.day+'/'+x.time)).size!==value.length))throw new Error('采集时间须为不重复的星期与时分');
  }
}
export function validateEffective(rules){if(rules.foundation.value.some(f=>rules.detail.value.includes(f)))throw new Error('同一职能不能同时属于基础流程和细节完整');}
export function validDay(day){return typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day&&day>='1900-01-01'&&day<='2200-12-31';}
export function dayOf(value){if(!value||!Number.isFinite(new Date(value).getTime()))return null;return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function dateRange(start,end){if(!validDay(start)||!validDay(end)||start>end)throw new Error('日期范围不合法');const days=[];for(let d=new Date(start+'T00:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1)){if(days.length>=3660)throw new Error('日期范围超过十年，需分段核对');days.push(d.toISOString().slice(0,10));}return days;}
export function workingDay(day,calendar={}){if(!validDay(day))throw new Error('日期不合法');if(typeof calendar[day]==='boolean')return calendar[day];const n=new Date(day+'T00:00:00Z').getUTCDay();return n!==0&&n!==6;}
export function workingDays(start,end,calendar={}){return dateRange(start,end).filter(day=>workingDay(day,calendar)).length;}
export function collectionDue(at,schedules,calendar={}){const day=dayOf(at);if(!day||!workingDay(day,calendar))return false;const n=new Date(day+'T00:00:00Z').getUTCDay()||7;const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));return schedules.some(s=>s.day===n&&s.time===time);}
export const terminal=semantic=>semantic==='delivered'||semantic==='non_delivery';
export function objectKind(item,bySource){
  const parent=bySource.get(item.parent_source_task_id);
  if(item.type_name==='需求'&&!item.parent_source_task_id)return 'requirement';
  if(item.type_name==='优化需求总单'&&!item.parent_source_task_id)return 'optimization_container';
  if(item.type_name==='优化需求'&&parent?.type_name==='优化需求总单')return 'optimization';
  if(item.type_name==='子需求'&&parent?.type_name==='需求')return 'professional';
  if(item.type_name==='测试任务'&&parent?.type_name==='需求')return 'test';
  if(item.type_name==='缺陷'&&parent?.type_name==='测试任务')return 'defect';
  if(item.type_name==='任务'){
    if(item.category==='验收总单'&&parent?.type_name==='需求')return 'acceptance';
    if(parent?.type_name==='任务'&&parent.category==='验收总单')return 'acceptance_task';
    if(parent?.type_name==='优化需求')return 'optimization_task';
    if(parent?.type_name==='需求'&&item.category!=='验收总单')return 'auxiliary';
  }
  return 'unknown';
}
export function stages(root,items,rules,mappings,exemptions=[]){
  const bySource=new Map(items.map(i=>[i.source_task_id,i]));const children=items.filter(i=>{let parent=i.parent_source_task_id;const seen=new Set();while(parent&&!seen.has(parent)){if(parent===root.source_task_id)return true;seen.add(parent);parent=bySource.get(parent)?.parent_source_task_id;}return false;});
  const eligible=i=>i.source_presence==='current'&&objectKind(i,bySource)!=='unknown'&&!i.structure_issues?.length&&Boolean(mappings[i.source_status_id]);
  const professional=children.filter(i=>objectKind(i,bySource)==='professional');
  const unassigned=items.some(i=>i.source_presence==='current'&&i.parent_source_task_id&&!bySource.has(i.parent_source_task_id));
  const invalidStructure=[...rules.foundation.value,...rules.detail.value].some(f=>!functions.includes(f))||Boolean(root.structure_issues?.length)||unassigned||children.some(i=>objectKind(i,bySource)==='unknown'||(i.type_name==='子需求'&&!functions.includes(i.function_name)));
  const rootBlocked=root.source_presence!=='current'||!Object.hasOwn(mappings,root.source_status_id)||Boolean(root.structure_issues?.length);
  function selected(names){const missing=[],blocked=rootBlocked?[root.source_task_id]:[];let unknown=rootBlocked||invalidStructure;for(const f of names){const members=professional.filter(i=>i.function_name===f);if(!members.length){if(!exemptions.includes(f)){missing.push(f);unknown=true;}}else for(const i of members)if(!eligible(i)||!terminal(mappings[i.source_status_id]?.semantic)){blocked.push(i.source_task_id);if(!eligible(i))unknown=true;}}
    return {calculable:!unknown,complete:root.source_presence==='current'&&Boolean(mappings[root.source_status_id])&&!invalidStructure&&!missing.length&&!blocked.length,missingFunctions:missing,blockedTaskIds:blocked,structureUnknown:invalidStructure};}
  const foundation=selected(rules.foundation.value),detail=selected([...rules.foundation.value,...rules.detail.value]);
  const blocked=children.filter(i=>!eligible(i)||!terminal(mappings[i.source_status_id]?.semantic)).map(i=>i.source_task_id);if(rootBlocked)blocked.push(root.source_task_id);
  return {foundation,detail,test:{calculable:!rootBlocked&&!invalidStructure&&children.length>0&&children.every(eligible),complete:root.source_presence==='current'&&Boolean(mappings[root.source_status_id])&&!invalidStructure&&children.length>0&&!blocked.length,blockedTaskIds:blocked,empty:children.length===0},deliveredCount:children.filter(i=>eligible(i)&&mappings[i.source_status_id].semantic==='delivered').length,nonDeliveryCount:children.filter(i=>eligible(i)&&mappings[i.source_status_id].semantic==='non_delivery').length};
}
export function versionProgress(requirements,optimizations){
  const count=requirements.length;const result={coreRequirementCount:count};
  for(const key of ['foundation','detail','test']){const completed=requirements.filter(r=>r.stages[key].complete).length,unknown=requirements.filter(r=>!r.stages[key].calculable).length;result[key]={completed,unknown,total:count,percent:count>0&&unknown===0?completed/count*100:null};}
  result.optimization={total:optimizations.length,stateComplete:optimizations.filter(o=>o.stateComplete).length,unknown:optimizations.filter(o=>o.stateComplete===null).length,delivered:optimizations.filter(o=>o.delivered).length};return result;
}
export function optimizationSummary(items,mappings){
  const bySource=new Map(items.map(i=>[i.source_task_id,i]));const known=i=>i.source_presence==='current'&&objectKind(i,bySource)!=='unknown'&&!i.structure_issues?.length&&Object.hasOwn(mappings,i.source_status_id);const done=i=>known(i)?terminal(mappings[i.source_status_id].semantic):null;
  return items.filter(i=>objectKind(i,bySource)==='optimization').map(item=>{const children=items.filter(i=>i.parent_source_task_id===item.source_task_id);return {id:item.id,stateComplete:done(item),delivered:known(item)?mappings[item.source_status_id].semantic==='delivered':null,completionGate:children.length>0?children.every(known)?children.every(done):null:done(item)};});
}
export function timing(events,mappings,{syncStartAt,now=new Date(),calendar={}}){
  const rounds={development:[],test:[]};let previousStatus;
  const add=(round,end,includeEnd=true)=>{if(!round.openAt)return;for(const day of dateRange(dayOf(round.openAt),dayOf(end))){if(!includeEnd&&day===dayOf(end))continue;if(workingDay(day,calendar))round.days.add(day);}round.openAt=null;};
  for(const event of events){
    if(new Date(event.at)<new Date(syncStartAt)||new Date(event.at)>new Date(now))continue;
    const map=Object.hasOwn(mappings,event.statusId)?mappings[event.statusId]:null;
    if(previousStatus&&event.fromStatusId&&event.fromStatusId!==previousStatus)for(const list of Object.values(rounds)){const round=list.at(-1);if(round&&!round.end)round.unknown=true;}
    previousStatus=event.statusId;
    if(!map){for(const list of Object.values(rounds)){const round=list.at(-1);if(round&&!round.end){round.unknown=true;round.openAt=null;}}continue;}
    for(const stage of ['development','test']){
      const list=rounds[stage],prefix=stage==='test'?'test':'development',counts=map.semantic===(stage==='test'?'testing':'developing');let round=list.at(-1);
      if(map.markers.includes(prefix+'_start')&&(!round||round.end||round.closed)){round={start:event.at,end:null,days:new Set(),openAt:counts?event.at:null,unknown:false};list.push(round);}
      if(round&&!round.end&&!round.closed){
        if(map.markers.includes(prefix+'_end')){add(round,event.at);round.end=event.at;}
        else if(terminal(map.semantic)){round.unknown=true;round.openAt=null;round.closed=true;}
        else if(!counts)add(round,event.at,false);
        else if(!round.openAt)round.openAt=event.at;
      }else if(map.markers.includes(prefix+'_end')&&!round)list.push({start:null,end:event.at,days:new Set(),unknown:true});
    }
  }
  return Object.fromEntries(Object.entries(rounds).map(([stage,list])=>{for(const round of list)if(!round.end&&round.openAt)add(round,now);return [stage,{rounds:list.map(r=>({start:r.start,end:r.end,workingDays:r.unknown?null:r.days.size})),workingDays:list.length&&!list.some(r=>r.unknown)?list.reduce((n,r)=>n+r.days.size,0):null,unknown:!list.length||list.some(r=>r.unknown),currentWorkingDays:list.length&&!list.at(-1).unknown?list.at(-1).days.size:null,reopenCount:Math.max(0,list.length-1)}];}));
}
export function concurrency(items,threshold,calendar={}){const byVersion=new Map();for(const item of items){if(!byVersion.has(item.managed_version_id))byVersion.set(item.managed_version_id,new Map());byVersion.get(item.managed_version_id).set(item.source_task_id,item);}const actors=new Map();let excluded=0;
  for(const item of items){if(objectKind(item,byVersion.get(item.managed_version_id))!=='professional'||item.source_presence!=='current')continue;const start=dayOf(item.planned_start_at),end=dayOf(item.planned_due_at);if(!item.executor_source_id||!start||!end||start>end){excluded++;continue;}if(!actors.has(item.executor_source_id))actors.set(item.executor_source_id,new Map());const days=actors.get(item.executor_source_id);for(const day of dateRange(start,end)){if(!workingDay(day,calendar))continue;if(!days.has(day))days.set(day,[]);days.get(day).push(item.id);}}
  const attention=[];for(const [executorSourceId,days] of actors){let peak=null;for(const [day,ids] of days)if(ids.length>=threshold&&(!peak||ids.length>peak.taskIds.length))peak={day,taskIds:ids};if(peak)attention.push({executorSourceId,...peak,count:peak.taskIds.length});}return {threshold,attention,excluded,meaning:'计划区间重叠复核提示，不代表超载、实际工时或绩效'};
}
