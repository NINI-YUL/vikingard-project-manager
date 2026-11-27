import {randomUUID} from 'node:crypto';
import {digest,transaction} from './database.mjs';
import {Denied,requireRole,requireCurrentRole} from './security.mjs';
import {managementResultsFromClient} from './management.mjs';
import {actualStages,roundKey,datePair,orderedPair,actualValue,correctTiming} from './actual-time-engine.mjs';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail=message=>{throw new Denied(400,message);};
async function view(client,versionId,itemId){
  if(!uuid(versionId)||!uuid(itemId))fail('版本或工单标识不合法');
  const result=await managementResultsFromClient(client,versionId);
  const item=result.items.find(i=>i.id===itemId);
  if(!item)throw new Denied(404,'工单不在当前版本');
  const records=(await client.query('SELECT * FROM actual_time_corrections WHERE work_item_id=$1 ORDER BY created_at,id',[itemId])).rows;
  const snapshot=digest(JSON.stringify({sourceSnapshotAt:result.sourceSnapshotAt,sourceRevision:result.sourceRevision,sourceSyncStatus:result.sourceSyncStatus,revision:result.revision,status:item.rawStatus,semantic:item.semantic,presence:item.sourcePresence,rounds:actualStages.map(stage=>(item.sourceTiming[stage].rounds??[]).map(r=>({anchors:r.anchors,start:r.start,end:r.end}))),records}));
  const history=(await client.query("SELECT a.before_value,a.after_value,a.reason,a.occurred_at,p.display_name AS actor FROM audit_events a LEFT JOIN people p ON p.id=a.actor_id WHERE a.action='actual_time.save' AND a.after_value->>'itemId'=$1 ORDER BY a.id DESC",[itemId])).rows;
  return {snapshot,item,history,records};
}
export async function readActualTime(pool,actor,versionId,itemId){
  requireRole(actor,'viewer');
  return transaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const {records,...data}=await view(client,versionId,itemId);return data;});
}
const changeKeys=['stage','roundKey','correctionId','rebind','fields','resolution'];
function prepareChange(data,input){
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!changeKeys.includes(k))||!actualStages.includes(input.stage))fail('修正对象或字段不合法');
  if(input.resolution&&!['keep','restore'].includes(input.resolution))fail('核对操作不合法');
  if(input.rebind!==undefined&&typeof input.rebind!=='boolean')fail('轮次核对标记不合法');
  if(!input.fields||Array.isArray(input.fields)||typeof input.fields!=='object'||Object.keys(input.fields).some(k=>!['start','end'].includes(k)))fail('时间字段不合法');
  for(const field of Object.values(input.fields))if(!field||typeof field!=='object'||Object.keys(field).some(k=>!['mode','value'].includes(k))||!['inherit','date','unknown'].includes(field.mode)||(field.mode==='date'&&!actualValue(field.value)))fail('实际日期时间或处理方式不合法');
  const {item}=data,previous=input.correctionId?data.records.find(c=>c.id===input.correctionId&&c.active):null;
  if(input.correctionId&&(!previous||previous.stage!==input.stage))fail('修正记录已失效，请重新读取');
  if(input.resolution&&!previous)fail('请先选择有效修正记录');
  const current=item.timingCorrections.find(c=>c.id===previous?.id);
  if(current?.pending&&!input.rebind&&input.resolution!=='restore')fail('来源轮次待核对，请明确重新关联或恢复来源');
  const sourceRounds=item.sourceTiming[input.stage].rounds??[];
  const round=sourceRounds.find(r=>roundKey(r)===input.roundKey)??(sourceRounds.length===0&&input.roundKey==='empty'?{anchors:[],start:null,end:null}:null);
  if(input.resolution!=='restore'){
    if(!round)fail('目标轮次不存在，请重新读取');
    if(item.sourcePresence!=='current')fail('来源当前不可用，请先核对来源');
    if(previous&&!input.rebind&&current?.key!==roundKey(round))fail('修正不能自动切换轮次，请明确重新关联');
  }
  const source=datePair(round),fields=structuredClone(previous?.fields??{});
  for(const field of ['start','end']){
    const change=input.fields[field];
    if(change?.mode==='inherit'||input.resolution==='restore')delete fields[field];
    else if(change){
      const value=change.mode==='date'?actualValue(change.value):null;
      const same=fields[field]?.mode===change.mode&&(change.mode!=='date'||fields[field]?.value===value);
      fields[field]={mode:change.mode,...(change.mode==='date'?{value}:{}),source:same?fields[field].source:source[field]};
    }
    if(fields[field]&&(input.resolution==='keep'||input.rebind))fields[field].source=source[field];
  }
  if(!previous&&!Object.keys(fields).length)fail('没有需要保存的修正');
  const effective={...source};for(const field of ['start','end'])if(fields[field])effective[field]=fields[field].mode==='date'?fields[field].value:null;
  if(!orderedPair(effective))fail('实际结束时间不能早于实际开始时间，请核对两端时间');
  const startAnchor=input.resolution==='restore'?previous.start_anchor:round.start?round.anchors?.[0]??null:null;
  const endAnchor=input.resolution==='restore'?previous.end_anchor:round.end?round.anchors?.at(-1)??null:null;
  const anchors=input.resolution==='restore'?previous.anchors:round.anchors??[],id=previous?.id??randomUUID();
  return {input,previous,current,source,effective,record:{id,stage:input.stage,anchors,start_anchor:startAnchor,end_anchor:endAnchor,fields,last_valid:effective,active:Object.keys(fields).length>0}};
}
export async function saveActualTime(pool,actor,versionId,itemId,input){
  requireRole(actor,'admin');
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['snapshot','changes','reason','evidence','confirmed',...changeKeys].includes(k))||input.confirmed!==true)fail('请核对修正对象并确认保存');
  if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)fail('请填写修改原因（不超过 2000 字）');
  if(input.evidence!==undefined&&(typeof input.evidence!=='string'||input.evidence.length>2000))fail('依据格式不合法');
  if(input.changes!==undefined&&changeKeys.some(k=>Object.hasOwn(input,k)))fail('批量与单轮参数不能混用');
  const changes=input.changes??[Object.fromEntries(changeKeys.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]))];
  if(!Array.isArray(changes)||!changes.length||changes.length>100)fail('每次保存须包含 1–100 个轮次');
  return transaction(pool,async client=>{
    if(!uuid(versionId)||!uuid(itemId))fail('版本或工单标识不合法');
    const locked=(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['version:'+versionId])).rows[0].locked;
    if(!locked)throw new Denied(409,'该版本正在同步或保存，请稍后重新读取');
    await requireCurrentRole(client,actor.id,'admin');
    await client.query('SELECT revision FROM management_state WHERE id=1 FOR UPDATE');
    const data=await view(client,versionId,itemId),{item}=data;
    if(input.snapshot!==data.snapshot)throw new Denied(409,'来源或修正记录已变化，请重新读取并核对后保存');
    if(item.kind==='requirement')fail('核心需求汇总时间随子单计算，请修改具体工单');
    const plans=changes.map(change=>prepareChange(data,change));
    if(new Set(plans.map(p=>p.record.id)).size!==plans.length)fail('同一轮次或修正记录不能重复提交');
    const changedIds=new Set(plans.map(p=>p.record.id));
    const finalRecords=[...data.records.filter(c=>c.active&&!changedIds.has(c.id)),...plans.map(p=>p.record).filter(c=>c.active)];
    const final=correctTiming(item.sourceTiming,finalRecords);
    if(plans.some(p=>p.record.active&&final.corrections.find(c=>c.id===p.record.id)?.pending))fail('目标轮次已有人工修正或对应关系不确定，请核对后保存');
    const batchId=randomUUID();
    for(const plan of plans){
      const {record:r,previous,current,source,effective,input:change}=plan;
      if(previous)await client.query('UPDATE actual_time_corrections SET anchors=$2,fields=$3,last_valid=$4,active=$5,revision=revision+1,updated_by=$6,updated_at=clock_timestamp(),start_anchor=$7,end_anchor=$8 WHERE id=$1',[r.id,JSON.stringify(r.anchors),JSON.stringify(r.fields),effective,r.active,actor.id,r.start_anchor,r.end_anchor]);
      else await client.query('INSERT INTO actual_time_corrections(id,managed_version_id,work_item_id,stage,anchors,fields,last_valid,updated_by,start_anchor,end_anchor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[r.id,versionId,itemId,r.stage,JSON.stringify(r.anchors),JSON.stringify(r.fields),effective,actor.id,r.start_anchor,r.end_anchor]);
      await client.query('INSERT INTO audit_events(actor_id,action,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5)',[actor.id,'actual_time.save',previous?{fields:previous.fields,anchors:previous.anchors,effective:current?.effective??previous.last_valid,source:current?.source??null}:null,{id:r.id,batchId,versionId,itemId,stage:r.stage,anchors:r.anchors,startAnchor:r.start_anchor,endAnchor:r.end_anchor,fields:r.fields,effective,source,active:r.active,rebind:Boolean(change.rebind),resolution:change.resolution??null,...(input.evidence?.trim()?{evidence:input.evidence.trim()}:{})},input.reason.trim()]);
    }
    return {saved:true,id:plans[0].record.id,ids:plans.map(p=>p.record.id),count:plans.length};
  });
}

export async function refreshActualTimeCorrections(client,versionId){
  if(!(await client.query('SELECT 1 FROM actual_time_corrections WHERE managed_version_id=$1 AND active LIMIT 1',[versionId])).rowCount)return;
  const result=await managementResultsFromClient(client,versionId);
  for(const item of result.items)for(const correction of item.timingCorrections)if(!correction.pending&&!correction.conflicts.includes('range')){
    await client.query('UPDATE actual_time_corrections SET last_valid=$2 WHERE id=$1 AND last_valid IS DISTINCT FROM $2::jsonb',[correction.id,correction.effective]);
  }
}
