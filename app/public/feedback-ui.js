export async function setupFeedback(actor,api) {
  const $=id=>document.getElementById(id),admin=['admin','owner'].includes(actor.role);
  let data,offset=0,next=null;
  const say=text=>{$('fb-message').textContent=text;};
  const date=value=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(value)):'未知';
  function options(id,items,label,value,placeholder) {
    $(id).replaceChildren();if(placeholder){const option=document.createElement('option');option.value='';option.textContent=placeholder;$(id).append(option);}
    for(const item of items){const option=document.createElement('option');option.value=value(item);option.textContent=label(item);$(id).append(option);}
  }
  async function load(page=0) {
    offset=page;data=await api('/api/feedback/versions/'+$('fb-version').value+'?offset='+offset);next=data.nextOffset;
    $('fb-current').replaceChildren();
    for(const item of data.items){const row=document.createElement('tr');for(const value of [(item.visibleKey??'未知编号')+' · '+item.title,item.progressPercent==null?'未知':item.progressPercent+'%',({valid:'当前有效',unknown:'未知',review:'待复核'})[item.state]??'未知',date(item.submittedAt),(item.reasons??[]).join('；')]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('fb-current').append(row);}
    $('fb-count').textContent='共 '+data.total+' 张任务；'+data.validationTotal+' 条原始修订；'+data.historyTotal+' 条有效历史。当前第 '+(offset/100+1)+' 页。';
    $('fb-validations').textContent=JSON.stringify(data.validations,null,2);$('fb-history').textContent=JSON.stringify(data.history,null,2);$('fb-prev').disabled=offset===0;$('fb-next').disabled=next==null;
    if(admin){
      options('fb-source',data.sources,s=>s.baseId+' / '+s.sheetId+' · '+(s.enabled?'启用':'停用')+' · 首次确认 '+date(s.confirmedAt),s=>s.enabled?s.id:'','请选择已确认来源');
      options('fb-executor',data.executors,e=>e.id+' · '+(e.name??'尚未映射'),e=>e.id,'请选择当前实际执行者');
      options('fb-person',data.people,p=>p.name+' · '+p.id,p=>p.id,'请选择已确认人员');
      options('fb-review',data.validations.filter(v=>v.verdict==='review'&&!v.approved&&v.situation==='存在风险'),v=>v.recordId+' · '+v.progressPercent+'% · '+v.reasons.join('；'),v=>v.validationId,'请选择待复核记录');
    }
  }
  async function perform(form,action,success) {
    const button=form.querySelector('button[type=submit]');button.disabled=true;say('正在处理，请等待结果。');
    let saved=false;
    try{await action();saved=true;say(success);await load(0);}catch(error){say(saved?success+' 列表刷新失败，请刷新核对结果；无需重复提交。':'操作未完成：'+error.message+'。如请求中断，请先刷新核对结果。');}finally{button.disabled=false;}
  }
  $('fb-refresh').onclick=()=>load(0).then(()=>say('已按当前任务、身份和状态重新校验。')).catch(e=>say(e.message));
  $('fb-version').onchange=()=>load(0).catch(e=>say(e.message));$('fb-prev').onclick=()=>load(Math.max(0,offset-100)).catch(e=>say(e.message));$('fb-next').onclick=()=>{if(next!=null)load(next).catch(e=>say(e.message));};
  $('fb-source-form').onsubmit=event=>{event.preventDefault();void perform(event.target,()=>api('/api/feedback/configure','POST',{kind:'source',projectId:data.projectId,baseId:$('fb-base').value.trim(),sheetId:$('fb-sheet').value.trim(),enabled:$('fb-source-enabled').checked,confirmed:$('fb-source-confirm').checked,reason:$('fb-source-reason').value}),'来源已保存；反馈仍须按当前任务、跟踪区间和可信身份重新校验。');};
  $('fb-executor-form').onsubmit=event=>{event.preventDefault();void perform(event.target,()=>api('/api/feedback/configure','POST',{kind:'executor',projectId:data.projectId,executorId:$('fb-executor').value,personId:$('fb-person').value,enabled:$('fb-mapping-enabled').checked,confirmed:$('fb-mapping-confirm').checked,reason:$('fb-mapping-reason').value}),'执行者映射已保存，当前反馈已重新校验。');};
  $('fb-read-form').onsubmit=event=>{event.preventDefault();void perform(event.target,()=>api('/api/feedback/read','POST',{sourceId:$('fb-source').value,versionId:$('fb-version').value,reason:$('fb-read-reason').value}),'读取已完成；原始修订、校验、有效历史和当前值已在本机事务中保存。');};
  $('fb-review-form').onsubmit=event=>{event.preventDefault();void perform(event.target,()=>api('/api/feedback/approve','POST',{validationId:$('fb-review').value,confirmed:$('fb-review-confirm').checked,reason:$('fb-review-reason').value}),'风险说明复核已保存；当前值仍按平台创建时间和当前资格选择。');};
  const versions=await api('/api/versions');options('fb-version',versions,v=>v.displayName,v=>v.id);$('feedback-section').hidden=false;$('fb-admin').hidden=!admin;
  if(versions.length)await load(0);else say('尚未纳入受控版本。');
}
