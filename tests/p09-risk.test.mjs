import test from 'node:test';
import assert from 'node:assert/strict';
import {plannedProgress,feedbackRisk,summarizeRisk} from '../app/risk-engine.mjs';
import {actionRiskSummary,scopeActionContexts} from '../app/public/shell.js';
const item={kind:'professional',sourcePresence:'current',semantic:'developing',plannedStartAt:'2026-11-02',plannedDueAt:'2026-11-13'};
const feedback={state:'valid',submitted_at:'2026-11-05T18:00:00+08:00',progress_percent:20,situation:'进度正常',note:''};
const now=new Date('2026-11-27T18:00:00+08:00');

test('plan uses unrounded working hours, inclusive endpoint dates and configured holidays/makeup shifts',()=>{
  assert.equal(plannedProgress(item.plannedStartAt,item.plannedDueAt,feedback.submitted_at),40);
  assert.equal(plannedProgress('2026-11-02','2026-11-02','2026-11-02T12:30:00+08:00'),40);
  assert.equal(plannedProgress('2026-11-02','2026-11-02','2026-11-02T13:30:00+08:00'),40);
  assert.equal(plannedProgress('2026-11-02','2026-11-02','2026-11-02T08:00:00+08:00'),0);
  assert.equal(plannedProgress('2026-11-02','2026-11-02','2026-11-02T19:00:00+08:00'),100);
  const calendar={'2026-11-02':{working:false,intervals:[]},'2026-11-07':{working:true,intervals:[{start:'10:00',end:'12:00'}]}};
  assert.equal(plannedProgress('2026-11-02','2026-11-08','2026-11-06T18:00:00+08:00',calendar),30/32*100);
  for(const [start,end] of [[null,'2026-11-02'],['bad','2026-11-02'],['2026-11-03','2026-11-02'],['2026-11-07','2026-11-08'],['2000-01-01','2026-11-02']])assert.equal(plannedProgress(start,end,feedback.submitted_at),null);
  assert.equal(plannedProgress('2026-11-02','2026-11-03',null),null);
});

test('risk compares against submission time at the inclusive 20 percentage point threshold',()=>{
  const risk=feedbackRisk(item,feedback,{},now);
  assert.equal(risk.level,'watch');assert.equal(risk.lagPercentagePoints,20);
  assert.equal(feedbackRisk(item,{...feedback,progress_percent:21},{},now).level,'normal');
  assert.equal(feedbackRisk(item,{...feedback,progress_percent:19},{},now).level,'watch');
  assert.deepEqual(feedbackRisk(item,feedback,{},new Date('2026-12-10')),risk,'aging feedback must not increase the gap');
  assert.equal(feedbackRisk(item,{...feedback,progress_percent:100},{},now).level,'normal');
  assert.equal(feedbackRisk(item,{...feedback,submitted_at:'2026-11-05T17:59:59+08:00'},{},now).level,'normal','do not round a value just below threshold');
});

test('explicit valid risk takes priority; invalid/missing evidence never becomes normal',()=>{
  assert.equal(feedbackRisk(item,{...feedback,situation:'存在风险',progress_percent:100},{},now).level,'high');
  assert.equal(feedbackRisk({...item,plannedStartAt:null},{...feedback,situation:'存在风险'},{},now).level,'high');
  assert.equal(feedbackRisk({...item,plannedStartAt:null},feedback,{},now).level,'unknown');
  for(const fb of [null,{...feedback,state:'review'},{...feedback,state:'unknown'},{...feedback,submitted_at:null},{...feedback,submitted_at:'2099-01-01'},{...feedback,progress_percent:null}])assert.equal(feedbackRisk(item,fb,{},now).level,'unknown');
  for(const change of [{sourcePresence:'missing_unknown'},{semantic:null},{feedbackEligible:false}])assert.equal(feedbackRisk({...item,...change},feedback,{},now).level,'unknown');
  assert.equal(feedbackRisk({...item,semantic:'delivered'},{...feedback,situation:'存在风险'},{},now).level,'normal');
  assert.equal(feedbackRisk({...item,kind:'auxiliary'},feedback,{},now),null);
});

test('risk aggregation retains unknown coverage, highest level and stable executor identities across filters',()=>{
  const version={id:'v1'},v2={id:'v2'};
  const facts=[{id:'a',sourceTaskId:'a',parentSourceTaskId:'r',kind:'professional',functionName:'UI界面',version,risk:{level:'high'},executorPersonId:'p1',executorName:'同名',due:{overdue:true}},
    {id:'b',sourceTaskId:'b',parentSourceTaskId:'r',kind:'professional',functionName:'服务端',version,risk:{level:'watch'},executorPersonId:'p2',executorName:'同名'},
    {id:'c',sourceTaskId:'c',parentSourceTaskId:'r',kind:'professional',version:v2,risk:{level:'unknown'}},
    {id:'d',sourceTaskId:'d',parentSourceTaskId:'r',kind:'professional',version:v2,risk:{level:'watch'},executorPersonId:'p1'}];
  const result=actionRiskSummary(facts);assert.equal(result.groups.length,2);assert.equal(result.groups[0].level,'high');assert.equal(result.owners.length,2);assert.equal(result.owners.find(o=>o.items.length===2).all.length,2);assert.equal(result.unknown,1);
  assert.deepEqual(summarizeRisk(facts),{level:'high',high:1,watch:2,unknown:1,normal:0,total:4});assert.equal(summarizeRisk([]).level,'unknown');
  const scoped=scopeActionContexts([{version,management:{items:facts.filter(f=>f.version===version)}}],'v1',['服务端']);
  assert.equal(actionRiskSummary(scoped[0].management.items.map(i=>({...i,version}))).groups[0].level,'watch');
});
