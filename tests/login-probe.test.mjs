import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createOwnerProbe, PROBE_CALLBACK } from '../scripts/check-dingtalk-login.mjs';

test('所有者扫码探针只核对指定身份；浏览器绑定、防重放、固定跳转且不授予权限', async () => {
  let calls = 0, verified = 0, wrong = false;
  const server = createOwnerProbe({ config: { dingtalk: { corpId: 'FAKE_CORP' } }, credentials: { clientId: 'FAKE_APP', clientSecret: 'FAKE_SECRET' }, expectedUnionId: 'FAKE_OWNER', resolver: async () => { calls++; return { corpId: 'FAKE_CORP', unionId: wrong ? 'FAKE_OTHER' : 'FAKE_OWNER', displayName: '余莉' }; }, onVerified: async () => { verified++; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const get = (path, cookie, host = '127.0.0.1:43117') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) } }, res => { let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })); }); req.on('error', reject); req.end();
  });
  try {
    assert.equal((await get('/start')).status, 403);
    assert.equal((await get('/', null, 'attacker.invalid')).status, 403);
    const first = await get('/'); const cookie = first.headers['set-cookie'][0].split(';')[0];
    assert.equal((await get('/')).status, 403);
    const login = await get('/start', cookie), url = new URL(login.headers.location);
    assert.equal(url.searchParams.get('redirect_uri'), PROBE_CALLBACK);
    const state = url.searchParams.get('state');
    const callback = '/dingtalk/oauth/callback?state=' + state + '&authCode=FAKE_CODE';
    assert.equal((await get(callback)).status, 403); assert.equal(calls, 0);
    wrong = true; const failed = await get(callback, cookie); assert.equal(failed.headers.location, '/'); assert.equal(verified, 0);
    await get(callback, cookie); assert.equal(calls, 1);
    const retry = await get('/start', cookie); const fresh = new URL(retry.headers.location).searchParams.get('state'); wrong = false;
    const success = await get('/dingtalk/oauth/callback?state=' + fresh + '&code=FAKE_CODE', cookie);
    assert.equal(success.headers.location, '/'); assert.equal(verified, 1);
    assert.match((await get('/', cookie)).text, /身份核验通过：余莉/);
    assert.equal((await get('/start', cookie)).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
