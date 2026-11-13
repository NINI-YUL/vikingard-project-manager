let actor;
const $ = id => document.getElementById(id);
const names = {none:'无后台权限',viewer:'查看者',admin:'系统管理员',owner:'系统所有者'};
function message(text) { $('message').textContent=text; }
async function api(path,method='GET',value) {
  const response=await fetch(path,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json','x-csrf-token':actor?.csrf ?? ''}:{})},...(value?{body:JSON.stringify(value)}:{})});
  const data=await response.json();
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
try{
  const health=await api('/healthz');
  if(!health.loginEnabled){message('服务可用，登录尚未启用。请先核对首位所有者、访问名单和钉钉回调配置。');}
  else{
    try{actor=await api('/api/me');}catch(error){if(!error.message.startsWith('401'))throw error;}
    if(actor){$('account').hidden=false;$('identity').textContent=actor.displayName+' · '+names[actor.role];message('身份及当前权限校验通过。');
      if(actor.role==='owner'){$('management').hidden=false;await people();}
      if(['admin','owner'].includes(actor.role)){$('audit-section').hidden=false;await audit();}
    }else{$('login').hidden=false;const code=new URL(location.href).searchParams.get('login');message(code==='403'?'当前钉钉身份未获授权，或企业身份验证未通过。':code?'登录失败，请重新发起或联系管理员。':'请使用已明确授权的钉钉账号登录。');}
  }
}catch{message('服务暂不可用，请联系管理员检查数据库及配置。');}
