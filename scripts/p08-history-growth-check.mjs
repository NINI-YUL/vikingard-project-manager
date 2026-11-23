import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import os from 'node:os';
import {readJson} from '../app/config.mjs';
import {poolFor,transaction} from '../app/database.mjs';
import {establishSession} from '../app/security.mjs';
import {enrollVersion,syncVersion} from '../app/version-source.mjs';
import {revalidateFeedback} from '../app/feedback-state.mjs';
import {createApplication} from '../app/server.mjs';
import {resourceFixture} from './p08-resource-check.mjs';

// SQL fixtures model retained history size, not ingestion throughput or archive behavior.
const directory=resolve(process.env.VIKINGPM_RESOURCE_OUTPUT),prior=readJson(join(directory,'report.json')),recovery=readJson(join(directory,'recovery-report.json')),config=readJson(process.env.VIKINGPM_TEST_CONFIG);
assert.equal(config.database,'vikingpm_p01p02_test');assert.equal(config.user,'vikingpm_migrator');assert.equal(config.host,'127.0.0.1');assert.equal(config.port,55432);
assert.equal(recovery.database,prior.database);assert.equal(recovery.snapshotMatch,true);assert.equal(recovery.restoreDb.startsWith(prior.database+'_r_'),true);assert(/^vikingpm_p08_[a-z0-9_]+$/.test(recovery.restoreDb));
const report={startedAt:new Date().toISOString(),database:recovery.restoreDb,scope:'synthetic retained history in isolated restored database',externalWrites:false,stages:[],status:'running'};
const save=()=>writeFileSync(join(directory,'history-growth-report.json'),JSON.stringify(report,null,2));
const pool=poolFor({...config,database:recovery.restoreDb});let server;
try {
 const versions=(await pool.query("SELECT id FROM managed_versions WHERE lifecycle='enrolled' ORDER BY display_name")).rows;assert.equal(versions.length,6);
 assert.equal(Number((await pool.query('SELECT count(*) AS n FROM feedback_revisions')).rows[0].n),2500,'use a fresh restored fixture');
 const owner=(await pool.query("SELECT p.id FROM people p JOIN identity_mappings i ON i.person_id=p.id WHERE i.union_id='owner'")).rows[0];
 const original=(await pool.query('SELECT work_item_id,history_id,state,reasons FROM current_feedback ORDER BY work_item_id')).rows;assert.equal(original.length,6000);
 const origin='http://127.0.0.1:43193',sessions=[];for(let i=0;i<10;i++)sessions.push(await establishSession(pool,{corpId:'resource-test',unionId:'viewer'+i}));
 server=createApplication(pool,{origin,host:'127.0.0.1',port:43193,loginEnabled:true,dingtalk:{corpId:'resource-test'}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(43193,'127.0.0.1',resolve);});
 const measure=async label=>{
  const requests=[];
  for(let round=0;round<2;round++)await Promise.all(sessions.map(async(session,i)=>{for(const kind of ['versions','management','feedback']){
   const path=kind==='versions'?'/api/versions':'/api/'+kind+'/versions/'+versions[i%6].id,start=performance.now();
   try{const response=await fetch(origin+path,{headers:{Cookie:'vpm_session='+session.token,Connection:'close'},signal:AbortSignal.timeout(30000)});await response.arrayBuffer();requests.push({kind,status:response.status,ms:Math.round(performance.now()-start)});}catch{requests.push({kind,status:0,ms:Math.round(performance.now()-start)});}
  }}));
  const stage={label,requests,errors:requests.filter(r=>r.status!==200).length,counts:(await pool.query('SELECT (SELECT count(*)::int FROM managed_versions) AS versions,(SELECT count(*)::int FROM work_items) AS tasks,(SELECT count(*)::int FROM feedback_revisions) AS revisions,(SELECT count(*)::int FROM valid_feedback_history) AS history,pg_database_size(current_database())::float8 AS "databaseBytes"')).rows[0],rss:process.memoryUsage().rss,freeBytes:os.freemem()};
  report.stages.push(stage);save();console.log(JSON.stringify({label,errors:stage.errors,counts:stage.counts}));assert.equal(stage.errors,0);
  assert.deepEqual((await pool.query('SELECT work_item_id,history_id,state,reasons FROM current_feedback WHERE work_item_id=ANY($1::uuid[]) ORDER BY work_item_id',[original.map(r=>r.work_item_id)])).rows,original);
  assert(stage.rss<1024**3&&stage.freeBytes>1024**3,'resource headroom stop');
 };
 await measure('restored-baseline');
 for(let i=0;i<6;i++){
  const version=await enrollVersion(pool,{corpId:'resource-test',projectId:'a'.repeat(24),projectName:'构造项目',versionId:(9001000+i).toString(16).padStart(24,'0'),versionName:'虚构历史版本'+i,ownerId:owner.id,reason:'隔离历史规模构造'},owner.id);
  assert.equal((await syncVersion(pool,version.id,async()=>resourceFixture(i,1000),{actorId:owner.id,reason:'隔离历史任务构造'})).status,'succeeded');
  await transaction(pool,async client=>{await client.query('SELECT id FROM security_state WHERE id=1 FOR UPDATE');await client.query("UPDATE managed_versions SET lifecycle='ended' WHERE id=$1",[version.id]);await client.query('UPDATE tracking_periods SET ended_at=clock_timestamp() WHERE managed_version_id=$1 AND ended_at IS NULL',[version.id]);await revalidateFeedback(client);});
 }
 assert.equal(Number((await pool.query("SELECT count(*) AS n FROM managed_versions WHERE lifecycle='enrolled'")).rows[0].n),6);
 await measure('retained-versions');
 for(const target of [25000,100000]){
  let count=Number((await pool.query('SELECT count(*) AS n FROM feedback_revisions')).rows[0].n);
  while(count<target){
   const batch=Math.min(5000,target-count);report.phase='construct-history-'+target;save();
   await transaction(pool,async client=>{
   await client.query(`CREATE TEMP TABLE growth_rows ON COMMIT DROP AS SELECT gen_random_uuid() AS revision_id,gen_random_uuid() AS validation_id,gen_random_uuid() AS history_id,r.id AS record_id,v.raw_source,h.work_item_id,h.submitted_at,h.progress_percent,h.situation,h.note,h.submitter_id FROM feedback_records r JOIN feedback_revisions v ON v.id=r.latest_revision_id JOIN valid_feedback_history h ON h.revision_id=v.id CROSS JOIN generate_series(1,$1::int) g LIMIT $2`,[Math.ceil(batch/50),batch]);
   await client.query("INSERT INTO feedback_revisions(id,record_id,revision_hash,raw_source,observed_at) SELECT revision_id,record_id,'synthetic-growth-'||revision_id,raw_source,clock_timestamp()-interval '1 day' FROM growth_rows");
   await client.query("INSERT INTO feedback_validations(id,revision_id,context_hash,verdict,reasons,progress_percent) SELECT validation_id,revision_id,'synthetic-growth','valid','[]'::jsonb,progress_percent FROM growth_rows");
   await client.query('INSERT INTO valid_feedback_history(id,work_item_id,validation_id,revision_id,submitted_at,progress_percent,situation,note,submitter_id) SELECT history_id,work_item_id,validation_id,revision_id,submitted_at,progress_percent,situation,note,submitter_id FROM growth_rows');
   });
   count+=batch;
  }
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM feedback_revisions')).rows[0].n),target);
  await pool.query('ANALYZE');await measure('history-'+target);
 }
 report.status='bounded-history-passed';
}catch(error){report.status='failed';report.errorType=error.name;report.safeCode=/^[A-Z0-9_]+$/.test(error.code??'')?error.code:null;process.exitCode=1;}
finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,stages:report.stages.map(s=>({label:s.label,errors:s.errors}))}));}
