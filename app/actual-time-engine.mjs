import {dayOf,validDay} from './management-engine.mjs';

export const actualStages=['development','test'];
export const roundKey=round=>round.anchors?.[0]??'empty';
export function actualValue(value){
  if(validDay(value))return value;
  if(typeof value!=='string'||!validDay(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|\+08:00)?$/.test(value))return null;
  const date=new Date(/Z$|\+08:00$/.test(value)?value:value+'+08:00');return Number.isFinite(date.getTime())?date.toISOString():null;
}
const sourceValue=value=>!value?null:validDay(value)?value:new Date(value).toISOString();
export const datePair=round=>({start:sourceValue(round?.start),end:sourceValue(round?.end)});
export function sameActual(a,b){
  if(a===b)return true;
  if(!a||!b)return false;
  if(validDay(a)||validDay(b))return dayOf(a)===dayOf(b);
  return new Date(a).getTime()===new Date(b).getTime();
}
export const orderedPair=pair=>!pair.start||!pair.end||(validDay(pair.start)||validDay(pair.end)?dayOf(pair.start)<=dayOf(pair.end):new Date(pair.start)<=new Date(pair.end));
const displayInstant=(value,source)=>sameActual(value,source)?source:validDay(value)?value+'T00:00:00+08:00':value;

// Source event IDs survive repeated syncs; array positions do not survive late history.
export function correctTiming(source,records){
  const result=structuredClone(source),corrections=[];
  for(const stage of actualStages){
    const original=source[stage]??{rounds:[],unknown:true,workingDays:null};
    const rounds=(original.rounds??[]).map(r=>({...r,key:roundKey(r),source:datePair(r)}));
    const matches=records.filter(c=>c.stage===stage).map(c=>{
      const candidates=rounds.map((r,index)=>({r,index})).filter(({r})=>c.anchors.some(a=>r.anchors?.includes(a)));
      const candidate=candidates[0]?.r;
      const stable=candidates.length===1&&c.anchors.every(a=>candidate.anchors?.includes(a))&&(!c.start_anchor||candidate.anchors[0]===c.start_anchor)&&(!c.end_anchor||(candidate.end&&candidate.anchors.at(-1)===c.end_anchor));
      const index=c.anchors.length===0&&rounds.length===0?-1:stable?candidates[0].index:null;
      return {c,index};
    });
    for(const match of matches){
      const {c,index}=match;
      const view={id:c.id,stage,fields:c.fields,revision:c.revision,anchors:c.anchors,lastValid:c.last_valid,conflicts:[]};
      if(index===null||matches.some(m=>m!==match&&m.index===index)){
        corrections.push({...view,pending:true,conflicts:['round'],message:'来源轮次发生变化，请重新关联轮次或恢复来源'});continue;
      }
      let round=index===-1?{start:null,end:null,hours:null,workingDays:null,anchors:[],key:'empty',source:{start:null,end:null}}:rounds[index];
      const pair={...round.source};
      for(const field of ['start','end'])if(c.fields[field]){
        const override=c.fields[field];pair[field]=override.mode==='date'?override.value:null;
        if(!sameActual(round.source[field],override.source)&&!sameActual(round.source[field],pair[field]))view.conflicts.push(field);
      }
      if(!orderedPair(pair))view.conflicts.push('range');
      const effective=orderedPair(pair)?pair:c.last_valid;
      const changed=['start','end'].some(f=>!sameActual(effective[f],round.source[f]));
      round={...round,start:displayInstant(effective.start,round.source.start),end:displayInstant(effective.end,round.source.end),correctionId:c.id,dateCorrected:true,durationUnverified:changed||round.hours===null,conflicts:view.conflicts};
      if(round.durationUnverified){round.hours=null;round.workingDays=null;}
      if(index===-1)rounds.push(round);else rounds[index]=round;
      corrections.push({...view,pending:false,key:round.key,source:round.source,effective,message:view.conflicts.length?'来源时间有变化，待核对':null});
    }
    const unverified=rounds.some(r=>r.durationUnverified);
    result[stage]={...original,rounds,...(rounds.some(r=>r.dateCorrected)?{dateCorrected:true,durationUnverified:unverified,unknown:unverified||original.unknown,...(unverified?{hours:null,workingDays:null,currentWorkingDays:null}:{})}:{})};
  }
  return {timing:result,corrections};
}
