import {managementResults} from '../app/management.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readJson} from '../app/config.mjs';
import {poolFor,migrate,transaction} from '../app/database.mjs';
import {bootstrap,changePerson,establishSession,authenticate} from '../app/security.mjs';
import {enrollVersion,syncVersion} from '../app/version-source.mjs';
import {configureFeedback,approveFeedbackReview,refreshFeedback,feedbackOverview} from '../app/feedback.mjs';
import {persistFeedback,revalidateFeedback,chooseCurrent} from '../app/feedback-state.mjs';
import {createApplication} from '../app/server.mjs';

test('P06 equal-time conflict keeps last eligible determination; identical content is deterministic',()=>{
 const a={id:'a',recordId:'a',submitted_at:new Date(1000),contentHash:'a'},b={id:'b',recordId:'b',submitted_at:new Date(2000),contentHash:'b'},c={id:'c',recordId:'c',submitted_at:new Date(2000),contentHash:'c'};
 assert.deepEqual(chooseCurrent([],null),{historyId:null,state:'unknown',reasons:['尚无通过当前资格校验的有效反馈']});
 assert.equal(chooseCurrent([a,b],{history_id:'a'}).historyId,'b');
 assert.equal(chooseCurrent([a,b,c],{history_id:'a'}).historyId,'a');
 assert.equal(chooseCurrent([b,c],{history_id:'a'}).historyId,null);
 assert.equal(chooseCurrent([b,c],null).state,'review');
 assert.equal(chooseCurrent([{...c,contentHash:'b'},b],null).historyId,'b');
});

test('P06 PostgreSQL formal ingestion, revisions, eligibility, atomic failure, role boundaries and recovery',{skip:!process.env.VIKINGPM_TEST_CONFIG},async t=>{
 const db=readJson(process.env.VIKINGPM_TEST_CONFIG);assert.equal(db.database,'vikingpm_p01p02_test');assert.equal(db.user,'vikingpm_migrator');
 const schema='p06_'+randomBytes(8).toString('hex'),setup=poolFor(db);await setup.query('CREATE SCHEMA '+schema);const pool=poolFor({...db,options:'-c search_path='+schema});let server;
 try {
  await migrate(pool);await bootstrap(pool,{confirmed:true,corpId:'fake',reason:'隔离测试',people:[{displayName:'所有者',unionId:'owner',role:'owner'},{displayName:'查看者',unionId:'viewer',role:'viewer'},{displayName:'执行者',unionId:'worker',role:'none'}]},'fake');
  const people=Object.fromEntries((await pool.query('SELECT p.id,i.union_id,g.role FROM people p JOIN identity_mappings i ON i.person_id=p.id JOIN access_grants g ON g.person_id=p.id')).rows.map(p=>[p.union_id,p]));
  const owner=people.owner,viewer=people.viewer,project='a'.repeat(24),sprint='b'.repeat(24),root='c'.repeat(24),task='d'.repeat(24),baseTime=Date.now()-100000;
  const version=await enrollVersion(pool,{corpId:'fake',projectId:project,projectName:'隔离项目',versionId:sprint,versionName:'P06 隔离',ownerId:owner.id,reason:'隔离纳入'},owner.id);
  await pool.query('UPDATE tracking_periods SET started_at=$1',[new Date(baseTime-100000)]);
  let executor='tb-worker',status='active',title='核心专业工作',readFails=false;
  const source={read:async()=>{if(readFails)throw new Error('fake');return {items:[{sourceTaskId:root,title:'核心需求',typeName:'需求',sourceStatusId:'active',status:'进行中',rawSource:{id:root,projectId:project,uniqueId:1,isArchived:false}},{sourceTaskId:task,visibleKey:'2',title,typeName:'子需求',functionName:'UI界面',parentSourceTaskId:root,sourceStatusId:status,status:'进行中',executorSourceId:executor,plannedStartAt:'2026-11-02',plannedDueAt:'2026-11-13',isDone:status!=='active',rawSource:{id:task,projectId:project,uniqueId:2,isArchived:false}}],activities:[],binding:{uniqueIdPrefix:'vkt',organizationId:'fake',categoryFieldId:'category',functionFieldId:'function',typeNames:{root:'需求',task:'子需求'},statusNames:{active:'进行中',done:'已完成'}}};}};
  await syncVersion(pool,version.id,source.read,{actorId:owner.id,reason:'初始同步'});
  const projectId=(await pool.query('SELECT id FROM source_projects')).rows[0].id,workId=(await pool.query('SELECT id FROM work_items WHERE source_task_id=$1',[task])).rows[0].id;
  await pool.query("INSERT INTO status_mappings(source_project_id,status_id,semantic,recovery) VALUES($1,'active','developing','verified'),($1,'done','delivered','verified')",[projectId]);
  const settings={projectId,confirmed:true,enabled:true,reason:'核对受控来源'};
  const registered=await configureFeedback(pool,owner,{...settings,kind:'source',baseId:'isolated-base',sheetId:'isolated-sheet'},[project]);
  const sourceRow=(await pool.query('SELECT * FROM feedback_sources WHERE id=$1',[registered.id])).rows[0];
  await pool.query('UPDATE feedback_sources SET confirmed_at=$1',[new Date(baseTime-1000)]);sourceRow.confirmed_at=new Date(baseTime-1000);
  await configureFeedback(pool,owner,{...settings,kind:'executor',executorId:executor,personId:people.worker.id},[project]);
  const raw=(id,progress,time=baseTime,fields={})=>({id,createdTime:time,createdBy:{unionId:'worker'},fields:{'TB工单id':'vkt-2','任务':title,'提交人':{unionId:'worker'},'当前进度百分比':progress/100,'当前情况':{name:'进度正常'},...fields}});
  let records=[];
  const ingest=async rows=>{records=rows;return refreshFeedback(pool,owner,{sourceId:registered.id,versionId:version.id,reason:'隔离读取'},source,async()=>structuredClone(records));};
  const current=async()=>{const data=await feedbackOverview(pool,owner,version.id);return data.items.find(i=>i.id===workId);};
  const count=async table=>(await pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n;
  await t.test('tracking boundary, integer bounds, creator and submitter both required',async()=>{
    await ingest([raw('old',90,baseTime-200000),raw('fraction',12.5),raw('wrong-number',30,baseTime,{'TB工单id':'wrong'}),raw('wrong-title',40,baseTime,{'任务':'wrong'}),{...raw('wrong-creator',50),createdBy:{unionId:'owner'}},raw('wrong-submitter',60,baseTime,{'提交人':{unionId:'owner'}})]);
    assert.equal((await current()).progressPercent,null);assert.equal(await count('valid_feedback_history'),0);assert.equal(await count('feedback_records'),6);
  });
  const first=raw('first',20),second=raw('second',70,baseTime+1000);
  await t.test('latest valid platform creation wins; wrong newer records never cover it; old notification link is allowed',async()=>{
    await ingest([first,second,raw('bad',99,baseTime+2000,{'任务':'wrong'})]);assert.equal((await current()).progressPercent,70);
    const validationsBefore=await count('feedback_validations');
    const managed=await managementResults(pool,version.id);
    assert.equal(managed.items.find(i=>i.id===workId).risk.level,'watch');
    assert.equal(managed.items.find(i=>i.id===workId).risk.lagPercentagePoints,30);
    assert.equal(managed.requirements[0].risk.level,'watch');
    assert.equal(await count('feedback_validations'),validationsBefore,'management reads must not revalidate/write feedback');
    assert.equal(await count('valid_feedback_history'),2);
    const before=await count('feedback_revisions');await ingest([first,second,raw('bad',99,baseTime+2000,{'任务':'wrong'})]);assert.equal(await count('feedback_revisions'),before);assert.equal(await count('valid_feedback_history'),2);
  });
  await t.test('current values refresh in one statement and recreate missing unknown rows',async()=>{
    const values=async client=>(await client.query('SELECT work_item_id,history_id,state,reasons FROM current_feedback ORDER BY work_item_id')).rows;
    const before=await values(pool),writes=[];
    await transaction(pool,async client=>{
      await client.query('SELECT id FROM security_state WHERE id=1 FOR UPDATE');
      await client.query("DELETE FROM current_feedback WHERE state='unknown'");
      await revalidateFeedback({query:async(sql,params)=>{if(sql.startsWith('INSERT INTO current_feedback'))writes.push(sql);return client.query(sql,params);}});
      assert.deepEqual(await values(client),before);
    });
    assert.equal(writes.length,1);
    assert.equal(before.length,Number((await pool.query('SELECT count(*) AS n FROM work_items')).rows[0].n));
  });
  await t.test('edits retain original creation order and revisions, including A-B-A; changed creation timestamp is rejected',async()=>{
    await ingest([{...first,modifiedTime:baseTime+9000,fields:{...first.fields,'当前进度百分比':0.3}},second]);assert.equal((await current()).progressPercent,70);
    await ingest([first,second]);assert.equal((await current()).progressPercent,70);
    await ingest([first,{...second,createdTime:baseTime+50000}]);assert.equal((await current()).progressPercent,20);
    await ingest([first,second]);assert.equal((await current()).progressPercent,70);
  });
  await t.test('equal-time conflict preserves last still valid determination and survives restart/read replays',async()=>{
    const tie=raw('tie',90,second.createdTime);await ingest([first,second,tie]);assert.equal((await current()).state,'review');assert.equal((await current()).progressPercent,70);
    const otherPool=poolFor({...db,options:'-c search_path='+schema});try{assert.equal((await feedbackOverview(otherPool,owner,version.id)).items.find(i=>i.id===workId).progressPercent,70);}finally{await otherPool.end();}
    await ingest([first,second]);assert.equal((await current()).state,'valid');
  });
  await t.test('qualification, executor, title, terminal state and identity changes revalidate; unknown is never zero',async()=>{
    executor='other';await syncVersion(pool,version.id,source.read,{actorId:owner.id,reason:'执行者改变'});assert.equal((await current()).progressPercent,null);
    executor='tb-worker';title='新标题';await syncVersion(pool,version.id,source.read,{actorId:owner.id,reason:'标题改变'});assert.equal((await current()).progressPercent,null);
    title='核心专业工作';await syncVersion(pool,version.id,source.read,{actorId:owner.id,reason:'恢复标题'});assert.equal((await current()).progressPercent,70);
    status='done';await syncVersion(pool,version.id,source.read,{actorId:owner.id,reason:'来源完成'});assert.equal((await current()).progressPercent,null);
    status='active';await ingest([first,second]);
    await changePerson(pool,owner.id,people.worker.id,{mappingEnabled:false,reason:'身份撤销'},'identity');assert.equal((await current()).progressPercent,null);
    await changePerson(pool,owner.id,people.worker.id,{mappingEnabled:true,reason:'身份恢复'},'identity');assert.equal((await current()).progressPercent,70);
    readFails=true;await assert.rejects(ingest([first,second]));assert.equal((await current()).progressPercent,null);readFails=false;await ingest([first,second]);assert.equal((await current()).progressPercent,70);
    await ingest([first,second,raw('hundred',100,baseTime+5000)]);assert.equal((await current()).progressPercent,100);assert.equal((await pool.query('SELECT source_is_done FROM work_items WHERE id=$1',[workId])).rows[0].source_is_done,false);
  });
  await t.test('transaction failure leaves neither partial raw revision/history nor wrong current',async()=>{
    const before=await count('feedback_records'),history=await count('valid_feedback_history'),value=(await current()).progressPercent;
    await assert.rejects(transaction(pool,async client=>{await client.query('SELECT id FROM security_state WHERE id=1 FOR UPDATE');await persistFeedback(client,sourceRow,[raw('rollback',80,baseTime+6000)]);throw new Error('forced rollback');}));
    assert.equal(await count('feedback_records'),before);assert.equal(await count('valid_feedback_history'),history);assert.equal((await current()).progressPercent,value);
    await assert.rejects(ingest([first,first]));assert.equal(await count('feedback_records'),before);
  });
  await t.test('risk description requires scoped human review; rejects cannot be manually approved',async()=>{
    const incomplete=raw('incomplete-risk',82,baseTime+8500,{'当前情况':{name:'存在风险'}});await ingest([first,second,incomplete]);let incompleteReview=(await feedbackOverview(pool,owner,version.id)).validations.find(v=>v.recordId==='incomplete-risk');assert.equal(incompleteReview.verdict,'review');assert.equal((await current()).progressPercent,70);
    const risk=raw('risk',85,baseTime+9000,{'当前情况':{name:'存在风险'},'风险原因':'接口延后','预估延期时间':'1天','所需协助':'接口协助'});
    await ingest([first,second,risk]);assert.equal((await current()).progressPercent,70);
    let review=(await feedbackOverview(pool,owner,version.id)).validations.find(v=>v.recordId==='risk');assert.equal(review.verdict,'review');
    await approveFeedbackReview(pool,owner,{validationId:review.validationId,confirmed:true,reason:'已核对原因、影响与所需协助'});assert.equal((await current()).progressPercent,85);
    await ingest([first,second,risk]);assert.equal((await current()).progressPercent,85);
    const managedRisk=await managementResults(pool,version.id);assert.equal(managedRisk.items.find(i=>i.id===workId).risk.level,'high');assert.equal(managedRisk.requirements[0].risk.level,'high');
    const olderPending=raw('older-pending-risk',30,baseTime+8700,{'当前情况':{name:'存在风险'},'风险原因':'原因','预估延期时间':'1天','所需协助':'否'});
    await ingest([first,second,risk,olderPending]);
    let pending=(await feedbackOverview(pool,owner,version.id)).pendingReviews;
    assert.equal(pending.length,1);assert.equal(pending[0].taskTitle,title);assert.equal(pending[0].progressPercent,30);
    const editedPending={...olderPending,fields:{...olderPending.fields,'预估延期时间':'2天'}};
    await ingest([first,second,risk,editedPending]);
    const page=await feedbackOverview(pool,owner,version.id,100);
    pending=page.pendingReviews;assert.equal(pending.length,1);assert.equal(pending[0].progressPercent,30);
    const oldPendingValidation=(await pool.query("SELECT f.id FROM feedback_validations f JOIN feedback_revisions v ON v.id=f.revision_id JOIN feedback_records r ON r.id=v.record_id WHERE r.source_record_id='older-pending-risk' AND v.id<>r.latest_revision_id LIMIT 1")).rows[0];
    assert.notEqual(pending[0].validationId,oldPendingValidation.id);
    await approveFeedbackReview(pool,owner,{validationId:pending[0].validationId,confirmed:true,reason:'测试修订复核'});
    assert.equal((await feedbackOverview(pool,owner,version.id)).pendingReviews.length,0);
    assert.equal((await current()).progressPercent,85);

    const bad=raw('bad-risk',95,baseTime+10000,{'任务':'wrong','当前情况':{name:'存在风险'}});await ingest([first,second,risk,bad]);review=(await feedbackOverview(pool,owner,version.id)).validations.find(v=>v.recordId==='bad-risk');
    await assert.rejects(approveFeedbackReview(pool,owner,{validationId:review.validationId,confirmed:true,reason:'拒绝不能放行'}),{status:409});
    const paused=raw('paused',90,baseTime+11000,{'当前情况':{name:'已暂停'}});await ingest([first,second,paused]);review=(await feedbackOverview(pool,owner,version.id)).validations.find(v=>v.recordId==='paused');await assert.rejects(approveFeedbackReview(pool,owner,{validationId:review.validationId,confirmed:true,reason:'含义尚未确认'}),{status:409});
    await ingest([first,second,raw('hundred',100,baseTime+5000)]);
  });
  await t.test('parallel imports serialize and revoked actor cannot commit fetched records',async()=>{
    let enter,release;const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;});
    const pending=refreshFeedback(pool,owner,{sourceId:registered.id,versionId:version.id,reason:'并发读取'},source,async()=>{enter();await gate;return [first,second];});
    await entered;await assert.rejects(refreshFeedback(pool,owner,{sourceId:registered.id,versionId:version.id,reason:'另一并发读取'},source,async()=>[first]),{status:409});release();await pending;
    const before=await count('feedback_records');
    try{await assert.rejects(refreshFeedback(pool,owner,{sourceId:registered.id,versionId:version.id,reason:'读取期间降权'},source,async()=>{await pool.query("UPDATE access_grants SET role='viewer' WHERE person_id=$1",[owner.id]);return [raw('revoked',90,baseTime+8000)];}),{status:403});}finally{await pool.query("UPDATE access_grants SET role='owner' WHERE person_id=$1",[owner.id]);}
    assert.equal(await count('feedback_records'),before);await ingest([first,second,raw('hundred',100,baseTime+5000)]);
  });
  await t.test('read metadata follows current role even when caller retains an older owner snapshot',async()=>{
    try{await pool.query("UPDATE access_grants SET role='viewer' WHERE person_id=$1",[owner.id]);const overview=await feedbackOverview(pool,owner,version.id);assert.equal('sources' in overview,false);assert.equal('people' in overview,false);}finally{await pool.query("UPDATE access_grants SET role='owner' WHERE person_id=$1",[owner.id]);}
  });
  await t.test('tracking pause and mapping recovery pending remove current eligibility',async()=>{
    await pool.query("UPDATE managed_versions SET lifecycle='stopped'");assert.equal((await current()).progressPercent,null);await pool.query("UPDATE managed_versions SET lifecycle='enrolled'");
    await pool.query("UPDATE status_mappings SET recovery='pending'");assert.equal((await current()).progressPercent,null);await pool.query("UPDATE status_mappings SET recovery='verified'");assert.equal((await current()).progressPercent,100);
    await pool.query('UPDATE tracking_periods SET ended_at=now()');assert.equal((await current()).progressPercent,null);await pool.query('UPDATE tracking_periods SET ended_at=null');
  });
  await t.test('HTTP anonymous/viewer/CSRF rejection and no public raw-upload endpoint',async()=>{
    const config={origin:'http://127.0.0.1',loginEnabled:true,dingtalk:{corpId:'fake'},teambition:{projectId:project}};server=createApplication(pool,config,{source,feedbackReader:async()=>records});await new Promise(r=>server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+server.address().port;
    const view=await establishSession(pool,{corpId:'fake',unionId:'viewer'}),own=await establishSession(pool,{corpId:'fake',unionId:'owner'});view.csrf=(await authenticate(pool,view.token)).csrf;own.csrf=(await authenticate(pool,own.token)).csrf;
    const request=(path,session,method='GET',body,csrf=true)=>fetch(config.origin+path,{method,headers:{...(session?{cookie:'vpm_session='+session.token}:{}),...(method==='POST'?{'Content-Type':'application/json',Origin:config.origin,'x-csrf-token':csrf?session.csrf:''}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await request('/api/feedback/versions/'+version.id)).status,401);
    const response=await request('/api/feedback/versions/'+version.id,view);assert.equal(response.status,200);assert.equal('people' in await response.json(),false);
    assert.equal((await request('/api/feedback/read',view,'POST',{})).status,403);assert.equal((await request('/api/feedback/configure',view,'POST',{})).status,403);assert.equal((await request('/api/feedback/read',own,'POST',{},false)).status,403);
    assert.equal((await request('/api/feedback/read',own,'POST',{sourceId:registered.id,versionId:version.id,reason:'伪造原始反馈',records:[]})).status,400);
    records=[first,second];assert.equal((await request('/api/feedback/read',own,'POST',{sourceId:registered.id,versionId:version.id,reason:'HTTP 受控读取'})).status,200);
    assert.equal((await request('/api/feedback/versions/'+version.id+'?offset=-1',own)).status,400);
    if(process.env.VIKINGPM_BROWSER_CHECK==='1') {
      const {chromium}=await import(process.env.VIKINGPM_PLAYWRIGHT_MODULE??'playwright');
      const browser=await chromium.launch({channel:'chrome',headless:true});
      try {
        for(const [session,admin] of [[own,true],[view,false]]) {
          const context=await browser.newContext({viewport:{width:1280,height:900}});
          await context.addCookies([{name:'vpm_session',value:session.token,url:config.origin}]);const page=await context.newPage();
          await page.goto(config.origin);await page.locator('#feedback-section').waitFor({state:'visible'});
          await page.waitForFunction(()=>document.getElementById('fb-count').textContent.includes('条有效历史'));
          assert.equal(await page.locator('#fb-admin').isVisible(),admin);assert.match(await page.locator('#fb-current').innerText(),/70%/);
          if(admin){await page.getByText('确认反馈来源（只读取现有表格）',{exact:true}).click();await page.locator('#fb-source-reason').fill('浏览器受控来源核对');await page.locator('#fb-base').fill('isolated-base');await page.locator('#fb-sheet').fill('isolated-sheet');await page.locator('#fb-source-confirm').check();await page.locator('#fb-source-form button').click();await page.waitForFunction(()=>document.getElementById('fb-message').textContent.includes('来源已保存'));}
          await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.TEMP+'/vikingpm-p06-'+(admin?'owner':'viewer')+'-390.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await context.close();
        }
      }finally{await browser.close();}
    }
  });
  await t.test('version views leave other current rows untouched and keep global identity ambiguity',async()=>{
    const other=await enrollVersion(pool,{corpId:'fake',projectId:project,projectName:'隔离项目',versionId:'e'.repeat(24),versionName:'另一隔离版本',ownerId:owner.id,reason:'跨版本范围回归'},owner.id);
    await syncVersion(pool,other.id,source.read,{actorId:owner.id,reason:'跨版本重复编号回归'});
    const otherRows=async()=>(await pool.query('SELECT c.* FROM current_feedback c JOIN work_items w ON w.id=c.work_item_id WHERE w.managed_version_id=$1 ORDER BY c.work_item_id',[other.id])).rows;
    const before=await otherRows();assert.equal(before.length,2);
    await ingest([first,second,raw('ambiguous',85,baseTime+7000)]);
    const checked=await otherRows();await feedbackOverview(pool,viewer,version.id);assert.deepEqual(await otherRows(),checked);
    assert.equal((await pool.query("SELECT work_item_id FROM feedback_records WHERE source_record_id='ambiguous'")).rows[0].work_item_id,null);
    assert.equal((await current()).progressPercent,70);
    await changePerson(pool,owner.id,people.worker.id,{mappingEnabled:false,reason:'全局身份撤销回归'},'identity');
    assert.notDeepEqual(await otherRows(),checked);
    assert.equal((await current()).progressPercent,null);
    await changePerson(pool,owner.id,people.worker.id,{mappingEnabled:true,reason:'全局身份恢复回归'},'identity');
    assert.equal((await current()).progressPercent,70);
  });
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();assert.match(schema,/^p06_[a-f0-9]{16}$/);await setup.query('DROP SCHEMA '+schema+' CASCADE');await setup.end();}
});
