import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readJson} from '../app/config.mjs';
import {poolFor,migrate} from '../app/database.mjs';
import {bootstrap} from '../app/security.mjs';
import {enrollVersion,syncVersion} from '../app/version-source.mjs';
import {createPoller} from '../app/sync-poller.mjs';
import {canonical,validateHistory} from '../app/source-history.mjs';
import {createTeambitionSource} from '../app/teambition-source.mjs';
const org='a'.repeat(24),project='b'.repeat(24),version='c'.repeat(24),category='d'.repeat(24),fn='e'.repeat(24),type='f'.repeat(24),status='1'.repeat(24),task='3'.repeat(24);
const config={cliPath:'C:/fake/teambition-cli.exe',organizationId:org,projectId:project,versionIds:[version],categoryFieldId:category,functionFieldId:fn};
function query(overrides={}){return async(action,args)=>{
 if(overrides[action])return overrides[action](args);
 const data={query:[{id:project,organizationId:org,name:'测试项目'}],'sprint-query':[{id:version,projectId:project,name:'受控版本'}],'sfc-query':[{_id:type,name:'任务',_taskflowId:'2'.repeat(24)}],'taskflow-query':[{id:'2'.repeat(24),name:'子需求中文工作流'}],'tfs-query':[{id:status,name:'待处理'}],'customfield-query':[{_id:category,name:'工单分类',type:'dropDown'},{_id:fn,name:'职能',type:'dropDown'}],'task-query':[{id:task,projectId:project,sprintId:version,isArchived:false,sfcId:type,tfsId:status,content:'测试',customfields:[]}],'task-activity':[]};
 return {result:data[action],nextPageToken:''};
};}
test('P04 missing task reconciliation distinguishes explicit evidence without inferring deletion',async()=>{
 const cases=[['archived',{id:'4'.repeat(24),isArchived:true}],['out_of_scope',{id:'4'.repeat(24),projectId:project,sprintId:'5'.repeat(24)}],['missing_unknown',null],['deleted_confirmed',{id:'4'.repeat(24),isDeleted:true}]];
 for(const [expected,detail] of cases){const source=createTeambitionSource(config,query({'task-detail':async()=>({result:detail?[detail]:[]})}));const data=await source.read({projectId:project,sourceVersionId:version,knownTaskIds:['4'.repeat(24)]});assert.equal(data.reconciliations[0].presence,expected);}
 for(const [code,expected] of [[403,'access_restricted'],[404,'missing_unknown']]){const source=createTeambitionSource(config,query({'task-detail':async()=>{const e=new Error('fixed');e.sourceStatus=code;throw e;}}));assert.equal((await source.read({projectId:project,sourceVersionId:version,knownTaskIds:['4'.repeat(24)]})).reconciliations[0].presence,expected);}
 await assert.rejects(createTeambitionSource(config,query({'task-detail':async()=>{throw new Error('network');}})).read({projectId:project,sourceVersionId:version,knownTaskIds:['4'.repeat(24)]}));
});
test('P04 partial activity pagination cannot produce a successful snapshot',async()=>{
 let n=0;const read=createTeambitionSource(config,query({'task-activity':async()=>{if(++n===2)throw new Error('page failed');return {result:[{id:'event-1'}],nextPageToken:'next'};}}));await assert.rejects(read.read({projectId:project,sourceVersionId:version}));
 assert.throws(()=>validateHistory({reconciliations:[]},[],['missing']));
 assert.throws(()=>validateHistory({activities:[{sourceTaskId:'a',activity:{id:'e',action:'update',createTime:'invalid'}}]},[{sourceTaskId:'a'}],[]));
 assert.deepEqual(canonical({b:2,a:1}),canonical({a:1,b:2}));
});
test('P04 persistent checkpoints, histories, retry, restart pickup and owner gating',{skip:!process.env.VIKINGPM_TEST_CONFIG},async()=>{
 const db=readJson(process.env.VIKINGPM_TEST_CONFIG);assert.equal(db.database,'vikingpm_p01p02_test');assert.equal(db.host,'127.0.0.1');assert.equal(db.user,'vikingpm_migrator');
 const schema='p04_'+randomBytes(8).toString('hex'),setup=poolFor(db);await setup.query('CREATE SCHEMA '+schema);let pool=poolFor({...db,options:'-c search_path='+schema});
 try{
  await migrate(pool);await bootstrap(pool,{confirmed:true,corpId:'fake',reason:'隔离',people:[{displayName:'owner',unionId:'owner',role:'owner'}]},'fake');
  const owner=(await pool.query('SELECT id FROM people')).rows[0].id;
  const managed=await enrollVersion(pool,{corpId:'fake',projectId:project,projectName:'测试',versionId:version,versionName:'测试',ownerId:owner,reason:'隔离'},owner),id=managed.id,options={actorId:owner,reason:'隔离同步'};
  const activity={id:'event',action:'update',boundToObjectId:task,boundToObjectType:'task',createTime:'2026-11-16T01:00:00Z',updateTime:'2026-11-16T01:00:00Z'};
  let title='A';const snapshot=()=>({items:[{sourceTaskId:task,title,typeName:'任务',status:'待处理',executorSourceId:'executor',participantSourceIds:['b','a'],plannedStartAt:'2026-11-16T01:00:00Z',plannedDueAt:'2026-11-17T01:00:00Z'}],activities:[{sourceTaskId:task,activity}],reconciliations:[]});
  const state=async()=>(await pool.query('SELECT cursor,last_success_at,next_due_at,failure_count FROM source_sync_states WHERE managed_version_id=$1',[id])).rows[0];
  const counts=async()=>(await pool.query('SELECT (SELECT count(*)::int FROM work_items) AS tasks,(SELECT count(*)::int FROM source_observations) AS observations,(SELECT count(*)::int FROM source_activities) AS activities')).rows[0];
  assert.equal((await syncVersion(pool,id,async()=>snapshot(),options)).status,'succeeded');
  const itemId=(await pool.query('SELECT id FROM work_items')).rows[0].id;
  await syncVersion(pool,id,async()=>snapshot(),options);assert.deepEqual(await counts(),{tasks:1,observations:1,activities:1});
  title='B';activity.updateTime='2026-11-16T02:00:00Z';await syncVersion(pool,id,async()=>snapshot(),options);title='A';await syncVersion(pool,id,async()=>snapshot(),options);
  assert.deepEqual(await counts(),{tasks:1,observations:3,activities:2});
  const before=await state();assert.ok(before.cursor);await syncVersion(pool,id,async()=>{throw new Error('failure');},options);const failed=await state();assert.equal(failed.cursor,before.cursor);assert.equal(failed.last_success_at.toISOString(),before.last_success_at.toISOString());assert.equal(failed.failure_count,1);
  assert.deepEqual(await counts(),{tasks:1,observations:3,activities:2});
  for(const presence of ['archived','out_of_scope','access_restricted','missing_unknown','deleted_confirmed']){
   assert.equal((await syncVersion(pool,id,async()=>({items:[],activities:[],reconciliations:[{sourceTaskId:task,presence}]}),options)).status,'succeeded');
   assert.equal((await pool.query('SELECT source_presence FROM work_items')).rows[0].source_presence,presence);
  }
  await syncVersion(pool,id,async()=>snapshot(),options);assert.equal((await pool.query('SELECT id FROM work_items')).rows[0].id,itemId);
  await pool.query("UPDATE source_sync_states SET next_due_at=now()-interval '1 second' WHERE managed_version_id=$1",[id]);
  await pool.end();pool=poolFor({...db,options:'-c search_path='+schema});
  let calls=0;const source={read:async binding=>{assert.equal(binding.knownTaskIds[0],task);calls++;return snapshot();}};
  const opts={corpId:'fake',projectId:project,versionIds:[version],intervalSeconds:900};
  await createPoller(pool,source,opts).runOnce();assert.equal(calls,1);assert.equal((await state()).failure_count,0);
  const automatic=(await pool.query("SELECT actor_id FROM audit_events WHERE reason LIKE '系统轮询%' ORDER BY id DESC LIMIT 1")).rows[0];assert.equal(automatic.actor_id,null);
  await createPoller(pool,source,opts).runOnce();assert.equal(calls,1);
  for(const failRead of [false,true]){
   let readCompleted;
   const result=await syncVersion(pool,id,async()=>{
    readCompleted=(await pool.query('SELECT pg_sleep(0.05),clock_timestamp() AS at')).rows[0].at;
    if(failRead)throw new Error('delayed failure');
    return snapshot();
   },options);
   assert.equal(result.status,failRead?'failed':'succeeded');
   const checkpoint=await state(),run=(await pool.query('SELECT started_at,finished_at FROM source_sync_runs WHERE managed_version_id=$1 ORDER BY started_at DESC LIMIT 1',[id])).rows[0];
   assert(checkpoint.next_due_at.getTime()>=readCompleted.getTime()+(failRead?60:900)*1000,'next attempt must wait after source reading, not transaction start');
   assert(run.finished_at>=readCompleted);assert(run.finished_at>=run.started_at);
   if(!failRead)assert(checkpoint.last_success_at>=readCompleted);
  }
  await pool.query('UPDATE managed_versions SET owner_id=NULL WHERE id=$1',[id]);await pool.query("UPDATE source_sync_states SET next_due_at=now()-interval '1 second' WHERE managed_version_id=$1",[id]);
  assert.deepEqual(await createPoller(pool,source,opts).runOnce(),[]);assert.equal(calls,1);
 }finally{await pool.end();assert.match(schema,/^p04_[a-f0-9]{16}$/);await setup.query('DROP SCHEMA '+schema+' CASCADE');await setup.end();}
});