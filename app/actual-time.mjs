import {randomUUID} from 'node:crypto';
import {digest,transaction} from './database.mjs';
import {Denied,requireRole,requireCurrentRole} from './security.mjs';
import {managementResultsFromClient} from './management.mjs';
import {validDay} from './management-engine.mjs';
import {actualStages,roundKey,datePair,orderedPair} from './actual-time-engine.mjs';

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
export async function saveActualTime(pool,actor,versionId,itemId,input){
  requireRole(actor,'admin');
  const allowed=['snapshot','stage','roundKey','correctionId','rebind','fields','resolution','reason','evidence','confirmed'];
  if(Object.keys(input).some(k=>!allowed.includes(k))||!actualStages.includes(input.stage)||input.confirmed!==true)fail('请核对修正对象并确认保存');
  for(const key of ['reason','evidence'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>2000)fail('请填写修改原因和依据（各不超过 2000 字）');
  if(input.resolution&&!['keep','restore'].includes(input.resolution))fail('核对操作不合法');
  if(!input.fields||Array.isArray(input.fields)||typeof input.fields!=='object'||Object.keys(input.fields).some(k=>!['start','end'].includes(k)))fail('时间字段不合法');
  for(const field of Object.values(input.fields))if(!field||Object.keys(field).some(k=>!['mode','value'].includes(k))||!['inherit','date','unknown'].includes(field.mode)||(field.mode==='date'&&!validDay(field.value)))fail('实际日期或处理方式不合法');
  return transaction(pool,async client=>{
    if(!uuid(versionId)||!uuid(itemId))fail('版本或工单标识不合法');
    const locked=(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['version:'+versionId])).rows[0].locked;
    if(!locked)throw new Denied(409,'该版本正在同步或保存，请稍后重新读取');
    await requireCurrentRole(client,actor.id,'admin');
    await client.query('SELECT revision FROM management_state WHERE id=1 FOR UPDATE');
    const data=await view(client,versionId,itemId),{item}=data;
    if(input.snapshot!==data.snapshot)throw new Denied(409,'来源或修正记录已变化，请重新读取并核对后保存');
    if(item.kind==='requirement')fail('核心需求汇总时间随子单计算，请修改具体工单');
    const previous=input.correctionId?data.records.find(c=>c.id===input.correctionId&&c.active):null;
    if(input.resolution&&!previous)fail('请先选择有效修正记录');
    if(input.rebind!==undefined&&typeof input.rebind!=='boolean')fail('轮次核对标记不合法');
    if(input.correctionId&&(!previous||previous.stage!==input.stage))fail('修正记录已失效，请重新读取');
    const current=item.timingCorrections.find(c=>c.id===previous?.id);
    if(current?.pending&&!input.rebind&&input.resolution!=='restore')fail('来源轮次待核对，请明确重新关联或恢复来源');
    const sourceRounds=item.sourceTiming[input.stage].rounds??[];
    const round=sourceRounds.find(r=>roundKey(r)===input.roundKey)??(sourceRounds.length===0&&input.roundKey==='empty'?{anchors:[],start:null,end:null}:null);
    if(input.resolution!=='restore'){
      if(!round)fail('目标轮次不存在，请重新读取');
      if(item.sourcePresence!=='current')fail('来源当前不可用，请先核对来源');
      if(previous&&!input.rebind&&current?.key!==roundKey(round))fail('修正不能自动切换轮次，请明确重新关联');
      const occupied=item.timing[input.stage].rounds?.find(r=>r.key===roundKey(round)&&r.correctionId&&r.correctionId!==previous?.id);
      if(occupied)fail('目标轮次已有人工修正，请先恢复重复修正的来源');
    }
    const source=datePair(round),fields=structuredClone(previous?.fields??{});
    for(const field of ['start','end']){
      const change=input.fields[field];
      if(change?.mode==='inherit'||input.resolution==='restore')delete fields[field];
      else if(change){
        const same=fields[field]?.mode===change.mode&&(change.mode!=='date'||fields[field]?.value===change.value);
        fields[field]={mode:change.mode,...(change.mode==='date'?{value:change.value}:{}),source:same?fields[field].source:source[field]};
      }
      if(fields[field]&&(input.resolution==='keep'||input.rebind))fields[field].source=source[field];
    }
    if(!previous&&!Object.keys(fields).length)fail('没有需要保存的修正');
    const effective={...source};for(const field of ['start','end'])if(fields[field])effective[field]=fields[field].mode==='date'?fields[field].value:null;
    if(!orderedPair(effective))fail('实际结束日期不能早于实际开始日期，请核对两端日期');
    const startAnchor=input.resolution==='restore'?previous.start_anchor:round.start?round.anchors?.[0]??null:null;
    const endAnchor=input.resolution==='restore'?previous.end_anchor:round.end?round.anchors?.at(-1)??null:null;
    const id=previous?.id??randomUUID(),anchors=input.resolution==='restore'?previous.anchors:round.anchors??[],active=Object.keys(fields).length>0;
    if(previous)await client.query('UPDATE actual_time_corrections SET anchors=$2,fields=$3,last_valid=$4,active=$5,revision=revision+1,updated_by=$6,updated_at=clock_timestamp(),start_anchor=$7,end_anchor=$8 WHERE id=$1',[id,JSON.stringify(anchors),JSON.stringify(fields),effective,active,actor.id,startAnchor,endAnchor]);
    else await client.query('INSERT INTO actual_time_corrections(id,managed_version_id,work_item_id,stage,anchors,fields,last_valid,updated_by,start_anchor,end_anchor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,versionId,itemId,input.stage,JSON.stringify(anchors),JSON.stringify(fields),effective,actor.id,startAnchor,endAnchor]);
    await client.query('INSERT INTO audit_events(actor_id,action,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5)',[actor.id,'actual_time.save',previous?{fields:previous.fields,anchors:previous.anchors,effective:current?.effective??previous.last_valid,source:current?.source??null}:null,{id,versionId,itemId,stage:input.stage,anchors,startAnchor,endAnchor,fields,effective,source,active,rebind:Boolean(input.rebind),resolution:input.resolution??null,evidence:input.evidence.trim()},input.reason.trim()]);
    return {saved:true,id};
  });
}

export async function refreshActualTimeCorrections(client,versionId){
  if(!(await client.query('SELECT 1 FROM actual_time_corrections WHERE managed_version_id=$1 AND active LIMIT 1',[versionId])).rowCount)return;
  const result=await managementResultsFromClient(client,versionId);
  for(const item of result.items)for(const correction of item.timingCorrections)if(!correction.pending&&!correction.conflicts.includes('range')){
    await client.query('UPDATE actual_time_corrections SET last_valid=$2 WHERE id=$1 AND last_valid IS DISTINCT FROM $2::jsonb',[correction.id,correction.effective]);
  }
}
