import test from 'node:test';import assert from 'node:assert/strict';
import {effectiveRules,validateRules,validateEffective,validDay,workingDays,collectionDue,objectKind,stages,versionProgress,optimizationSummary,timing,concurrency} from '../app/management-engine.mjs';
const maps={pending:{semantic:'not_started',markers:[]},dev:{semantic:'developing',markers:['development_start']},devEnd:{semantic:'processing',markers:['development_end']},test:{semantic:'testing',markers:['test_start']},testEnd:{semantic:'processing',markers:['test_end']},paused:{semantic:'paused',markers:[]},processing:{semantic:'processing',markers:[]},done:{semantic:'delivered',markers:[]},cancel:{semantic:'non_delivery',markers:[]}};
const item=(id,type,parent=null,extra={})=>({id,managed_version_id:'v1',source_task_id:id,type_name:type,parent_source_task_id:parent,source_presence:'current',structure_issues:[],source_status_id:'done',...extra});
test('P05 inheritance resolves each field, restores upstream and rejects combined overlap',()=>{
 const system={scope:'system',values:{foundation:['UI'],detail:['后台'],concurrency:4}};
 const version={scope:'version',values:{detail:['动效']}};const requirement={scope:'requirement',values:{foundation:['客户端']}};
 let rules=effectiveRules([system,version,requirement]);assert.deepEqual(rules.foundation,{value:['客户端'],source:'requirement'});assert.equal(rules.detail.source,'version');assert.equal(rules.concurrency.source,'system');
 rules=effectiveRules([system,version]);assert.deepEqual(rules.foundation.value,['UI']);assert.equal(rules.foundation.source,'system');
 assert.throws(()=>validateRules({concurrency:5},'version'));assert.throws(()=>validateRules({schedules:[{day:2,time:'25:00'}]},'system'));assert.throws(()=>validateRules({schedules:[{day:2,time:'10:00'},{day:2,time:'10:00'}]},'system'));
 assert.throws(()=>validateEffective(effectiveRules([{scope:'version',values:{foundation:['后台']}}])));validateEffective(rules);
});
test('P05 calendar uses Shanghai dates, special workdays and no non-workday catch-up',()=>{
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2028-02-29'),true);
 assert.equal(workingDays('2026-11-14','2026-11-16'),1);assert.equal(workingDays('2026-11-14','2026-11-16',{'2026-11-14':true,'2026-11-16':false}),1);
 assert.equal(workingDays('2026-11-17','2026-11-17'),1);
 const schedule=[{day:2,time:'10:00'}];assert.equal(collectionDue('2026-11-17T02:00:00Z',schedule),true);assert.equal(collectionDue('2026-11-17T02:00:00Z',schedule,{'2026-11-17':false}),false);
 assert.equal(collectionDue('2026-11-18T02:00:00Z',schedule),false);
});
test('P05 stages require every selected function, check all descendants and roll back on reopen',()=>{
 const root=item('r','需求',null,{source_status_id:'pending'}),ui1=item('ui1','子需求','r',{function_name:'UI'}),ui2=item('ui2','子需求','r',{function_name:'UI'}),testRoot=item('t','测试任务','r'),defect=item('bug','缺陷','t');
 const items=[root,ui1,ui2,testRoot,defect];const rules=effectiveRules([{scope:'system',values:{foundation:['UI'],detail:['后台']}}]);
 let result=stages(root,items,rules,maps);assert.equal(result.foundation.complete,true);assert.equal(result.detail.complete,false);assert.deepEqual(result.detail.missingFunctions,['后台']);assert.equal(result.test.complete,true);
 result=stages(root,items,rules,maps,['后台']);assert.equal(result.detail.complete,true);
 ui2.source_status_id='dev';result=stages(root,items,rules,maps,['后台']);assert.equal(result.foundation.complete,false);assert.equal(result.detail.complete,false);assert.equal(result.test.complete,false);
 ui2.source_status_id='done';defect.source_status_id='cancel';result=stages(root,items,rules,maps,['后台']);assert.equal(result.test.complete,true);assert.equal(result.deliveredCount,3);assert.equal(result.nonDeliveryCount,1);
 defect.source_status_id='unmapped';assert.equal(stages(root,items,rules,maps,['后台']).test.complete,false);
 defect.source_status_id='done';defect.source_presence='missing_unknown';assert.equal(stages(root,items,rules,maps,['后台']).test.complete,false);
 assert.equal(stages(root,[root],rules,maps).test.complete,false);
});
test('P05 identifies acceptance by category/parent, never title; optimization counts and gates differ',()=>{
 const root=item('r','需求'),accept=item('a','任务','r',{category:'验收总单'}),task=item('at','任务','a'),wrong=item('wrong','任务','r',{title:'验收任务单'}),container=item('o','优化需求总单'),optimization=item('opt','优化需求','o'),child=item('ot','任务','opt',{source_status_id:'pending'});
 const items=[root,accept,task,wrong,container,optimization,child],bySource=new Map(items.map(i=>[i.source_task_id,i]));assert.equal(objectKind(task,bySource),'acceptance_task');assert.equal(objectKind(wrong,bySource),'auxiliary');assert.equal(optimizationSummary(items,maps)[0].stateComplete,true);assert.equal(optimizationSummary(items,maps)[0].completionGate,false);optimization.source_status_id='unknown';assert.equal(optimizationSummary(items,maps)[0].stateComplete,null);child.source_status_id='unknown';assert.equal(optimizationSummary(items,maps)[0].completionGate,null);
});
test('P05 actual timer uses source timestamps, excludes pauses, keeps rounds and unknown starts',()=>{
 const e=(day,statusId)=>({at:'2026-11-'+day+'T02:00:00Z',statusId});const options={syncStartAt:'2026-11-01T00:00:00Z',now:new Date('2026-11-20T03:00:00Z')};
 const result=timing([e('16','dev'),e('17','paused'),e('18','dev'),e('19','devEnd'),e('20','test'),e('20','testEnd')],maps,options);
 assert.equal(timing([e('16','dev'),e('17','processing'),e('18','dev'),e('19','devEnd')],maps,options).development.workingDays,3);
 assert.equal(result.development.workingDays,3);assert.equal(result.test.workingDays,1);
 const rounds=timing([e('16','test'),e('17','testEnd'),e('18','testEnd'),e('19','test'),e('20','testEnd')],maps,options);assert.equal(rounds.test.rounds.length,2);assert.equal(rounds.test.workingDays,4);
 const gap=timing([{...e('16','dev'),fromStatusId:'pending'},{...e('18','devEnd'),fromStatusId:'paused'}],maps,options);assert.equal(gap.development.workingDays,null);
 assert.equal(timing([e('16','dev'),e('17','cancel')],maps,options).development.workingDays,null);
 assert.equal(timing([e('17','testEnd')],maps,options).test.workingDays,null);assert.equal(timing([],maps,options).development.workingDays,null);
 assert.equal(timing([e('16','dev'),e('17','unknown'),e('18','devEnd')],maps,options).development.workingDays,null);
 assert.equal(timing([e('16','dev'),e('17','devEnd')],maps,{...options,syncStartAt:'2026-11-17T00:00:00Z'}).development.workingDays,null);
});
test('P05 concurrency joins actual source executor across active versions with one global threshold',()=>{
 const root1=item('root1','需求'),root2=item('root2','需求',null,{managed_version_id:'v2'});const core=(id,parent,version)=>item(id,'子需求',parent,{managed_version_id:version,function_name:'UI',executor_source_id:'same-source-person',planned_start_at:'2026-11-16T00:00:00Z',planned_due_at:'2026-11-20T00:00:00Z'});
 const items=[root1,root2,core('a','root1','v1'),core('b','root2','v2'),core('c','root2','v2')];assert.equal(concurrency(items,3).attention[0].count,3);assert.equal(concurrency(items,4).attention.length,0);items[2].planned_due_at=null;assert.equal(concurrency(items,3).excluded,1);assert.equal(concurrency(items,3).attention.length,0);
});

test('P05 version progress weights requirements equally and never turns unknown coverage into zero',()=>{const stage=(complete,calculable=true)=>({complete,calculable});const roots=[{stages:{foundation:stage(true),detail:stage(true),test:stage(true)}},{stages:{foundation:stage(false),detail:stage(false,false),test:stage(false)}}];const progress=versionProgress(roots,[]);assert.equal(progress.foundation.percent,50);assert.equal(progress.detail.percent,null);assert.equal(progress.detail.unknown,1);assert.equal(versionProgress([],[]).test.percent,null);});
