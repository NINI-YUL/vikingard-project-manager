import test from 'node:test';
import assert from 'node:assert/strict';
import {timing} from '../app/management-engine.mjs';
import {correctTiming,actualValue,orderedPair} from '../app/actual-time-engine.mjs';
import {actualTimelineSpan,timelineActualText} from '../app/public/shell.js';
const source=(rounds)=>({development:{rounds,unknown:rounds.some(r=>r.hours===null),hours:3,workingDays:0.4},test:{rounds:[],unknown:true}});
const round=(anchors,start,end,hours=3)=>({anchors,start,end,hours,workingDays:hours===null?null:0.4});
const correction=(fields,anchors=['s','e'])=>({id:'manual',stage:'development',anchors,fields,revision:1,last_valid:{start:'2026-11-23',end:'2026-11-26'}});
const date=(value,source)=>({mode:'date',value,source});
test('actual correction fills missing start independently, preserves raw facts and computes the confirmed workdays',()=>{
 const raw=source([round(['e'],null,'2026-11-26T02:00:00Z',null)]),before=structuredClone(raw);
 const output=correctTiming(raw,[correction({start:date('2026-11-23',null)},['e'])]);
 assert.deepEqual(raw,before);assert.equal(output.timing.development.workingDays,3.2);
 const span=actualTimelineSpan({semantic:'delivered',timing:output.timing},'2026-11-27');
 assert.equal(span.startKey,'2026-11-23');assert.equal(span.endKey,'2026-11-26');assert.equal(span.completed,true);assert.match(timelineActualText(span),/已完成 3.2 个工作日/);assert.doesNotMatch(timelineActualText(span),/历时待核实/);
 assert.equal(output.corrections[0].conflicts.length,0);
});
test('only overridden fields conflict; same source value and unrelated changes remain valid',()=>{
 const c=correction({start:date('2026-11-23',null)});
 let result=correctTiming(source([round(['s','e'],'2026-11-23','2026-11-26')]),[c]);assert.deepEqual(result.corrections[0].conflicts,[]);
 result=correctTiming(source([round(['s','e'],'2026-11-22','2026-11-27')]),[c]);
 assert.deepEqual(result.corrections[0].conflicts,['start']);assert.equal(result.timing.development.rounds[0].start,'2026-11-23T00:00:00+08:00');assert.equal(result.corrections[0].effective.end,'2026-11-27');
});
test('inverted source/manual combination retains last valid pair without drawing an inverted interval',()=>{
 const c=correction({start:date('2026-11-23',null)});
 const result=correctTiming(source([round(['s','e'],null,'2026-11-20',null)]),[c]);
 assert.ok(result.corrections[0].conflicts.includes('range'));assert.deepEqual(result.corrections[0].effective,c.last_valid);
 assert.equal(actualTimelineSpan({semantic:'developing',timing:result.timing},'2026-11-27').endKey,'2026-11-26');
});
test('reopen uses source identity, while split/merged history and unanchored rounds require explicit reassociation',()=>{
 const c=correction({start:date('2026-11-23',null)});
 const reopened=correctTiming(source([round(['s','e'],'2026-11-23','2026-11-24'),round(['s2'],'2026-11-25',null)]),[c]);
 assert.equal(reopened.timing.development.rounds[0].correctionId,c.id);assert.equal(reopened.timing.development.rounds[1].correctionId,undefined);
 const split=correctTiming(source([round(['s','extra-end'],'2026-11-21','2026-11-22'),round(['extra-start','e'],'2026-11-23','2026-11-24')]),[c]);assert.equal(split.corrections[0].pending,true);assert.ok(split.timing.development.rounds.every(r=>!r.correctionId));
 const merged=correctTiming(source([round(['s','e','s2','e2'],'2026-11-21','2026-11-24')]),[c,{...correction({end:date('2026-11-26','2026-11-24')},['s2','e2']),id:'second'}]);assert.ok(merged.corrections.every(c=>c.pending));
 const mergedFollowing=correctTiming(source([round(['s','e','later-end'],'2026-11-21','2026-11-26')]),[{...c,start_anchor:'s',end_anchor:'e'}]);assert.equal(mergedFollowing.corrections[0].pending,true);
 const mergedSingle=correctTiming(source([round(['earlier','s','e'],'2026-11-20','2026-11-24')]),[{...c,start_anchor:'s'}]);assert.equal(mergedSingle.corrections[0].pending,true);
 assert.equal(correctTiming(source([round(['new'],'2026-11-23',null)]),[correction({start:date('2026-11-23',null)},[])]).corrections[0].pending,true);
});
test('explicit unknown never substitutes plan/today; future dates save but future start never draws',()=>{
 const empty=source([]);const c=correction({start:{mode:'unknown',source:null},end:date('2026-12-02',null)},[]);
 const result=correctTiming(empty,[c]);assert.equal(result.timing.development.rounds[0].start,null);assert.equal(actualTimelineSpan({semantic:'developing',timing:result.timing},'2026-11-27').state,'unknown');
 c.fields.start=date('2026-12-01',null);const future=correctTiming(empty,[c]);assert.equal(actualTimelineSpan({semantic:'developing',timing:future.timing},'2026-11-27').state,'not_started');
});
test('stable timing anchors include pauses without altering calendar-derived source duration',()=>{
 const maps={dev:{semantic:'developing',markers:['development_start']},pause:{semantic:'paused',markers:[]},done:{semantic:'delivered',markers:['development_end']}};
 const events=[['s','2026-11-23T09:00:00+08:00','dev'],['p','2026-11-23T12:00:00+08:00','pause'],['r','2026-11-24T09:00:00+08:00','dev'],['e','2026-11-24T12:00:00+08:00','done']].map(([id,at,statusId])=>({id,at,statusId}));
 const raw=timing(events,maps,{syncStartAt:'2026-11-01',now:new Date('2026-11-27')});assert.deepEqual(raw.development.rounds[0].anchors,['s','p','r','e']);assert.equal(raw.development.hours,6);
 const output=correctTiming(raw,[correction({start:date('2026-11-23','2026-11-23')})]);assert.equal(output.timing.development.hours,6);assert.equal(output.timing.development.durationUnverified,false);
});

test('minute values use Beijing time, reject invalid clocks and compare same-day chronology',()=>{
 assert.equal(actualValue('2026-11-27T09:30'),'2026-11-27T01:30:00.000Z');
 assert.equal(actualValue('2026-11-27T09:30:00+08:00'),'2026-11-27T01:30:00.000Z');
 assert.equal(actualValue('2026-12-31T23:59'),'2026-12-31T15:59:00.000Z');
 for(const value of ['2026-02-30T10:00','2026-11-27T24:00','2026-11-27T12:60','2026-11-27T09:30-07:00'])assert.equal(actualValue(value),null);
 assert.equal(orderedPair({start:actualValue('2026-11-27T10:30'),end:actualValue('2026-11-27T10:29')}),false);
 assert.equal(orderedPair({start:actualValue('2026-11-27T10:30'),end:actualValue('2026-11-27T10:30')}),true);
});
test('minute corrections detect intraday source changes and keep old date-only corrections readable',()=>{
 const c=correction({start:date('2026-11-23T03:00:00.000Z','2026-11-23T02:00:00.000Z')});
 const result=correctTiming(source([round(['s','e'],'2026-11-23T02:30:00Z','2026-11-23T04:00:00Z')]),[c]);assert.deepEqual(result.corrections[0].conflicts,['start']);assert.equal(result.timing.development.rounds[0].start,'2026-11-23T03:00:00.000Z');assert.equal(result.timing.development.workingDays,0.2);
 const legacy=correctTiming(source([round(['s','e'],'2026-11-23T02:30:00Z','2026-11-23T04:00:00Z')]),[correction({start:date('2026-11-22','2026-11-23')})]);assert.equal(legacy.corrections[0].effective.start,'2026-11-22');assert.equal(legacy.timing.development.durationUnverified,false);assert.equal(legacy.timing.development.hours,3);
});

const clock=value=>value+'+08:00';
test('confirmed dates use company holidays, replacement shifts and inclusive legacy days without changing stored precision',()=>{
 const c=correction({start:date('2026-11-12','2026-11-18'),end:date('2026-11-16','2026-11-18')});
 const before=structuredClone(c),raw=source([round(['s','e'],'2026-11-18T02:20:00Z','2026-11-18T02:21:00Z',1/60)]);
 const calendar={'2026-11-13':false,'2026-11-14':{working:true,intervals:[{start:'10:00',end:'12:00'}]}};
 const output=correctTiming(raw,[c],{calendar});
 assert.equal(output.timing.development.hours,17);assert.equal(output.timing.development.workingDays,2.3);
 assert.equal(output.corrections[0].effective.start,'2026-11-12');assert.deepEqual(c,before);
});
test('confirmed minute intervals recalculate duration and clip known paused/processing spans to this round',()=>{
 const maps={dev:{semantic:'developing',markers:['development_start']},pause:{semantic:'paused',markers:[]},processing:{semantic:'processing',markers:[]},done:{semantic:'delivered',markers:['development_end']}};
 const events=[['s','09:00','dev'],['p','10:00','pause'],['r','11:00','dev'],['wait','14:00','processing'],['resume','15:00','dev'],['e','18:00','done'],['s2','18:01','dev'],['e2','18:02','done']].map(([id,time,statusId])=>({id,at:clock('2026-11-23T'+time),statusId}));
 const raw=timing(events,maps,{syncStartAt:'2026-11-01',now:new Date('2026-11-24')});
 assert.equal(raw.development.rounds[0].hours,5.5);
 const c=correction({start:date(clock('2026-11-23T10:30'),clock('2026-11-23T09:00')),end:date(clock('2026-11-23T16:00'),clock('2026-11-23T18:00'))},raw.development.rounds[0].anchors);
 const result=correctTiming(raw,[c]);assert.equal(result.timing.development.hours,2.5);assert.equal(result.timing.development.rounds[1].correctionId,undefined);
 assert.equal(correctTiming(raw,[]).timing.development.hours,raw.development.hours);
});
test('confirmed ongoing interval accumulates only through now, excluding an open pause; future starts remain unstarted',()=>{
 const maps={dev:{semantic:'developing',markers:['development_start']},pause:{semantic:'paused',markers:[]}};
 const events=[{id:'s',at:clock('2026-11-23T10:00'),statusId:'dev'},{id:'p',at:clock('2026-11-23T11:00'),statusId:'pause'}];
 const now=new Date(clock('2026-11-23T15:00')),raw=timing(events,maps,{syncStartAt:'2026-11-01',now});
 const c=correction({start:date(clock('2026-11-23T09:00'),events[0].at)},['s','p']);
 const result=correctTiming(raw,[c],{now});assert.equal(result.timing.development.hours,2);assert.equal(result.timing.development.rounds[0].end,null);
 c.fields.start=date(clock('2026-11-24T09:00'),events[0].at);const future=correctTiming(raw,[c],{now});assert.equal(future.timing.development.hours,0);assert.equal(actualTimelineSpan({semantic:'developing',timing:future.timing},'2026-11-23').state,'not_started');
});
test('confirmed multi-round hours are aggregated before rounding and unknown starts do not become zero',()=>{
 const raw=source([round(['s','e'],clock('2026-11-23T10:00'),clock('2026-11-23T10:01'),1/60),round(['s2','e2'],clock('2026-11-24T10:00'),clock('2026-11-24T10:01'),1/60)]);
 const c=correction({start:date(clock('2026-11-23T09:59'),raw.development.rounds[0].start)});
 const result=correctTiming(raw,[c]);assert.equal(result.timing.development.workingDays,0.1);assert.equal(result.timing.development.hours,3/60);
 c.fields.start={mode:'unknown',source:raw.development.rounds[0].start};const unknown=correctTiming(raw,[c]);assert.equal(unknown.timing.development.hours,null);assert.equal(unknown.timing.development.unknown,true);
 const tooLong=correctTiming(source([]),[correction({start:date('1900-01-01',null),end:date('2200-01-01',null)},[])]);assert.equal(tooLong.timing.development.hours,null);
});
