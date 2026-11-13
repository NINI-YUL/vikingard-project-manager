import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig, readJson, readDingtalk } from '../app/config.mjs';
import { requireRole } from '../app/security.mjs';
import { resolveIdentity } from '../app/dingtalk.mjs';
const config = () => JSON.parse(readFileSync(new URL('../app/config.example.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));

test('外部配置路径误传不回显内容或堆栈',()=>{
  const marker='FAKE_SECRET_DO_NOT_ECHO\nkey=value';
  for(const run of [()=>readJson(marker),()=>readDingtalk({dingtalk:{envPath:marker}})]){
    try{run();assert.fail('must reject');}catch(error){assert.ok(!error.stack.includes(marker));assert.ok(!error.message.includes('FAKE_SECRET'));}
  }
});
test('默认仅本机；内网禁止明文，禁止复用环境库',()=>{
  assert.equal(validateConfig(config()).loginEnabled,false);
  for(const change of [{database:{...config().database,database:'vikingpm_env_check'}},{origin:'http://10.0.0.5:4310'},{host:'0.0.0.0'},{origin:'https://public.example/path'},{loginEnabled:true}]) assert.throws(()=>validateConfig({...config(),...change}));
});
test('四档权限矩阵',()=>{
  for(const role of ['none','viewer','admin','owner'])for(const minimum of ['viewer','admin','owner']){
    const pass=['none','viewer','admin','owner'].indexOf(role)>=['none','viewer','admin','owner'].indexOf(minimum);
    if(pass)requireRole({role},minimum);else assert.throws(()=>requireRole({role},minimum));
  }
  assert.throws(()=>requireRole(null,'viewer'),{status:401});
  assert.throws(()=>requireRole({role:'department-admin'},'admin'));
});
function provider(responses,checks=[]) {
  let i=0;return async(url,options)=>{checks.push({url,options});const item=responses[i++];if(item instanceof Error)throw item;return {ok:true,json:async()=>item};};
}
const credentials={clientId:'FAKE_APP',clientSecret:'FAKE_SECRET'};
const c={dingtalk:{corpId:'corp-test'}};
const success=[{accessToken:'FAKE_USER_TOKEN'},{unionId:'union-test'},{accessToken:'FAKE_APP_TOKEN'},{errcode:0,result:{userid:'staff-test'}},{errcode:0,result:{userid:'staff-test',unionid:'union-test',active:true,name:'FAKE_USER'}}];
test('可信身份来自用户令牌及当前企业成员关系，不用姓名',async()=>{
  const checks=[];const identity=await resolveIdentity(c,'FAKE_CODE',provider(success,checks),credentials);
  assert.deepEqual(identity,{corpId:'corp-test',unionId:'union-test',displayName:'FAKE_USER'});assert.equal(checks.length,5);
  assert.ok(checks.every(call=>call.options.redirect==='error'&&call.options.signal));
});
test('缺少企业成员、离职、身份冲突和异常响应均拒绝，不泄露上游内容',async()=>{
  for(const member of [{active:false,unionid:'union-test',userid:'staff-test'},{active:true,unionid:'other',userid:'staff-test'},{}]){
    await assert.rejects(resolveIdentity(c,'FAKE_CODE',provider([...success.slice(0,4),{errcode:0,result:member}]),credentials));
  }
  for(const first of [new Error('FAKE_SECRET'),{errcode:123,errmsg:'FAKE_SECRET'},{accessToken:null}]){
    try{await resolveIdentity(c,'FAKE_CODE',provider([first]),credentials);assert.fail();}catch(error){assert.ok(!error.stack.includes('FAKE_SECRET'));}
  }
});
