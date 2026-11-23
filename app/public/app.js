let actor;
const $ = id => document.getElementById(id);
const names = {none:'无后台权限',viewer:'查看者',admin:'系统管理员',owner:'系统所有者'};
function message(text) { $('message').textContent=text; }
async function api(path,method='GET',value) {
  const response=await fetch(path,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json','x-csrf-token':actor?.csrf ?? ''}:{})},...(value?{body:JSON.stringify(value)}:{})});
  const data=await response.json();
  if(response.status===401){$('login').hidden=false;throw new Error('401：登录已过期，请点击钉钉登录后重试。');}
  if(!response.ok) throw new Error(`${response.status}：${data.error ?? '请求失败'}`);
  return data;
}
function button(label,action) {
  const item=document.createElement('button'); item.textContent=label;
  item.onclick=async()=>{ item.disabled=true; try{await action();}catch(error){message(error.message);}finally{item.disabled=false;} };
  return item;
}
async function people() {
  const items=await api('/api/access'); $('people').replaceChildren();
  for(const item of items){
    const row=document.createElement('tr');
    const name=document.createElement('td'); name.textContent=item.displayName;
    const role=document.createElement('td'),select=document.createElement('select'); select.setAttribute('aria-label',item.displayName+'的权限');
    for(const [key,label] of Object.entries(names)){const option=document.createElement('option');option.value=key;option.textContent=label;select.append(option);} select.value=item.role;role.append(select);
    const state=document.createElement('td');state.textContent=item.active&&item.mappingEnabled&&item.confirmed?'身份有效':'身份停用或未确认';
    const actions=document.createElement('td');
    const update=async(path,data)=>{
      const reason=window.prompt('请填写本次变更原因。取消则不保存。');if(!reason?.trim())return;
      await api(path,'PATCH',{...data,reason});message('变更已保存；目标人员旧会话已失效。');
      if(item.id===actor.id){location.reload();return;} await people();
    };
    actions.append(button('保存权限',()=>update('/api/access/'+item.id,{role:select.value})),button(item.active?'停用人员':'启用人员',()=>update('/api/identities/'+item.id,{active:!item.active})),button(item.mappingEnabled?'解除身份映射':'恢复身份映射',()=>update('/api/identities/'+item.id,{mappingEnabled:!item.mappingEnabled})));
    row.append(name,role,state,actions);$('people').append(row);
  }
}
async function audit(){ $('audit').textContent=JSON.stringify(await api('/api/audit'),null,2); }
$('logout').onclick=async()=>{try{await api('/auth/logout','POST');location.href='/';}catch(error){message(error.message);}};
// Invalid target is deliberate: rejection proves server permissions without changing any person.
$('write-check').onclick=async()=>{try{await api('/api/access/00000000-0000-0000-0000-000000000000','PATCH',{role:'viewer',reason:'无副作用权限检查'});}catch(error){message(error.message);}};
$('refresh-audit').onclick=()=>audit().catch(error=>message(error.message));
$('add-person').onsubmit=async event=>{
  event.preventDefault(); const form=new FormData(event.target);
  try{await api('/api/identities','POST',{displayName:form.get('displayName'),unionId:form.get('unionId'),reason:form.get('reason'),confirmed:form.get('confirmed')==='on'});event.target.reset();await people();message('身份已登记；尚无后台权限，须由所有者明确授权。');}catch(error){message(error.message);}
};
const syncNames={never:'待首次同步',running:'同步中',succeeded:'同步成功',failed:'同步失败，保留原数据'};
const issueNames={missing_function:'缺少职能',unknown_task_type:'未知任务类型',unknown_status:'未知来源状态',customfields_missing:'自定义字段结构缺失',missing_title:'缺少标题',parent_missing:'父任务未纳入',self_parent:'父任务指向自身'};
const date=value=>value ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(value)) : '尚无记录';
function cell(row,value){const td=document.createElement('td');td.textContent=value ?? '未填写';row.append(td);return td;}
let selectedVersion,taskOffset=0,nextTaskOffset=null,pollingEnabled=false;
const presenceNames={current:'本次可读',archived:'来源已归档',out_of_scope:'已移出管理范围',access_restricted:'来源访问受限，原因待核对',missing_unknown:'来源缺失，原因不明',deleted_confirmed:'来源明确标记删除'};
let historyTask,historyVersion,historyOffset=0,historyNext=null;
async function history(version,item,offset=0){
  historyTask=item;historyVersion=version;historyOffset=offset;
  const data=await api('/api/versions/'+version.id+'/tasks/'+item.sourceTaskId+'/history?kind='+$('history-kind').value+'&offset='+offset);historyNext=data.nextOffset;
  $('history-panel').hidden=false;$('history-title').textContent=(item.visibleKey??'')+' · '+item.title+' · 历史';$('history-count').textContent='共 '+data.total+' 条，本页 '+data.items.length+' 条。';$('history-records').textContent=JSON.stringify(data.items,null,2);$('history-prev').disabled=offset===0;$('history-next').disabled=data.nextOffset===null;
}
$('history-kind').onchange=()=>history(historyVersion,historyTask).catch(e=>message(e.message));
$('history-prev').onclick=()=>history(historyVersion,historyTask,Math.max(0,historyOffset-100)).catch(e=>message(e.message));
$('history-next').onclick=()=>{if(historyNext!==null)history(historyVersion,historyTask,historyNext).catch(e=>message(e.message));};
async function tasks(version,offset=0){
  const data=await api('/api/versions/'+version.id+'/tasks?offset='+offset);
  selectedVersion=version;taskOffset=offset;nextTaskOffset=data.nextOffset;
  $('tasks-panel').hidden=false;$('tasks-heading').textContent=version.displayName+' · 任务快照';
  $('task-count').textContent='共 '+data.total+' 张，本页 '+data.items.length+' 张。';$('tasks').replaceChildren();
  for(const item of data.items){const row=document.createElement('tr');
    cell(row,item.visibleKey);cell(row,item.title);cell(row,item.typeName);cell(row,item.category);cell(row,item.functionName ? item.functionName+(item.functionResolution==='confirmed'?'':'（待配置）') : (item.functionResolution==='missing'?'未填写':'职能待配置'));
    cell(row,item.parentVisibleKey ?? (item.parentSourceTaskId?'父任务未纳入':'无'));
    cell(row,item.rawStatus);cell(row,presenceNames[item.sourcePresence]??'待核对');cell(row,item.structureIssues.length?item.structureIssues.map(i=>issueNames[i] ?? i).join('；'):(item.availability==='unknown'?'待识别':'已通过当前结构检查'));
    cell(row,'').append(button('查看历史',()=>history(version,item)));
    $('tasks').append(row);
  }
  $('tasks-prev').disabled=offset===0;$('tasks-next').disabled=data.nextOffset===null;
}
async function versions(){
  const items=await api('/api/versions');$('versions').replaceChildren();
  if(!items.length){const row=document.createElement('tr');const td=cell(row,'尚未纳入版本。');td.colSpan=7;$('versions').append(row);}
  for(const version of items){const row=document.createElement('tr');
    cell(row,version.displayName);cell(row,version.ownerName ?? '待确认');cell(row,date(version.syncStartAt));
    cell(row,(syncNames[version.syncStatus] ?? version.syncStatus)+' · '+date(version.lastSuccessAt)+(version.lastErrorCode?' · '+version.lastErrorCode:''));
    cell(row,!pollingEnabled?'自动轮询未启用':!version.ownerConfirmed?'负责人待确认，自动同步暂停':'下次检查：'+date(version.nextDueAt));
    cell(row,version.bindingVerifiedAt?'已核对 · 配置版本 '+version.configVersion:'待首次核对');
    const actions=cell(row,'');actions.append(button('查看任务',()=>tasks(version)));
    if(['owner','admin'].includes(actor.role))actions.append(button('读取来源并同步',async()=>{
      const reason=window.prompt('请填写本次同步原因。取消则不执行。');if(!reason?.trim())return;
      message('正在读取来源并核对结构，请等待结果。');
      const result=await api('/api/versions/'+version.id+'/sync','POST',{reason});
      message(result.status==='succeeded'?'同步完成：'+result.importedCount+' 张任务，'+result.issueCount+' 张存在结构问题。'+(result.reconciledCount?'另有 '+result.reconciledCount+' 张来源变化记录保留，请核对来源可用性。':''):'同步失败：'+result.errorCode+'。已有数据保留。');
      await versions();await tasks(version);await audit();
    }));
    $('versions').append(row);
  }
}
$('refresh-versions').onclick=async()=>{
  const refresh=$('refresh-versions'),status=$('versions-feedback');
  refresh.disabled=true;status.textContent='正在刷新本机版本列表，请等待结果。';
  try{await versions();if(selectedVersion)await tasks(selectedVersion,taskOffset);status.textContent='刷新完成：已读取本机版本列表'+(selectedVersion?'及当前任务快照':'')+'。数据未变化时内容保持不变；更新 TB 事实请点击“读取来源并同步”。';}
  catch(error){status.textContent='刷新未完成：'+error.message;message(status.textContent);}
  finally{refresh.disabled=false;}
};
$('tasks-prev').onclick=()=>tasks(selectedVersion,Math.max(0,taskOffset-100)).catch(error=>message(error.message));
$('tasks-next').onclick=()=>{if(nextTaskOffset!==null)tasks(selectedVersion,nextTaskOffset).catch(error=>message(error.message));};
$('enroll-version').onsubmit=async event=>{
  event.preventDefault();const submit=event.target.querySelector('button'),feedback=$('enroll-feedback');submit.disabled=true;
  const report=text=>{feedback.textContent=text;message(text);};
  report('正在核对来源并保存负责人，请等待结果。');
  try{const option=$('source-candidate').selectedOptions[0],owner=$('version-owner').selectedOptions[0];
    await api('/api/versions','POST',{projectId:option.dataset.project,versionId:option.value,ownerId:owner.value,reason:$('enroll-reason').value});
    const saved='确认成功：'+option.textContent+'；版本负责人：'+owner.textContent+'。';
    report(saved+(pollingEnabled?'自动同步将在调度检查后执行，可稍后刷新查看结果。':'可点击“读取来源并同步”更新任务快照。'));
    try{await versions();await audit();}catch{report(saved+'列表或审计刷新失败，请点击“刷新版本列表”或“刷新审计”；无需重复确认。');}
  }catch(error){report('确认未完成：'+error.message+'。请核对页面中的版本和负责人；若请求中断，请先刷新列表核对保存结果。');}finally{submit.disabled=false;}
};
async function candidates(){
  const choices=await api('/api/source-candidates');$('source-candidate').replaceChildren();
  const people=await api('/api/version-people');
  for(const person of people){const option=document.createElement('option');option.value=person.id;option.textContent=person.displayName;$('version-owner').append(option);}
  for(const item of choices){const option=document.createElement('option');option.value=item.versionId;option.dataset.project=item.projectId;option.textContent=item.projectName+' · '+item.versionName;$('source-candidate').append(option);}
  $('enroll-version').hidden=!$('source-candidate').options.length;
}
try{
  const health=await api('/healthz');
  if(!health.loginEnabled){message('服务可用，登录尚未启用。请先核对首位所有者、访问名单和钉钉回调配置。');}
  else{
    try{actor=await api('/api/me');}catch(error){if(!error.message.startsWith('401'))throw error;}
    if(actor){$('account').hidden=false;$('identity').textContent=actor.displayName+' · '+names[actor.role];message('身份及当前权限校验通过。');
      pollingEnabled=(await api('/api/status')).pollingEnabled;$('versions-section').hidden=false;await versions();
      if(actor.role==='owner'){$('management').hidden=false;await people();}
      if(['admin','owner'].includes(actor.role)){$('audit-section').hidden=false;await audit();try{await candidates();}catch{message('来源候选读取失败，已保存的版本和任务仍可查看。');}}
      try{const {setupFeedback}=await import('/feedback-ui.js');await setupFeedback(actor,api);}catch{message('反馈区域加载失败，可刷新重试。');}
      try{const {setupManagement}=await import('/management-ui.js');await setupManagement(actor,api);}catch{message('规则与阶段区域加载失败，可刷新重试；其他功能仍可使用。');}
    }else{$('login').hidden=false;const code=new URL(location.href).searchParams.get('login');message(code==='403'?'当前钉钉身份未获授权，或企业身份验证未通过。':code?'登录失败，请重新发起或联系管理员。':'请使用已明确授权的钉钉账号登录。');}
  }
}catch{message('服务暂不可用，请联系管理员检查数据库及配置。');}
