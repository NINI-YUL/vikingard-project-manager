import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const script=await readFile(new URL('../app/public/app.js',import.meta.url),'utf8');
async function page(fetchAction){
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',replaceChildren(){},append(){}});return nodes.get(id);};
  const submit={disabled:false};
  get('source-candidate').selectedOptions=[{dataset:{project:'test-project'},value:'test-version',textContent:'调试迭代'}];
  get('version-owner').selectedOptions=[{value:'test-owner',textContent:'测试负责人'}];
  get('enroll-reason').value='验收';
  const response=(data,ok=true,status=200)=>({ok,status,json:async()=>data});
  await runInNewContext('(async()=>{'+script+'})()',{
    document:{getElementById:get,createElement:()=>({append(){}})},
    fetch:async(path,options)=>path==='/healthz'?response({loginEnabled:false}):fetchAction(path,options,response),
    console,Intl,Date,URL
  });
  return {get,submit,confirm:()=>get('enroll-version').onsubmit({preventDefault(){},target:{querySelector:()=>submit}})};
}
test('confirmation shows nearby progress and persistent named success',async()=>{
  let finish;
  const ui=await page(async(path,options,response)=>{
    if(options.method==='POST'){assert.equal(JSON.parse(options.body).ownerId,'test-owner');await new Promise(resolve=>{finish=resolve;});return response({});}
    return response([]);
  });
  const pending=ui.confirm();
  assert.equal(ui.submit.disabled,true);assert.match(ui.get('enroll-feedback').textContent,/正在核对/);
  finish();await pending;
  assert.equal(ui.submit.disabled,false);assert.match(ui.get('enroll-feedback').textContent,/确认成功：调试迭代；版本负责人：测试负责人/);
});
test('confirmation rejection stays near form and restores button',async()=>{
  const ui=await page(async(path,options,response)=>response({error:'权限不足'},false,403));
  await ui.confirm();assert.equal(ui.submit.disabled,false);assert.match(ui.get('enroll-feedback').textContent,/确认未完成：403：权限不足/);
});
test('refresh failure preserves saved confirmation and prevents misleading retry',async()=>{
  let writes=0;
  const ui=await page(async(path,options,response)=>{if(options.method==='POST'){writes++;return response({});}throw new Error('offline');});
  await ui.confirm();assert.equal(writes,1);assert.equal(ui.submit.disabled,false);
  assert.match(ui.get('enroll-feedback').textContent,/确认成功/);assert.match(ui.get('enroll-feedback').textContent,/无需重复确认/);
});
