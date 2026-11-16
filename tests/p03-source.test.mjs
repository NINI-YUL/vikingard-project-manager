import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeambitionSource, createCliQuery, validateTeambitionConfig } from '../app/teambition-source.mjs';
const org='a'.repeat(24),project='b'.repeat(24),version='c'.repeat(24),category='d'.repeat(24),fn='e'.repeat(24),type='f'.repeat(24),status='1'.repeat(24);
const config={cliPath:'C:/fake/teambition-cli.exe',organizationId:org,projectId:project,versionIds:[version],categoryFieldId:category,functionFieldId:fn};
function fake(overrides={}) {
  return async(action,args)=>{
    if(overrides[action])return overrides[action](args);
    const data={query:[{id:project,organizationId:org,name:'测试项目'}],'sprint-query':[{id:version,projectId:project,name:'测试迭代'}],'sfc-query':[{_id:type,name:'子需求',_taskflowId:'2'.repeat(24)}],'tfs-query':[{id:status,name:'待处理'}],'customfield-query':[{_id:category,name:'工单分类',type:'dropDown'},{_id:fn,name:'职能',type:'dropDown'}],'task-activity':[],'task-query':[{id:'3'.repeat(24),projectId:project,sprintId:version,isArchived:false,sfcId:type,tfsId:status,content:'测试',customfields:[{cfId:fn,value:[{title:'客户端'}]}]}]};
    return {code:200,result:data[action],nextPageToken:''};
  };
}
test('P03 actual reader resolves metadata, verifies fields, maps source definitions and scopes query',async()=>{
  let args;
  const source=createTeambitionSource(config,fake({'task-query':async a=>{args=a;return fake()('task-query',a);}}));
  assert.equal((await source.getVersion(project,version)).versionName,'测试迭代');
  const snapshot=await source.read({projectId:project,sourceVersionId:version});
  assert.equal(snapshot.items[0].typeName,'子需求');assert.equal(snapshot.items[0].functionName,'客户端');assert.deepEqual(snapshot.items[0].structureIssues,[]);
  assert.equal(snapshot.binding.organizationId,org);assert.ok(args.includes(`sprintId = '${version}' AND isArchived = false ORDER BY updated DESC`));
});
test('P03 source rejects unknown iteration, wrong enterprise, changed field definitions and definition pagination',async()=>{
  await assert.rejects(createTeambitionSource(config,fake()).getVersion(project,'0'.repeat(24)));
  for(const overrides of [
    {query:async()=>({result:[{id:project,organizationId:'other'}]})},
    {'customfield-query':async()=>({result:[{_id:category,name:'changed'},{_id:fn,name:'职能'}]})},
    {'sfc-query':async()=>({result:[],nextPageToken:'more'})},
    {'sprint-query':async()=>({result:[{id:version,projectId:'other',name:'wrong'}]})}
  ]) await assert.rejects(createTeambitionSource(config,fake(overrides)).read({projectId:project,sourceVersionId:version}));
});
test('P03 command runner uses fixed actions, no shell, finite execution and suppresses provider errors',async()=>{
  let options,argv;
  const query=createCliQuery(config.cliPath,async(path,args,opts)=>{argv=args;options=opts;return {stdout:'{"requestId":"test","result":[]}'};});
  await query('task-query',['--project-id',project]);
  assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.ok(options.timeout>0);assert.equal(argv[0],'project');
  await assert.rejects(query('task-create',[]));
  const failing=createCliQuery(config.cliPath,async()=>{throw new Error('FAKE_SECRET_FROM_STDERR');});
  await assert.rejects(failing('task-query',[]),e=>!e.stack.includes('FAKE_SECRET_FROM_STDERR')&&e.message==='Teambition 只读查询失败');
  const invalid=createCliQuery(config.cliPath,async()=>({stdout:'{"code":403,"errorMessage":"FAKE_SECRET"}'}));
  await assert.rejects(invalid('query',[]),e=>!e.stack.includes('FAKE_SECRET'));
  assert.throws(()=>validateTeambitionConfig({...config,cliPath:'cmd.exe & other'}));
});