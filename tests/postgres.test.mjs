import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { readJson } from '../app/config.mjs';
import { poolFor, migrate, digest } from '../app/database.mjs';
import { bootstrap,establishSession,authenticate,changePerson,createIdentity,logout } from '../app/security.mjs';
import { beginLogin,completeLogin } from '../app/dingtalk.mjs';
import { createApplication } from '../app/server.mjs';

test('真实 PostgreSQL：迁移、OAuth、HTTP 权限及并发保护',{skip:!process.env.VIKINGPM_TEST_CONFIG},async t=>{
  const database=readJson(process.env.VIKINGPM_TEST_CONFIG);
  assert.equal(database.database,'vikingpm_p01p02_test');assert.equal(database.host,'127.0.0.1');assert.equal(database.user,'vikingpm_migrator');
  const schema='p02_'+randomBytes(8).toString('hex');assert.match(schema,/^p02_[a-f0-9]{16}$/);
  const setup=poolFor(database);await setup.query('CREATE SCHEMA '+schema);
  const pool=poolFor({...database,options:'-c search_path='+schema});
  const dir=mkdtempSync(join(tmpdir(),'vikingpm-p02-'));writeFileSync(join(dir,'fake.env'),'DINGTALK_CLIENT_ID=FAKE_APP\nDINGTALK_CLIENT_SECRET=FAKE_SECRET');
  let server;
  try{
    await t.test('迁移重复运行不重复建表；篡改迁移记录时失败',async()=>{
      assert.equal(await migrate(pool),1);assert.equal(await migrate(pool),0);
      await pool.query("UPDATE schema_migrations SET checksum='invalid'");await assert.rejects(migrate(pool));
      await pool.query('DELETE FROM schema_migrations');
      // Recover only the checksum in this isolated schema, without re-running DDL.
      const {readFile}=await import('node:fs/promises');const sql=await readFile(new URL('../migrations/001-identity-access.sql',import.meta.url),'utf8');
      await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',['001-identity-access.sql',digest(sql)]);
      assert.equal(await migrate(pool),0);
    });
    const approval={confirmed:true,corpId:'corp-test',reason:'隔离构造数据测试',people:[{displayName:'owner A',unionId:'owner-a',role:'owner'},{displayName:'owner B',unionId:'owner-b',role:'owner'},{displayName:'viewer',unionId:'viewer',role:'viewer'},{displayName:'admin',unionId:'admin',role:'admin'},{displayName:'none',unionId:'none',role:'none'}]};
    const config={origin:'http://127.0.0.1:4310',loginEnabled:true,dingtalk:{corpId:'corp-test',envPath:join(dir,'fake.env')}};
    await t.test('初始化必须显式核对；未初始化及未启用登录均拒绝',async()=>{
      await assert.rejects(beginLogin(pool,config),{status:503});
      await assert.rejects(bootstrap(pool,{...approval,confirmed:false},'corp-test'));
      await assert.rejects(bootstrap(pool,{...approval,people:[approval.people[2]]},'corp-test'));
      await assert.rejects(bootstrap(pool,approval,'other-corp'));
      await bootstrap(pool,approval,'corp-test');await assert.rejects(bootstrap(pool,approval,'corp-test'),{status:409});
      await assert.rejects(beginLogin(pool,{...config,loginEnabled:false}),{status:503});
    });
    const persons=Object.fromEntries((await pool.query('SELECT p.id,i.union_id FROM people p JOIN identity_mappings i ON i.person_id=p.id')).rows.map(p=>[p.union_id,p.id]));
    const owner=persons['owner-a'], ownerB=persons['owner-b'];
    const session=async unionId=>(await establishSession(pool,{corpId:'corp-test',unionId})).token;
    await t.test('无授权、不同企业、未知映射拒绝；会话只存摘要且退出即时失效',async()=>{
      for(const identity of [{corpId:'corp-test',unionId:'none'},{corpId:'other',unionId:'owner-a'},{corpId:'corp-test',unionId:'unknown'}])await assert.rejects(establishSession(pool,identity),{status:403});
      const token=await session('viewer');assert.equal((await authenticate(pool,token)).role,'viewer');
      assert.equal((await pool.query('SELECT 1 FROM login_sessions WHERE digest=$1',[token])).rowCount,0);
      await logout(pool,token);assert.equal(await authenticate(pool,token),null);
    });
    await t.test('OAuth state 与浏览器绑定、五分钟有效且只能消费一次',async()=>{
      const login=await beginLogin(pool,config);assert.equal(new URL(login.url).searchParams.get('redirect_uri'),config.origin+'/auth/dingtalk/callback');
      const params=new URLSearchParams({state:login.state,authCode:'FAKE_CODE'});
      let calls=0;const resolver=async()=>{calls++;return{corpId:'corp-test',unionId:'viewer'};};
      await assert.rejects(completeLogin(pool,config,params,'wrong',resolver),{status:400});assert.equal(calls,0);
      const result=await completeLogin(pool,config,params,login.state,resolver);assert.equal((await authenticate(pool,result.token)).role,'viewer');
      await assert.rejects(completeLogin(pool,config,params,login.state,resolver),{status:400});assert.equal(calls,1);
      const expired=await beginLogin(pool,config);await pool.query("UPDATE oauth_requests SET expires_at=now()-interval '1 second'");
      await assert.rejects(completeLogin(pool,config,new URLSearchParams({state:expired.state,code:'FAKE'}),expired.state,resolver),{status:400});
      const failed=await beginLogin(pool,config);const failing=new URLSearchParams({state:failed.state,code:'FAKE'});
      await assert.rejects(completeLogin(pool,config,failing,failed.state,async()=>{throw new Error('FAKE_PROVIDER');}));
      await assert.rejects(completeLogin(pool,config,failing,failed.state,resolver),{status:400});
    });
    await t.test('HTTP 逐次鉴权：匿名拒绝、查看者不可写、管理员不可授权、来源和 CSRF 校验',async()=>{
      server=createApplication(pool,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));config.origin='http://127.0.0.1:'+server.address().port;
      const request=async(path,token,method='GET',value,headers={})=>{
        const actor=token?await authenticate(pool,token):null;
        return fetch(config.origin+path,{method,redirect:'manual',headers:{...(token?{Cookie:'vpm_session='+token}:{}),...(method!=='GET'?{Origin:config.origin,'x-csrf-token':actor?.csrf ?? '', 'Content-Type':'application/json'}:{}),...headers},...(value?{body:JSON.stringify(value)}:{})});
      };
      const view=await session('viewer'), admin=await session('admin'),own=await session('owner-a');
      assert.equal((await request('/api/status')).status,401);assert.equal((await request('/api/status',view)).status,200);
      assert.equal((await request('/api/access',view)).status,403);
      for(const token of [view,admin]) assert.equal((await request('/api/access/'+ownerB,token,'PATCH',{role:'none',reason:'test'})).status,403);
      assert.equal((await request('/api/identities/'+persons.viewer,view,'PATCH',{active:false,reason:'test'})).status,403);
      assert.equal((await request('/api/access/'+persons.viewer,own,'PATCH',{role:'viewer',reason:'test'},{Origin:'https://attacker.invalid'})).status,403);
      assert.equal((await request('/api/access/'+persons.viewer,own,'PATCH',{role:'viewer',reason:'test'},{'x-csrf-token':'wrong'})).status,403);
      const badHost=await new Promise((resolve,reject)=>{const req=httpRequest(config.origin+'/api/me',{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
      assert.equal(badHost,400);
      const audit=await request('/api/audit',admin);assert.equal(audit.status,200);
      const injection=await request('/api/access/'+persons.viewer,own,'PATCH',{role:'viewer',reason:'test',active:false});assert.equal(injection.status,400);
      const state=await beginLogin(pool,config);
      const callback=await request('/auth/dingtalk/callback?state='+state.state+'&code=FAKE_CODE',null,'GET',null,{Cookie:'vpm_oauth=wrong'});
      assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/?login=400');assert.ok(!callback.headers.get('location').includes('FAKE_CODE'));
      config.loginEnabled=false;assert.equal((await request('/api/me',view)).status,401);config.loginEnabled=true;
    });
    await t.test('撤权、停用及解除映射撤销所有旧会话；恢复不会复活旧会话',async()=>{
      for(const [kind,patch,restore] of [['access',{role:'none'},{role:'viewer'}],['identity',{active:false},{active:true}],['identity',{mappingEnabled:false},{mappingEnabled:true}]]){
        const one=await session('viewer'),two=await session('viewer');
        await changePerson(pool,owner,persons.viewer,{...patch,reason:'test revoke'},kind);
        assert.equal(await authenticate(pool,one),null);assert.equal(await authenticate(pool,two),null);
        await changePerson(pool,owner,persons.viewer,{...restore,reason:'test restore'},kind);
        assert.equal(await authenticate(pool,one),null);assert.equal((await authenticate(pool,await session('viewer'))).role,'viewer');
      }
      await assert.rejects(changePerson(pool,persons.admin,ownerB,{role:'viewer',reason:'test'},'access'),{status:403});
      await assert.rejects(changePerson(pool,persons.admin,ownerB,{active:false,reason:'test'},'identity'),{status:403});
      const created=await createIdentity(pool,persons.admin,{displayName:'new',unionId:'new-union',confirmed:true,reason:'test'},'corp-test');assert.equal(created.role,'none');
      await assert.rejects(session('new-union'),{status:403});
    });
    await t.test('并发撤权、降级与解除映射至少保留一名有效所有者；失败不留半条审计',async()=>{
      const mutations=[['access',{role:'none'}],['access',{role:'viewer'}],['identity',{active:false}],['identity',{mappingEnabled:false}]];
      let survivor=owner;
      for(let i=0;i<mutations.length;i++){
        for(const id of [owner,ownerB]){
          await changePerson(pool,survivor,id,{active:true,mappingEnabled:true,reason:'test prepare'},'identity');
          await changePerson(pool,survivor,id,{role:'owner',reason:'test prepare'},'access');
        }
        const a=mutations[i],b=mutations[(i+1)%mutations.length];
        const results=await Promise.allSettled([changePerson(pool,owner,owner,{...a[1],reason:'test parallel'},a[0]),changePerson(pool,ownerB,ownerB,{...b[1],reason:'test parallel'},b[0])]);
        assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
        const owners=(await pool.query("SELECT p.id FROM people p JOIN identity_mappings i ON i.person_id=p.id JOIN access_grants g ON g.person_id=p.id WHERE p.active AND i.enabled AND i.confirmed AND g.role='owner'")).rows;assert.equal(owners.length,1);survivor=owners[0].id;
        for(const [kind,patch] of mutations){const count=(await pool.query('SELECT count(*)::int n FROM audit_events')).rows[0].n;
          await assert.rejects(changePerson(pool,survivor,survivor,{...patch,reason:'test last owner'},kind),{status:409});
          assert.equal((await pool.query('SELECT count(*)::int n FROM audit_events')).rows[0].n,count);
        }
      }
    });
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));await pool.end();
    await setup.query('DROP SCHEMA '+schema+' CASCADE');await setup.end();
    // Only remove the unique directory created by this test, never an input path.
    assert.ok(dir.startsWith(join(tmpdir(),'vikingpm-p02-')));rmSync(dir,{recursive:true});
  }
});
