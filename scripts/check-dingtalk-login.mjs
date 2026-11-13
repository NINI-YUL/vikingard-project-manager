import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnvFile } from './dingtalk-progress-form-link.mjs';
import { resolveIdentity } from '../app/dingtalk.mjs';

export const PROBE_ORIGIN = 'http://127.0.0.1:43117';
export const PROBE_CALLBACK = PROBE_ORIGIN + '/dingtalk/oauth/callback';
const matches = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[A-Za-z0-9_-]{43}$/.test(a) && /^[A-Za-z0-9_-]{43}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createOwnerProbe({ config, credentials, expectedUnionId, expectedDisplayName = '余莉', resolver = resolveIdentity, onVerified = async () => {}, ttlMs = 15 * 60 * 1000 }) {
  if (!config?.dingtalk?.corpId || !credentials?.clientId || !credentials?.clientSecret || (!expectedUnionId && !expectedDisplayName)) throw new Error('身份核验配置不完整');
  let browser, state, result = 'waiting';
  const expiresAt = Date.now() + ttlMs;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const page = (status, heading, text, link = false) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>钉钉身份核验</title><main><h1>' + heading + '</h1><p>' + text + '</p>' + (link ? '<p><a href="/start">使用指定人员的钉钉账号扫码核验</a></p>' : '') + '<p>仅核验已指定人员身份。不授予后台权限，不发送通知。入口启动后 15 分钟失效。</p></main></html>');
    };
    if (req.method !== 'GET' || req.headers.host !== new URL(PROBE_ORIGIN).host || (req.headers.origin && req.headers.origin !== PROBE_ORIGIN)) return page(403, '请求被拒绝', '请从本机核验入口进入。');
    if (Date.now() >= expiresAt) return page(410, '核验入口已过期', '请回到聊天重新准备核验入口。');
    const path = new URL(req.url, PROBE_ORIGIN);
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('vpm_owner_probe='))?.slice('vpm_owner_probe='.length);
    if (path.pathname === '/') {
      if (!browser) {
        browser = randomBytes(32).toString('base64url');
        res.setHeader('Set-Cookie', 'vpm_owner_probe=' + browser + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=900');
      } else if (!matches(browser, cookie)) return page(403, '请使用原核验浏览器', '已有核验会话，请回到原窗口或联系开发者重新准备。');
      if (result === 'verified') return page(200, '身份核验通过：' + expectedDisplayName + '', '当前企业成员身份与既有可信身份一致。请回到聊天告知核验通过；后台权限仍未初始化。');
      if (result === 'exchanging') return page(200, '正在核验身份', '请稍后刷新。');
      return page(200, result === 'failed' ? '上次核验未通过' : '核验指定人员：' + expectedDisplayName + '', '请由指定人员本人操作，并核对钉钉页面中的应用为当前项目管理测试应用。不要复制授权码、地址栏参数或令牌。', true);
    }
    if (!matches(browser, cookie)) return page(403, '核验会话不匹配', '请先打开本机核验首页。');
    if (path.pathname === '/start') {
      if (['verified', 'exchanging'].includes(result)) return page(409, '本次核验已处理', '请回到核验首页查看结果。');
      state = randomBytes(32).toString('base64url');
      result = 'waiting';
      const url = new URL('https://login.dingtalk.com/oauth2/auth');
      for (const [key, value] of Object.entries({ client_id: credentials.clientId, redirect_uri: PROBE_CALLBACK, response_type: 'code', scope: 'openid', prompt: 'consent', state })) url.searchParams.set(key, value);
      res.writeHead(302, { Location: url.toString() }); return res.end();
    }
    if (path.pathname !== '/dingtalk/oauth/callback') return page(404, '入口不存在', '请回到本机核验首页。');
    const code = path.searchParams.get('authCode') ?? path.searchParams.get('code');
    if (!matches(state, path.searchParams.get('state')) || !code || code.length > 4096 || path.searchParams.has('error')) {
      state = null; result = 'failed';
      res.writeHead(303, { Location: '/' }); return res.end();
    }
    state = null; result = 'exchanging';
    try {
      const identity = await resolver(config, code, fetch, credentials);
      if (identity.corpId !== config.dingtalk.corpId || (expectedUnionId && identity.unionId !== expectedUnionId) || (expectedDisplayName && identity.displayName !== expectedDisplayName)) throw 0;
      await onVerified(identity);
      result = 'verified';
    } catch { result = 'failed'; }
    res.writeHead(303, { Location: '/' }); res.end();
  });
  server.requestTimeout = 20000; server.headersTimeout = 15000;
  const timer = setTimeout(() => server.close(), ttlMs); timer.unref();
  server.on('close', () => { clearTimeout(timer); browser = null; state = null; });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const envPath = process.env.LOCALAPPDATA + '/VikingPM/dingtalk.env';
    const values = parseEnvFile(envPath);
    const expectedDisplayName = process.env.VIKINGPM_PROBE_NAME || '余莉';
    const server = createOwnerProbe({
      config: { dingtalk: { corpId: values.DINGTALK_CORP_ID, envPath } },
      credentials: { clientId: values.DINGTALK_CLIENT_ID, clientSecret: values.DINGTALK_CLIENT_SECRET },
      expectedUnionId: expectedDisplayName === '余莉' ? values.DINGTALK_OPERATOR_UNION_ID : undefined,
      expectedDisplayName,
      onVerified: async identity => {
        writeFileSync('F:/VikingPM/security/p01-p02-'+expectedDisplayName+'-verification.json', JSON.stringify({ displayName: expectedDisplayName, corpId: identity.corpId, unionId: identity.unionId, verifiedAt: new Date().toISOString(), method: 'user-oauth-and-current-enterprise-membership', businessAccessGranted: false }, null, 2), { flag: 'w' });
      },
    });
    server.on('error', () => { console.error('身份核验入口启动失败；请检查端口，不输出原始异常'); process.exitCode = 1; });
    server.listen(Number(process.env.VIKINGPM_PROBE_PORT || 43117), '127.0.0.1', () => console.log('钉钉身份核验入口已就绪；15 分钟有效；未启用后台登录'));
  } catch { console.error('身份核验配置不可用；未输出配置或原始异常'); process.exitCode = 1; }
}
