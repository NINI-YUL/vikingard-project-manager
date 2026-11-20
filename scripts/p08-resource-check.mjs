import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import {readJson} from '../app/config.mjs';
import {poolFor,migrate,transaction} from '../app/database.mjs';
import {bootstrap,establishSession} from '../app/security.mjs';
import {enrollVersion,syncVersion} from '../app/version-source.mjs';
import {configureFeedback} from '../app/feedback.mjs';
import {persistFeedback} from '../app/feedback-state.mjs';
import {createApplication} from '../app/server.mjs';
import {fingerprint} from './backup-to-share.mjs';

const project='a'.repeat(24),corp='resource-test',execute=promisify(execFile);
const hex=n=>n.toString(16).padStart(24,'0');
export function resourceFixture(versionIndex,taskCount){
 assert(Number.isInteger(versionIndex)&&versionIndex>=0&&versionIndex<6);
 assert(Number.isInteger(taskCount)&&taskCount>=5&&taskCount<=1000);
 const items=Array.from({length:taskCount},(_,j)=>{
  const number=versionIndex*100000+j+1,id=hex(number),root=j<5;
  return {sourceTaskId:id,visibleKey:String(number),title:(root?'需求':'专业子单')+number,typeName:root?'需求':'子需求',functionName:root?undefined:['UI界面','数值','客户端','服务端','KGUI'][j%5],parentSourceTaskId:root?undefined:hex(versionIndex*100000+(j%5)+1),sourceStatusId:'active',status:'进行中',executorSourceId:'tb-owner',isDone:false,rawSource:{id,projectId:project,uniqueId:number,isArchived:false}};
 });
 return {items,activities:[],binding:{uniqueIdPrefix:'load',organizationId:corp,categoryFieldId:'category',functionFieldId:'function',typeNames:{root:'需求',child:'子需求'},statusNames:{active:'进行中'}}};
}
const summary=values=>{const a=[...values].sort((x,y)=>x-y);return {count:a.length,min:a[0]??null,p50:a[Math.floor((a.length-1)*.5)]??null,p95:a[Math.ceil((a.length-1)*.95)]??null,max:a.at(-1)??null};};
export async function runResourceCheck(){
 const config=readJson(process.env.VIKINGPM_TEST_CONFIG);assert.equal(config.database,'vikingpm_p01p02_test');assert.equal(config.user,'vikingpm_migrator');assert.equal(config.host,'127.0.0.1');assert.equal(config.port,55432);
 const runId=Date.now().toString(36)+'_'+randomBytes(3).toString('hex'),database='vikingpm_p08_'+runId,restoreDb=database+'_restore';
 assert(/^vikingpm_p08_[a-z0-9_]+$/.test(database)&&database!==config.database);
 const output=resolve(process.env.VIKINGPM_RESOURCE_OUTPUT??'F:/VikingPM/logs/p08-resource-'+runId);mkdirSync(output,{recursive:true});
 const report={runId,startedAt:new Date().toISOString(),pid:process.pid,database,restoreDb,scope:'synthetic local only',stages:[],externalWrites:false,notificationsSent:0,retainedDatabases:[],samples:[],status:'running'};
 const save=()=>writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
 const phase=name=>{report.phase=name;save();console.log(JSON.stringify({phase:name}));};
 let admin,pool,server,timer,stage='prepare';
 const processors=os.cpus().length;let last=os.cpus(),lastAt=performance.now(),lastCpu=process.cpuUsage();
 function sample(){const now=performance.now(),cpus=os.cpus(),usage=process.cpuUsage(),total=cpus.reduce((a,c,i)=>a+Object.keys(c.times).reduce((n,k)=>n+c.times[k]-last[i].times[k],0),0),idle=cpus.reduce((n,c,i)=>n+c.times.idle-last[i].times.idle,0);report.samples.push({phase:report.phase,at:new Date().toISOString(),freeBytes:os.freemem(),rss:process.memoryUsage().rss,systemCpuPct:total?100*(1-idle/total):0,processCpuPct:100*(usage.user+usage.system-lastCpu.user-lastCpu.system)/1000/(now-lastAt)/processors});last=cpus;lastAt=now;lastCpu=usage;}
 const time=async work=>{const start=performance.now();const value=await work();return {value,ms:Math.round(performance.now()-start)};};
 try{
  admin=poolFor({host:config.host,port:config.port,database:'postgres',user:'vikingpm_admin',password:readFileSync('F:/VikingPM/security/postgres-admin.password','utf8').trim()});
  phase('create-isolated-database');await admin.query('SET statement_timeout=60000');
  await admin.query('CREATE DATABASE '+database+' OWNER vikingpm_migrator');report.retainedDatabases.push(database);await admin.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');
  phase('migrate');pool=poolFor({...config,database});await migrate(pool);
  await bootstrap(pool,{confirmed:true,corpId:corp,reason:'隔离资源首评',people:[{displayName:'虚构所有者',unionId:'owner',role:'owner'},...Array.from({length:10},(_,i)=>({displayName:'虚构查看者'+i,unionId:'viewer'+i,role:'viewer'}))]},corp);
  const people=(await pool.query('SELECT p.id,i.union_id FROM people p JOIN identity_mappings i ON i.person_id=p.id')).rows,owner=people.find(x=>x.union_id==='owner');
  const versions=[];
  for(let i=0;i<6;i++)versions.push(await enrollVersion(pool,{corpId:corp,projectId:project,projectName:'构造项目',versionId:hex(9000000+i),versionName:'构造版本'+i,ownerId:owner.id,reason:'隔离资源测试'},owner.id));
  const createdTime=Date.now()-10000;await pool.query('UPDATE tracking_periods SET started_at=$1',[new Date(createdTime-1000)]);
  const projectId=(await pool.query('SELECT id FROM source_projects')).rows[0].id;
  await pool.query("INSERT INTO status_mappings(source_project_id,status_id,semantic,recovery) VALUES($1,'active','developing','verified')",[projectId]);
  const sourceId=(await configureFeedback(pool,owner,{kind:'source',projectId,baseId:'synthetic',sheetId:'synthetic',enabled:true,confirmed:true,reason:'虚构来源'},[project])).id;
  const origin='http://127.0.0.1:43191';
  server=createApplication(pool,{origin,host:'127.0.0.1',port:43191,loginEnabled:true,dingtalk:{corpId:corp}},{source:undefined});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(43191,'127.0.0.1',resolve);});
  const sessions=[];for(let i=0;i<10;i++)sessions.push(await establishSession(pool,{corpId:corp,unionId:'viewer'+i}));
  const request=async(path,session)=>{const start=performance.now();const r=await fetch(origin+path,{headers:session?{Cookie:'vpm_session='+session.token}:{},signal:AbortSignal.timeout(30000)});const body=await r.json();return {status:r.status,ms:Math.round(performance.now()-start),body};};
  assert.equal((await request('/api/versions')).status,401);
  timer=setInterval(sample,1000);timer.unref();phase('prepared');
  let records=[];
  const concurrent=async(users,label)=>{const values=[];let errors=0;
   for(let round=0;round<2;round++)await Promise.all(sessions.slice(0,users).map(async(session,i)=>{for(const path of ['/api/versions','/api/management/versions/'+versions[i%6].id,'/api/feedback/versions/'+versions[i%6].id]){try{const r=await request(path,session);values.push(r.ms);if(r.status!==200)errors++;}catch{errors++;}}}));
   const measured={label,users,errors,latencyMs:summary(values)};report.stages.push(measured);save();assert.equal(errors,0,'HTTP failures');return measured;
  };
  for(const total of [300,1500,6000]){
   stage='tier-'+total;phase(stage);const count=total/6;
   const sync=await time(async()=>{for(let i=0;i<6;i++){const result=await syncVersion(pool,versions[i].id,async()=>resourceFixture(i,count),{actorId:owner.id,reason:'构造来源资源测量'});assert.equal(result.status,'succeeded');}});
   assert.equal(Number((await pool.query('SELECT count(*) AS n FROM work_items')).rows[0].n),total);
   if(total===300){
    await configureFeedback(pool,owner,{kind:'executor',projectId,executorId:'tb-owner',personId:owner.id,enabled:true,confirmed:true,reason:'虚构身份映射'},[project]);
    const tasks=(await pool.query("SELECT visible_key,title FROM work_items WHERE type_name='子需求' ORDER BY visible_key LIMIT 50")).rows;
    const source=(await pool.query('SELECT * FROM feedback_sources WHERE id=$1',[sourceId])).rows[0];
    for(const density of [1,10,50]){phase('history-'+density);const ingestion=await time(async()=>{const begin=records.length?density===10?1:10:0;for(let revision=begin;revision<density;revision++){
     records=tasks.map((t,i)=>({id:'fixture-'+i,createdTime,createdBy:{unionId:'owner'},fields:{'TB工单id':'load-'+t.visible_key,'任务':t.title,'提交人':{unionId:'owner'},'当前进度百分比':revision/100,'当前情况':{name:'进度正常'}}}));
     await transaction(pool,async client=>{await client.query('SELECT id FROM security_state WHERE id=1 FOR UPDATE');await persistFeedback(client,source,records);});
    }});
    const revisions=Number((await pool.query('SELECT count(*) AS n FROM feedback_revisions')).rows[0].n);assert.equal(revisions,50*density);
    report.stages.push({label:'history',density,revisions,ms:ingestion.ms});save();
    }
   }
   phase(stage+'-queries');report.stages.push({label:'sync',tasks:total,ms:sync.ms});
   for(const users of total===300?[1,5,10]:[10])await concurrent(users,stage);
   const dbBytes=Number((await pool.query('SELECT pg_database_size(current_database()) AS n')).rows[0].n);report.stages.push({label:'size',tasks:total,dbBytes});save();
   if(process.memoryUsage().rss>1024**3||os.freemem()<1024**3)throw Error('resource headroom stop');
  }
  phase('restart');await new Promise(resolve=>server.close(resolve));server=null;await pool.end();pool=poolFor({...config,database});
  const restart=await time(async()=>{server=createApplication(pool,{origin,host:'127.0.0.1',port:43191,loginEnabled:true,dingtalk:{corpId:corp}});await new Promise(resolve=>server.listen(43191,'127.0.0.1',resolve));assert.equal((await request('/api/versions',sessions[0])).status,200);});report.stages.push({label:'application-reconnect',ms:restart.ms});
  phase('backup');const dump=join(output,'synthetic.dump');const expected=await fingerprint(pool);
  const run=async(tool,args)=>{const result=await execute('F:/VikingPM/runtime/pgsql/bin/'+tool+'.exe',args,{windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,PGPASSWORD:config.password,PGCONNECT_TIMEOUT:'10'}});assert.equal(result.stderr.trim(),'','backup warning');};
  const common=['--host=127.0.0.1','--port=55432','--username='+config.user,'--no-password'];
  const backup=await time(()=>run('pg_dump',[...common,'--dbname='+database,'--format=custom','--exclude-table-data=public.login_sessions','--exclude-table-data=public.oauth_requests','--file='+dump]));
  await admin.query('CREATE DATABASE '+restoreDb+' OWNER vikingpm_migrator');report.retainedDatabases.push(restoreDb);await admin.query('REVOKE ALL ON DATABASE '+restoreDb+' FROM PUBLIC');
  const restore=await time(()=>run('pg_restore',[...common,'--dbname='+restoreDb,'--no-owner','--single-transaction','--exit-on-error',dump]));
  const restored=poolFor({...config,database:restoreDb});try{assert.deepEqual(await fingerprint(restored),expected);assert.equal(Number((await restored.query('SELECT count(*) AS n FROM login_sessions')).rows[0].n),0);}finally{await restored.end();}
  report.stages.push({label:'backup-restore',backupMs:backup.ms,restoreMs:restore.ms,bytes:statSync(dump).size,exactMatch:true,sessionsExcluded:true});
  report.status='passed';
 }catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.name;report.safeCode=typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:null;process.exitCode=1;}
 finally{clearInterval(timer);sample();if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();await admin?.end();report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,failedStage:report.failedStage,output,stages:report.stages}));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await runResourceCheck();
