import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { Denied, requireRole, authenticate, logout, listPeople, changePerson, createIdentity } from './security.mjs';
import { beginLogin, completeLogin } from './dingtalk.mjs';

const assets = new Map([['/', ['text/html; charset=utf-8','index.html']],['/app.js',['text/javascript; charset=utf-8','app.js']],['/style.css',['text/css; charset=utf-8','style.css']]]);
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
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Denied(415,'请使用 JSON 请求');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Denied(413,'请求过大'); chunks.push(chunk); }
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw 0; return parsed; }
  catch { throw new Denied(400,'请求格式错误'); }
}
export function createApplication(pool,config,{ loginResolver } = {}) {
  const handle = async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if (config.origin.startsWith('https:')) res.setHeader('Strict-Transport-Security','max-age=86400');
    try {
      if (req.headers.host !== new URL(config.origin).host) throw new Denied(400,'访问地址不匹配');
      const url = new URL(req.url,config.origin), path = url.pathname, jar = cookies(req);
      if (req.method === 'GET' && assets.has(path)) {
        const [type,file] = assets.get(path); res.writeHead(200,{'Content-Type':type}); return res.end(readFileSync(new URL('public/'+file,import.meta.url)));
      }
      if (req.method === 'GET' && path === '/healthz') {
        try { await pool.query('SELECT 1'); return json(res,200,{status:'ready',batch:'P01-P02',loginEnabled:config.loginEnabled}); }
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
      if (req.method === 'GET' && path === '/api/me') return json(res,200,actor);
      if (req.method === 'GET' && path === '/api/status') return json(res,200,{batch:'P01-P02',message:'登录与权限基础已接入；业务同步和总原型 v2 页面尚未接入。'});
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
