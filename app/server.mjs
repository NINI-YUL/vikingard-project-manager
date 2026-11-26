import {configureFeedback,approveFeedbackReview,refreshFeedback,feedbackOverview,createFeedbackReader} from './feedback.mjs';
import {planNotifications,recordNotificationAttempt,notificationOverview} from './notifications.mjs';
import {managementCatalog,managementResults,changeManagement,verifyMappings} from './management.mjs';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { Denied, requireRole, authenticate, logout, listPeople, changePerson, createIdentity } from './security.mjs';
import { beginLogin, completeLogin } from './dingtalk.mjs';
import { enrollVersion, syncVersion } from './version-source.mjs';

const assets = new Map([['/', ['text/html; charset=utf-8','index.html']],['/acceptance', ['text/html; charset=utf-8','acceptance.html']],['/acceptance.html', ['text/html; charset=utf-8','acceptance.html']],['/app.js',['text/javascript; charset=utf-8','app.js']],['/shell.js',['text/javascript; charset=utf-8','shell.js']],['/shell.css',['text/css; charset=utf-8','shell.css']],['/function-catalog.mjs',['text/javascript; charset=utf-8','../function-catalog.mjs']],['/feedback-ui.js',['text/javascript; charset=utf-8','feedback-ui.js']],['/management-ui.js',['text/javascript; charset=utf-8','management-ui.js']],['/style.css',['text/css; charset=utf-8','style.css']]]);
assets.set('/management-forms.html', ['text/html; charset=utf-8', 'management-forms.html']);
for (const weight of [400, 500, 600, 700]) {
  assets.set(`/assets/jakarta-${weight}.ttf`, ['font/ttf', `assets/jakarta-${weight}.ttf`]);
}
function cookies(req) {
  const result = {};
  for (const item of (req.headers.cookie ?? '').split(';')) {
    const index = item.indexOf('=');
    if (index > 0) result[item.slice(0,index).trim()] = item.slice(index+1).trim();
  }
  return result;
}
function cookie(config,name,value,age) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.origin.startsWith('https:') ? '; Secure' : ''}`; }
function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
async function body(req,limit=8192) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Denied(415,'请使用 JSON 请求');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Denied(413,'请求过大'); chunks.push(chunk); }
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw 0; return parsed; }
  catch { throw new Denied(400,'请求格式错误'); }
}
export function createApplication(pool,config,{ loginResolver, source, feedbackReader } = {}) {
  const handle = async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if (config.origin.startsWith('https:')) res.setHeader('Strict-Transport-Security','max-age=86400');
    try {
      if (req.headers.host !== new URL(config.origin).host) throw new Denied(400,'访问地址不匹配');
      const url = new URL(req.url,config.origin), path = url.pathname, jar = cookies(req);
      if (req.method === 'GET' && assets.has(path)) {
        const [type,file] = assets.get(path);
        let content = readFileSync(new URL('public/'+file,import.meta.url));
        if (file === 'acceptance.html') content = content.toString('utf8').replace('<!-- management-forms -->', readFileSync(new URL('public/management-forms.html',import.meta.url), 'utf8'));
        res.writeHead(200,{'Content-Type':type}); return res.end(content);
      }
      if (req.method === 'GET' && path === '/healthz') {
        try { await pool.query('SELECT 1'); return json(res,200,{status:'ready',batch:'P09',loginEnabled:config.loginEnabled}); }
        catch { return json(res,503,{status:'unavailable'}); }
      }
      if (req.method === 'GET' && path === '/auth/dingtalk/start') {
        const login = await beginLogin(pool,config); res.writeHead(302,{Location:login.url,'Set-Cookie':cookie(config,'vpm_oauth',login.state,300)}); return res.end();
      }
      if (req.method === 'GET' && path === '/auth/dingtalk/callback') {
        // Clear authorization parameters immediately on both success and failure.
        let result;
        try { result = await completeLogin(pool,config,url.searchParams,jar.vpm_oauth,loginResolver); }
        catch (error) {
          const status = error instanceof Denied ? error.status : 503;
          res.writeHead(303,{Location:'/?login='+String(status),'Set-Cookie':cookie(config,'vpm_oauth','',0)}); return res.end();
        }
        res.writeHead(303,{Location:'/','Set-Cookie':[cookie(config,'vpm_oauth','',0),cookie(config,'vpm_session',result.token,28800)]}); return res.end();
      }
      const actor = config.loginEnabled ? await authenticate(pool,jar.vpm_session) : null;
      requireRole(actor,'viewer');
      if (!['GET','HEAD'].includes(req.method)) {
        if (req.headers.origin !== config.origin || req.headers['x-csrf-token'] !== actor.csrf) throw new Denied(403,'请求来源或会话校验失败');
      }
      const feedbackTarget=path.match(/^\/api\/feedback\/versions\/([0-9a-f-]{36})$/i);
      if(req.method==='GET'&&feedbackTarget)return json(res,200,await feedbackOverview(pool,actor,feedbackTarget[1],Number(url.searchParams.get('offset')??0)));
      const noticeTarget=path.match(/^\/api\/notifications\/versions\/([0-9a-f-]{36})$/i);
      if(req.method==='GET'&&noticeTarget)return json(res,200,await notificationOverview(pool,actor,noticeTarget[1]));
      if(req.method==='POST'&&path==='/api/notifications/plan'){requireRole(actor,'admin');const value=await body(req);if(Object.keys(value).some(k=>!['versionId','formBaseUrl'].includes(k)))throw new Denied(400,'通知计划字段不合法');return json(res,200,await planNotifications(pool,actor,value.versionId,value.formBaseUrl));}
      if(req.method==='POST'&&path==='/api/notifications/attempt'){requireRole(actor,'admin');const value=await body(req);if(Object.keys(value).some(k=>!['jobId','result','detail'].includes(k)))throw new Denied(400,'通知结果字段不合法');return json(res,200,await recordNotificationAttempt(pool,actor,value.jobId,value.result,value.detail??''));}
      if(req.method==='POST'&&path==='/api/feedback/configure'){
        requireRole(actor,'admin');return json(res,200,await configureFeedback(pool,actor,await body(req),config.teambition?[config.teambition.projectId]:[]));
      }
      if(req.method==='POST'&&path==='/api/feedback/approve'){
        requireRole(actor,'admin');return json(res,200,await approveFeedbackReview(pool,actor,await body(req)));
      }
      if(req.method==='POST'&&path==='/api/feedback/read'){
        requireRole(actor,'admin');const input=await body(req);
        if(Object.keys(input).some(k=>!['sourceId','versionId','reason'].includes(k)))throw new Denied(400,'反馈读取字段不合法');
        return json(res,200,await refreshFeedback(pool,actor,input,source,feedbackReader??createFeedbackReader(config)));
      }
      if(req.method==='GET'&&path==='/api/management')return json(res,200,await managementCatalog(pool));
      const managementVersion=path.match(/^\/api\/management\/versions\/([0-9a-f-]{36})$/i);
      if(req.method==='GET'&&managementVersion)return json(res,200,await managementResults(pool,managementVersion[1]));
      if(req.method==='POST'&&['/api/management/preview','/api/management/save','/api/management/verify'].includes(path)){
        requireRole(actor,'admin');const input=await body(req,131072);
        return json(res,200,path.endsWith('/verify')?await verifyMappings(pool,actor,input):await changeManagement(pool,actor,input,path.endsWith('/save')));
      }
      if (req.method === 'GET' && path === '/api/me') return json(res,200,actor);
      if (req.method === 'GET' && path === '/api/status') return json(res,200,{batch:'P09',sourceConfigured:Boolean(source),pollingEnabled:Boolean(config.teambition?.pollingEnabled),message:'P09 正式页面壳、真实版本列表与任务下钻已接入；完整管理页面仍在开发。'});
      if (req.method === 'GET' && path === '/api/version-people') {
        requireRole(actor,'admin');
        return json(res,200,(await pool.query('SELECT p.id,p.display_name AS "displayName" FROM people p JOIN identity_mappings i ON i.person_id=p.id WHERE p.active AND i.enabled AND i.confirmed AND i.corp_id=$1 ORDER BY p.display_name,p.id',[config.dingtalk.corpId])).rows);
      }
      if (req.method === 'GET' && path === '/api/source-candidates') {
        requireRole(actor,'admin');
        if (!source) return json(res,200,[]);
        if (source.listVersions) return json(res,200,await source.listVersions());
        const choices=[];
        for (const group of source.candidates ?? []) for (const versionId of group.versionIds) choices.push(await source.getVersion(group.projectId,versionId));
        return json(res,200,choices);
      }
      if (req.method === 'GET' && path === '/api/versions') {
        const rows = await pool.query(`SELECT v.id,v.source_version_id AS "sourceVersionId",v.display_name AS "displayName",v.lifecycle,v.sync_start_at AS "syncStartAt",v.enrolled_at AS "enrolledAt",v.owner_id AS "ownerId",person.display_name AS "ownerName",p.teambition_project_id AS "projectId",p.display_name AS "projectName",s.last_status AS "syncStatus",s.last_success_at AS "lastSuccessAt",s.last_error_code AS "lastErrorCode",s.next_due_at AS "nextDueAt",s.failure_count AS "failureCount",EXISTS(SELECT 1 FROM identity_mappings oi JOIN people op ON op.id=oi.person_id WHERE oi.person_id=v.owner_id AND oi.enabled AND oi.confirmed AND op.active AND oi.corp_id=p.corp_id) AS "ownerConfirmed",b.unique_id_prefix AS "uniqueIdPrefix",p.config_version AS "configVersion",b.verified_at AS "bindingVerifiedAt" FROM managed_versions v JOIN source_projects p ON p.id=v.source_project_id LEFT JOIN people person ON person.id=v.owner_id LEFT JOIN source_sync_states s ON s.managed_version_id=v.id LEFT JOIN source_bindings b ON b.source_project_id=p.id ORDER BY v.enrolled_at,v.id`);
        return json(res,200,rows.rows);
      }
      if (req.method === 'POST' && path === '/api/versions') {
        requireRole(actor,'admin');
        const value = await body(req);
        if (Object.keys(value).some(k=>!['projectId','versionId','ownerId','reason'].includes(k)) || !/^[a-f0-9]{24}$/.test(value.projectId ?? '') || !/^[a-f0-9]{24}$/.test(value.versionId ?? '') || typeof value.reason!=='string' || !value.reason.trim() || value.reason.length>500) throw new Denied(400,'请核对项目、迭代和纳入原因');
        if (!source) throw new Denied(503,'来源读取尚未配置');
        const verified = await (source.getSelectableVersion ? source.getSelectableVersion(value.projectId,value.versionId) : source.getVersion(value.projectId,value.versionId));
        return json(res,201,await enrollVersion(pool,{...verified,corpId:config.dingtalk.corpId,ownerId:value.ownerId,reason:value.reason},actor.id));
      }
      const taskTarget = path.match(/^\/api\/versions\/([0-9a-f-]{36})\/tasks$/i);
      if (req.method === 'GET' && taskTarget) {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if (!Number.isSafeInteger(offset) || offset<0 || offset>10000) throw new Denied(400,'分页参数不合法');
        if (!(await pool.query('SELECT 1 FROM managed_versions WHERE id=$1',[taskTarget[1]])).rowCount) throw new Denied(404,'版本不存在');
        const total=(await pool.query('SELECT count(*)::int AS count FROM work_items WHERE managed_version_id=$1',[taskTarget[1]])).rows[0].count;
        const rows=await pool.query(`SELECT w.source_task_id AS "sourceTaskId",w.visible_key AS "visibleKey",w.title,w.type_name AS "typeName",w.category,w.function_name AS "functionName",w.function_resolution AS "functionResolution",w.parent_source_task_id AS "parentSourceTaskId",parent.visible_key AS "parentVisibleKey",w.source_status_id AS "sourceStatusId",w.raw_status AS "rawStatus",w.availability,w.source_presence AS "sourcePresence",w.history_status AS "historyStatus",w.structure_issues AS "structureIssues",w.last_synced_at AS "lastSyncedAt" FROM work_items w LEFT JOIN work_items parent ON parent.managed_version_id=w.managed_version_id AND parent.source_task_id=w.parent_source_task_id WHERE w.managed_version_id=$1 ORDER BY w.source_task_id LIMIT 100 OFFSET $2`,[taskTarget[1],offset]);
        return json(res,200,{items:rows.rows,total,nextOffset:offset+rows.rowCount<total ? offset+rows.rowCount : null});
      }
      const historyTarget=path.match(/^\/api\/versions\/([0-9a-f-]{36})\/tasks\/([a-zA-Z0-9_-]{1,200})\/history$/);
      if(req.method==='GET' && historyTarget) {
        const kind=url.searchParams.get('kind') ?? 'activities',offset=Number(url.searchParams.get('offset')??0);
        if(!['activities','observations'].includes(kind)||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new Denied(400,'历史分页参数不合法');
        const found=(await pool.query('SELECT w.id,v.source_project_id FROM work_items w JOIN managed_versions v ON v.id=w.managed_version_id WHERE w.managed_version_id=$1 AND w.source_task_id=$2',[historyTarget[1],historyTarget[2]])).rows[0];
        if(!found)throw new Denied(404,'任务不存在');
        let result,total;
        if(kind==='activities') {
          total=(await pool.query('SELECT count(*)::int AS count FROM source_activities WHERE source_project_id=$1 AND source_task_id=$2',[found.source_project_id,historyTarget[2]])).rows[0].count;
          result=await pool.query('SELECT source_activity_id AS "sourceActivityId",revision_hash AS "revisionHash",action,occurred_at AS "occurredAt",source_updated_at AS "sourceUpdatedAt",fetched_at AS "fetchedAt" FROM source_activities WHERE source_project_id=$1 AND source_task_id=$2 ORDER BY occurred_at,source_activity_id,revision_hash LIMIT 100 OFFSET $3',[found.source_project_id,historyTarget[2],offset]);
        } else {
          total=(await pool.query('SELECT count(*)::int AS count FROM source_observations WHERE work_item_id=$1',[found.id])).rows[0].count;
          result=await pool.query('SELECT observed_at AS "observedAt",source_updated_at AS "sourceUpdatedAt",facts FROM source_observations WHERE work_item_id=$1 ORDER BY observed_at,id LIMIT 100 OFFSET $2',[found.id,offset]);
        }
        return json(res,200,{kind,total,items:result.rows,nextOffset:offset+result.rowCount<total?offset+result.rowCount:null});
      }
      const syncTarget = path.match(/^\/api\/versions\/([0-9a-f-]{36})\/sync$/i);
      if (req.method === 'POST' && syncTarget) {
        requireRole(actor,'admin');
        const value=await body(req);
        if (Object.keys(value).some(k=>k!=='reason')) throw new Denied(400,'同步字段不合法');
        if (!source) throw new Denied(503,'来源读取尚未配置');
        return json(res,200,await syncVersion(pool,syncTarget[1],binding=>{
          if (binding.corpId!==config.dingtalk.corpId) throw new Error('来源企业不匹配');
          return source.read(binding);
        },{actorId:actor.id,reason:value.reason,intervalSeconds:config.teambition?.pollIntervalSeconds??900}));
      }
      if (req.method === 'POST' && path === '/auth/logout') {
        await logout(pool,jar.vpm_session); res.setHeader('Set-Cookie',cookie(config,'vpm_session','',0)); return json(res,200,{ok:true});
      }
      if (req.method === 'GET' && path === '/api/access') { requireRole(actor,'owner'); return json(res,200,await listPeople(pool,actor.id)); }
      if (req.method === 'GET' && path === '/api/audit') {
        requireRole(actor,'admin');
        const events = await pool.query('SELECT id,actor_id,subject_id,action,before_value,after_value,reason,occurred_at FROM audit_events ORDER BY id DESC LIMIT 100');
        return json(res,200,events.rows);
      }
      if (req.method === 'POST' && path === '/api/identities') {
        requireRole(actor,'admin');
        return json(res,201,await createIdentity(pool,actor.id,await body(req),config.dingtalk.corpId));
      }
      const target = path.match(/^\/api\/(access|identities)\/([0-9a-f-]+)$/i);
      if (req.method === 'PATCH' && target) {
        const kind = target[1] === 'access' ? 'access' : 'identity';
        requireRole(actor,kind === 'access' ? 'owner' : 'admin');
        return json(res,200,await changePerson(pool,actor.id,target[2],await body(req),kind));
      }
      throw new Denied(404,'入口不存在');
    } catch (error) {
      // Fixed messages only: pg and provider errors may contain connection credentials or auth codes.
      if (!res.headersSent) json(res,error instanceof Denied ? error.status : 503,{error:error instanceof Denied ? error.message : '服务暂不可用，请联系管理员'});
      else res.end();
    }
  };
  const server = config.origin.startsWith('https:') ? httpsServer({cert:readFileSync(config.tls.certPath),key:readFileSync(config.tls.keyPath)},handle) : httpServer(handle);
  server.requestTimeout = 20000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 50;
  return server;
}
