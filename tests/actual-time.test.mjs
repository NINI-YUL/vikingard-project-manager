import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readJson} from '../app/config.mjs';
import {poolFor,migrate} from '../app/database.mjs';
import {bootstrap,establishSession,authenticate} from '../app/security.mjs';
import {enrollVersion,syncVersion} from '../app/version-source.mjs';
import {managementResults} from '../app/management.mjs';
import {readActualTime,saveActualTime} from '../app/actual-time.mjs';
import {createApplication} from '../app/server.mjs';

test('actual-time PostgreSQL: partial overrides, future dates, sync/reopen/history conflicts, audit and authorization',{skip:!process.env.VIKINGPM_TEST_CONFIG},async t=>{
 const db=readJson(process.env.VIKINGPM_TEST_CONFIG);assert.equal(db.database,'vikingpm_p01p02_test');assert.equal(db.host,'127.0.0.1');assert.equal(db.user,'vikingpm_migrator');
 const schema='actual_'+randomBytes(8).toString('hex'),setup=poolFor(db);await setup.query('CREATE SCHEMA '+schema);let pool=poolFor({...db,options:'-c search_path='+schema}),server;
 try{
  await migrate(pool);await bootstrap(pool,{confirmed:true,corpId:'fake',reason:'隔离',people:[{displayName:'所有者',unionId:'owner',role:'owner'},{displayName:'管理员',unionId:'admin',role:'admin'},{displayName:'查看者',unionId:'viewer',role:'viewer'}]},'fake');
  const people=Object.fromEntries((await pool.query('SELECT p.id,i.union_id,g.role FROM people p JOIN identity_mappings i ON i.person_id=p.id JOIN access_grants g ON g.person_id=p.id')).rows.map(p=>[p.union_id,p]));const {owner,admin,viewer}=people;
  const root='c'.repeat(24),child='d'.repeat(24);
  const version=await enrollVersion(pool,{corpId:'fake',projectId:'a'.repeat(24),projectName:'隔离',versionId:'b'.repeat(24),versionName:'实际时间验证',ownerId:owner.id,reason:'测试'},owner.id);
  await pool.query("UPDATE managed_versions SET sync_start_at='2026-11-01' WHERE id=$1",[version.id]);
  const event=(id,date,status,old)=>({sourceTaskId:child,activity:{id,boundToObjectId:child,boundToObjectType:'task',action:'update.taskflowstatus',createTime:date,content:{tfsId:status,oldTfsId:old}}});
  let status='done',events=[event('e1','2026-11-26T02:00:00Z','done','pending')];
  const source=async()=>({items:[{sourceTaskId:root,title:'核心需求',typeName:'需求',sourceStatusId:'pending',status:'待处理'},{sourceTaskId:child,title:'数值任务',typeName:'子需求',parentSourceTaskId:root,functionName:'数值',sourceStatusId:status,status}],activities:events,binding:{uniqueIdPrefix:'Viking',organizationId:'fake-org',categoryFieldId:'fake-category',functionFieldId:'fake-function',typeNames:{req:'需求',core:'子需求'},statusNames:{pending:'待处理',dev:'开发中',done:'已完成',pause:'暂停'}}});
  const sync=async()=>{assert.equal((await syncVersion(pool,version.id,source,{actorId:owner.id,reason:'隔离同步'})).status,'succeeded');};await sync();
  const project=(await pool.query('SELECT id FROM source_projects')).rows[0].id;
  for(const [id,semantic,markers]of [['pending','not_started',[]],['dev','developing',['development_start']],['done','delivered',['development_end']],['pause','paused',[]]])await pool.query('INSERT INTO status_mappings(source_project_id,status_id,semantic,markers) VALUES($1,$2,$3,$4)',[project,id,semantic,JSON.stringify(markers)]);
  const items=(await pool.query('SELECT id,source_task_id FROM work_items')).rows;const itemId=items.find(i=>i.source_task_id===child).id,rootId=items.find(i=>i.source_task_id===root).id;
  const read=()=>readActualTime(pool,owner,version.id,itemId);
  const save=async(patch={},actor=owner)=>{const data=await read();return saveActualTime(pool,actor,version.id,itemId,{snapshot:data.snapshot,stage:'development',roundKey:data.item.sourceTiming.development.rounds.at(-1)?.anchors?.[0]??'empty',fields:{start:{mode:'date',value:'2026-11-24'}},reason:'补齐遗漏开始',evidence:'经任务执行人核对',confirmed:true,...patch});};
  let id;
  await t.test('supplement start, audit and raw-source preservation',async()=>{
   const before=(await pool.query('SELECT raw_source,source_status_id FROM work_items WHERE id=$1',[itemId])).rows[0];
   const rawEvents=(await pool.query('SELECT raw_source FROM source_activities ORDER BY source_activity_id,revision_hash')).rows;
   id=(await save()).id;const data=await read(),c=data.item.timingCorrections[0];
   assert.equal(c.effective.start,'2026-11-24');assert.equal(c.effective.end,'2026-11-26T02:00:00.000Z');assert.equal(c.fields.end,undefined);assert.equal(data.item.timing.development.workingDays,null);assert.equal(data.item.sourceTiming.development.rounds[0].start,null);
   assert.deepEqual((await pool.query('SELECT raw_source,source_status_id FROM work_items WHERE id=$1',[itemId])).rows[0],before);assert.deepEqual((await pool.query('SELECT raw_source FROM source_activities ORDER BY source_activity_id,revision_hash')).rows,rawEvents);
   assert.equal(data.history[0].after_value.evidence,'经任务执行人核对');assert.equal(data.history[0].actor,'所有者');
  });
  await t.test('unmodified end follows source; late start conflicts and explicit keep acknowledges it',async()=>{
   events=[event('e1','2026-11-25T02:00:00Z','done','pending')];await sync();let data=await read();assert.equal(data.item.timingCorrections[0].effective.end,'2026-11-25T02:00:00.000Z');
   assert.deepEqual((await pool.query('SELECT last_valid FROM actual_time_corrections WHERE id=$1',[id])).rows[0].last_valid,{start:'2026-11-24',end:'2026-11-25T02:00:00.000Z'});
   events=[event('s1','2026-11-23T02:00:00Z','dev','pending'),event('e1','2026-11-25T02:00:00Z','done','dev')];await sync();data=await read();assert.deepEqual(data.item.timingCorrections[0].conflicts,['start']);assert.equal(data.item.timingCorrections[0].effective.start,'2026-11-24');
   await save({correctionId:id,roundKey:'s1',fields:{},resolution:'keep'});data=await read();assert.deepEqual(data.item.timingCorrections[0].conflicts,[]);
   const stale=data.snapshot;await sync();await assert.rejects(save({snapshot:stale,correctionId:id,roundKey:'s1'}),{status:409});
  });
  await t.test('reopen keeps old correction out of the new round, late split requires reassociation',async()=>{
   status='dev';events.push(event('s2','2026-11-26T02:00:00Z','dev','done'));await sync();let data=await read();assert.equal(data.item.timing.development.rounds.length,2);assert.equal(data.item.timing.development.rounds[1].correctionId,undefined);
   events.splice(1,0,event('late-end','2026-11-23T04:00:00Z','done','dev'),event('late-start','2026-11-24T02:00:00Z','dev','done'));await sync();data=await read();assert.equal(data.item.timingCorrections[0].pending,true);
   await assert.rejects(save({correctionId:id,roundKey:'late-start',fields:{}}),{status:400});
   await save({correctionId:id,roundKey:'late-start',fields:{},rebind:true});data=await read();assert.equal(data.item.timingCorrections[0].pending,false);assert.equal(data.item.timing.development.rounds[1].correctionId,id);
   await save({correctionId:id,fields:{},resolution:'restore'});assert.equal((await read()).item.timingCorrections.length,0);
  });
  await t.test('future dates accepted; explicit unknown and restoration remain distinct',async()=>{
   id=(await save({fields:{start:{mode:'date',value:'2026-12-01'},end:{mode:'date',value:'2026-12-03'}}},admin)).id;
   assert.equal((await read()).item.timingCorrections[0].effective.start,'2026-12-01');
   await save({correctionId:id,fields:{start:{mode:'unknown'},end:{mode:'inherit'}}});let data=await read();assert.equal(data.item.timingCorrections[0].effective.start,null);assert.equal(data.item.timing.development.rounds.at(-1).start,null);
   await save({correctionId:id,fields:{},resolution:'restore'});data=await read();assert.equal(data.item.timingCorrections.length,0);assert.equal(data.item.sourceTiming.development.rounds.at(-1).start,'2026-11-26T02:00:00Z');
  });
  await t.test('a later TB end automatically fills the untouched end of an anchored manual start',async()=>{
   const manual=(await save({fields:{start:{mode:'date',value:'2026-11-25'}}})).id;
   status='done';events.push(event('e2','2026-11-27T02:00:00Z','done','dev'));await sync();
   const data=await read(),record=data.item.timingCorrections.find(c=>c.id===manual);assert.equal(record.pending,false);assert.equal(record.effective.end,'2026-11-27T02:00:00.000Z');assert.equal(record.fields.end,undefined);
   await save({correctionId:manual,fields:{},resolution:'restore'});
  });
  await t.test('stage separation and an empty source round support manual dates without inventing TB history',async()=>{
   const data=await read(),dev=structuredClone(data.item.sourceTiming.development);
   const manual=(await save({stage:'test',roundKey:'empty',fields:{start:{mode:'date',value:'2026-12-01'},end:{mode:'date',value:'2026-12-02'}}})).id;
   const after=await read();assert.equal(after.item.timing.test.rounds[0].start,'2026-12-01T00:00:00+08:00');assert.equal(after.item.sourceTiming.test.rounds.length,0);assert.deepEqual(after.item.sourceTiming.development.rounds.map(r=>({start:r.start,end:r.end,anchors:r.anchors})),dev.rounds.map(r=>({start:r.start,end:r.end,anchors:r.anchors})));
   await save({stage:'test',roundKey:'empty',correctionId:manual,fields:{},resolution:'restore'});
  });
  await t.test('trust boundary, current roles, source locks and stale saves reject without half writes',async()=>{
   const count=(await pool.query('SELECT count(*) FROM actual_time_corrections')).rows[0].count;
   for(const patch of [{fields:{start:{mode:'date',value:'2026-02-30'}}},{fields:{start:{mode:'date',value:'2026-11-24'},end:{mode:'date',value:'2026-11-23'}}},{reason:''},{evidence:{}},{unexpected:true}])await assert.rejects(save(patch),{status:400});
   await assert.rejects(save({},viewer),{status:403});
   const rootData=await readActualTime(pool,owner,version.id,rootId);await assert.rejects(saveActualTime(pool,owner,version.id,rootId,{snapshot:rootData.snapshot,stage:'development',roundKey:'empty',fields:{start:{mode:'date',value:'2026-11-24'}},reason:'不能覆盖父单',evidence:'测试',confirmed:true}),{status:400});
   const lock=await pool.connect();try{await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['version:'+version.id]);await assert.rejects(save(),{status:409});}finally{await lock.query('ROLLBACK');lock.release();}
   await pool.query("UPDATE access_grants SET role='viewer' WHERE person_id=$1",[admin.id]);await assert.rejects(save({},admin),{status:403});
   assert.equal((await pool.query('SELECT count(*) FROM actual_time_corrections')).rows[0].count,count);
   const data=await read();id=(await save()).id;await assert.rejects(save({snapshot:data.snapshot}),{status:409});
  });
  await t.test('HTTP requires session, CSRF and current admin permission; viewer sees history only',async()=>{
   const config={origin:'http://127.0.0.1',loginEnabled:true,dingtalk:{corpId:'fake'}};server=createApplication(pool,config);await new Promise(r=>server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+server.address().port;
   const own=await establishSession(pool,{corpId:'fake',unionId:'owner'}),view=await establishSession(pool,{corpId:'fake',unionId:'viewer'});own.csrf=(await authenticate(pool,own.token)).csrf;
   const path='/api/management/versions/'+version.id+'/items/'+itemId+'/actual-time';
   const request=(session,method='GET',csrf,body)=>fetch(config.origin+path,{method,headers:{...(session?{cookie:'vpm_session='+session.token}:{}),...(method==='POST'?{'Content-Type':'application/json',Origin:config.origin,'x-csrf-token':csrf??''}:{})},...(body?{body:JSON.stringify(body)}:{})});
   assert.equal((await request()).status,401);assert.equal((await request(view)).status,200);assert.equal((await request(own,'POST',null,{})).status,403);
   const viewerCsrf=(await authenticate(pool,view.token)).csrf;assert.equal((await request(view,'POST',viewerCsrf,{stage:'development'})).status,403);
   const data=await read();const response=await request(own,'POST',own.csrf,{snapshot:data.snapshot,stage:'development',roundKey:'s2',correctionId:id,fields:{},resolution:'restore',reason:'恢复',evidence:'HTTP验证',confirmed:true});assert.equal(response.status,200);
  });
  await t.test('batch saves multiple rounds with one reason and minute precision; invalid batches leave no partial writes',async()=>{
   let data=await read();const rounds=data.item.sourceTiming.development.rounds;
   const changes=rounds.map((r,index)=>({stage:'development',roundKey:r.anchors[0],fields:{start:{mode:'date',value:['2026-11-23T09:30','2026-11-24T10:15','2026-11-26T14:20'][index]},end:{mode:'date',value:['2026-11-23T11:00','2026-11-24T12:10','2026-11-26T16:40'][index]}}}));
   const records=async()=>(await pool.query('SELECT id,revision,fields,active FROM actual_time_corrections ORDER BY id')).rows;
   changes.push({stage:'test',roundKey:'empty',fields:{start:{mode:'date',value:'2026-11-27T15:30'},end:{mode:'date',value:'2026-11-27T17:00'}}});
   const before=await records(),historyBefore=data.history.length;
   const bad=structuredClone(changes);bad[1].fields.end.value='2026-11-24T09:00';
   const submit=(changes,snapshot=data.snapshot)=>saveActualTime(pool,owner,version.id,itemId,{snapshot,changes,reason:'核对三轮执行时间',confirmed:true});
   await assert.rejects(submit(bad),{status:400});assert.deepEqual(await records(),before);assert.equal((await read()).history.length,historyBefore);
   const saved=await submit(changes);assert.equal(saved.count,4);assert.equal(saved.ids.length,4);
   const stale=data.snapshot;data=await read();assert.equal(data.item.timingCorrections.length,4);
   assert.equal(data.item.timingCorrections.find(c=>c.stage==='development'&&c.key===rounds[0].anchors[0]).effective.start,'2026-11-23T01:30:00.000Z');
   const entries=data.history.filter(h=>h.reason==='核对三轮执行时间');assert.equal(entries.length,4);assert.equal(new Set(entries.map(h=>h.after_value.batchId)).size,1);assert.ok(entries.every(h=>h.after_value.evidence===undefined));
   assert.ok(data.history.some(h=>h.after_value.evidence==='经任务执行人核对'));
   await assert.rejects(submit(changes,stale),{status:409});
   const restored=data.item.timingCorrections.map(c=>({stage:c.stage,roundKey:c.key,correctionId:c.id,resolution:'restore',fields:{}}));
   await submit(restored,data.snapshot);assert.equal((await read()).item.timingCorrections.length,0);
   data=await read();const duplicate=[changes[0],changes[0]];await assert.rejects(submit(duplicate,data.snapshot),{status:400});assert.equal((await read()).item.timingCorrections.length,0);
  });
  await t.test('repeat migration/reconnection preserves corrections and audit',async()=>{
   const before=(await read()).history.length;assert.ok(before>=9);assert.equal(await migrate(pool),0);await pool.end();pool=poolFor({...db,options:'-c search_path='+schema});assert.equal((await read()).history.length,before);
   assert.equal((await managementResults(pool,version.id)).items.find(i=>i.id===itemId).timingCorrections.length,0);
  });
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();assert.match(schema,/^actual_[a-f0-9]{16}$/);await setup.query('DROP SCHEMA '+schema+' CASCADE');await setup.end();}
});
