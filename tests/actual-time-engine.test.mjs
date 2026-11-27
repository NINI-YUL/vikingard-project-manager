import test from 'node:test';
import assert from 'node:assert/strict';
import {timing} from '../app/management-engine.mjs';
import {correctTiming} from '../app/actual-time-engine.mjs';
import {actualTimelineSpan,timelineActualText} from '../app/public/shell.js';
const source=(rounds)=>({development:{rounds,unknown:rounds.some(r=>r.hours===null),hours:3,workingDays:0.4},test:{rounds:[],unknown:true}});
const round=(anchors,start,end,hours=3)=>({anchors,start,end,hours,workingDays:hours===null?null:0.4});
const correction=(fields,anchors=['s','e'])=>({id:'manual',stage:'development',anchors,fields,revision:1,last_valid:{start:'2026-11-23',end:'2026-11-26'}});
const date=(value,source)=>({mode:'date',value,source});
test('actual correction fills missing start independently, preserves raw facts and marks unverified duration',()=>{
 const raw=source([round(['e'],null,'2026-11-26T02:00:00Z',null)]),before=structuredClone(raw);
 const output=correctTiming(raw,[correction({start:date('2026-11-23',null)},['e'])]);
 assert.deepEqual(raw,before);assert.equal(output.timing.development.workingDays,null);
 const span=actualTimelineSpan({semantic:'delivered',timing:output.timing},'2026-11-27');
 assert.equal(span.startKey,'2026-11-23');assert.equal(span.endKey,'2026-11-26');assert.equal(span.completed,true);assert.match(timelineActualText(span),/历时待核实/);
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
