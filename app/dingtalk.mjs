import { randomBytes, timingSafeEqual } from 'node:crypto';
import { digest } from './database.mjs';
import { readDingtalk } from './config.mjs';
import { Denied, establishSession } from './security.mjs';

async function remoteJson(fetchImpl, url, body, headers = {}) {
  try {
    const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type':'application/json', ...headers }, ...(body ? { body:JSON.stringify(body) } : {}), redirect:'error', signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw 0;
    const data = await response.json();
    if (!data || (data.errcode !== undefined && data.errcode !== 0)) throw 0;
    return data;
  } catch { throw new Denied(502,'钉钉身份验证失败，请重新发起登录或联系管理员'); }
}
// No access token, authorization code or raw provider response is persisted or logged.
export async function resolveIdentity(config, code, fetchImpl = fetch, credentials = readDingtalk(config)) {
  const userToken = await remoteJson(fetchImpl,'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',{ clientId:credentials.clientId, clientSecret:credentials.clientSecret, code, grantType:'authorization_code' });
  if (typeof userToken.accessToken !== 'string' || !userToken.accessToken) throw new Denied(502,'钉钉身份响应不完整');
  const user = await remoteJson(fetchImpl,'https://api.dingtalk.com/v1.0/contact/users/me',null,{'x-acs-dingtalk-access-token':userToken.accessToken});
  if (typeof user.unionId !== 'string' || !user.unionId) throw new Denied(502,'钉钉身份响应不完整');
  const appToken = await remoteJson(fetchImpl,'https://api.dingtalk.com/v1.0/oauth2/accessToken',{ appKey:credentials.clientId,appSecret:credentials.clientSecret });
  if (typeof appToken.accessToken !== 'string' || !appToken.accessToken) throw new Denied(502,'钉钉企业验证失败');
  // Membership is resolved with the configured enterprise app, never inferred from a display name.
  const byUnion = await remoteJson(fetchImpl,'https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token='+encodeURIComponent(appToken.accessToken),{unionid:user.unionId});
  if (typeof byUnion.result?.userid !== 'string' || !byUnion.result.userid) throw new Denied();
  const member = await remoteJson(fetchImpl,'https://oapi.dingtalk.com/topapi/v2/user/get?access_token='+encodeURIComponent(appToken.accessToken),{userid:byUnion.result.userid});
  if (member.result?.unionid !== user.unionId || member.result?.active !== true || member.result?.userid !== byUnion.result.userid) throw new Denied();
  return {corpId:config.dingtalk.corpId,unionId:user.unionId,displayName:member.result.name};
}
export async function beginLogin(pool, config) {
  const ready = (await pool.query('SELECT initialized FROM security_state WHERE id=1')).rows[0]?.initialized;
  if (!config.loginEnabled || !ready) throw new Denied(503,'登录尚未启用；请先核对首位所有者及访问名单');
  const credentials = readDingtalk(config);
  const state = randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM oauth_requests WHERE expires_at < now()');
  await pool.query("INSERT INTO oauth_requests(digest,expires_at) VALUES($1,now()+interval '5 minutes')",[digest(state)]);
  const url = new URL('https://login.dingtalk.com/oauth2/auth');
  for (const [key,value] of Object.entries({redirect_uri:config.origin+'/auth/dingtalk/callback',response_type:'code',client_id:credentials.clientId,scope:'openid',state,prompt:'consent'})) url.searchParams.set(key,value);
  return {state,url:url.toString()};
}
export async function completeLogin(pool, config, params, cookie, resolver = resolveIdentity) {
  if (!config.loginEnabled) throw new Denied(503,'登录尚未启用');
  const state = params.get('state'), code = params.get('authCode') ?? params.get('code');
  if (!state || !cookie || !/^[A-Za-z0-9_-]{43}$/.test(state) || cookie.length !== state.length || !timingSafeEqual(Buffer.from(cookie),Buffer.from(state)) || !code || code.length > 4096 || params.has('error')) throw new Denied(400,'登录校验失败，请重新发起');
  const used = await pool.query('DELETE FROM oauth_requests WHERE digest=$1 AND expires_at>now() RETURNING digest',[digest(state)]);
  if (!used.rowCount) throw new Denied(400,'登录请求已过期或已使用');
  const identity = await resolver(config,code);
  return establishSession(pool,identity);
}
