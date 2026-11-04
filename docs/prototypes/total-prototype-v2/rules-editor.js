(()=>{
 function refreshFeedback(root,e){
  if(!e)return;
  root.querySelectorAll('[data-rules-function]').forEach(input=>{const other=input.dataset.rulesFunction==='foundation'?'细节完整':'基础流程';const text=input.disabled?'已选入'+other+'，请先在该阶段取消选择':'选择'+input.value;input.title=text;input.closest('label').title=text;input.setAttribute('aria-label',input.value+(input.disabled?'：'+text:''))});
  const review=root.querySelector('.rules-editor-review');if(!review)return;
  let summary=review.querySelector('.rules-change-summary');if(!summary){summary=document.createElement('div');summary.className='rules-change-summary';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');review.querySelector('h3').after(summary)}
  const own=rulesOwn(e.ctx),parent=rulesParent(e.ctx),rows=[];
  for(const f of rulesFields){
   if(f==='threshold'&&e.ctx.scope!=='system')continue;
   const restore=e.mode==='restore'?Object.hasOwn(own,f):e.reset.includes(f);
   const changed=!rulesEqual(f,e.values[f],e.initial[f].value);
   if(!restore&&!changed)continue;
   const target=restore?parent[f].value:e.values[f];
   const inherit=e.ctx.scope!=='system'&&(restore||rulesEqual(f,target,parent[f].value));
   let description;
   if(restore)description='恢复'+parent[f].source+'：'+rulesFormat(f,target)+(rulesEqual(f,target,e.initial[f].value)?'（生效值不变）':'');
   else if(f==='foundation'||f==='detail'){const added=target.filter(x=>!e.initial[f].value.includes(x)),removed=e.initial[f].value.filter(x=>!target.includes(x));description=[added.length?'新增'+added.join('、'):'',removed.length?'移除'+removed.join('、'):''].filter(Boolean).join('；')}
   else if(f==='schedules'){const key=x=>x.day+'/'+x.time;const added=target.filter(x=>!e.initial[f].value.some(y=>key(y)===key(x))),removed=e.initial[f].value.filter(x=>!target.some(y=>key(y)===key(x)));description=[added.length?'新增'+rulesFormat(f,added):'',removed.length?'移除'+rulesFormat(f,removed):''].filter(Boolean).join('；')}
   else description=rulesFormat(f,e.initial[f].value)+' → '+(rulesFormat(f,target)||'未设置');
   if(inherit&&!restore)description+='；保存后继承'+parent[f].source;
   else if(e.ctx.scope!=='system'&&!restore)description+='；保存为当前'+(e.ctx.scope==='version'?'版本':'需求')+'配置';
   rows.push([rulesLabels[f],description]);
  }
  summary.hidden=rows.length===0;summary.replaceChildren();if(!rows.length)return;
  const heading=document.createElement('b');heading.textContent='本次变更';summary.append(heading);const list=document.createElement('ul');for(const [name,description]of rows){const li=document.createElement('li');const title=document.createElement('strong');title.textContent=name+'：';li.append(title,document.createTextNode(description));list.append(li)}summary.append(list);const note=document.createElement('p');note.textContent='其他项不变，继承关系保留。';summary.append(note);
 }
 function textRows(node,rows){node.replaceChildren();node.classList.add('rules-short-copy');for(const [name,value]of rows){const row=document.createElement('span');row.className='rules-copy-row';const label=document.createElement('span');label.className='rules-copy-label';label.textContent=name+'：';const content=document.createElement('span');content.textContent=value;row.append(label,content);node.append(row)}}
 const original=rulesDialogContent;
 rulesDialogContent=function(){
  const html=original(),template=document.createElement('template');template.innerHTML=html;
  const root=template.content,body=root.querySelector('.rules-dialog-body'),sections=[...body.querySelectorAll(':scope>.rules-dialog-section')],e=state.rules.editor;
  root.querySelector('.rules-dialog-head').classList.add('rules-editor-head');
  body.classList.add('rules-editor-body');
  const impact=body.querySelector('.rules-impact');
  if(e.mode!=='restore'){
   const progress=sections[0],followup=sections[1];progress.classList.add('rules-editor-progress');followup.classList.add('rules-editor-followup');
   progress.querySelector('h3').textContent='进度完成条件';followup.querySelector('h3').textContent='采集时间与开发关注';
   const fields=progress.querySelectorAll(':scope>.rules-editor-field');
   fields.forEach((field,index)=>{
    field.classList.add(index===2?'rules-editor-fixed':'rules-editor-card');
    field.querySelector('.rules-field-head>b').textContent=['基础流程完成条件','细节完整完成条件','测试完成条件'][index];
    if(index<2){const legend=field.querySelector('legend');legend.textContent=index===0?'所选职能全部完成后，可开始验收测试。':'基础流程完成后，还须完成以下职能。';field.querySelector('[data-rules-source]').classList.add('rules-editor-source')}
    else{field.querySelector('.rules-source').textContent='固定 · 只读';textRows(field.querySelector('p'),[['完成条件','全部应处理工单达到完成终态；已取消、已拒绝、无需处理的工单不阻塞完成。'],['无法确认','必要数据缺失或状态未知时，不算完成。'],['注意','完成不代表上线。']])}
   });
   const tip=document.createElement('p');tip.className='rules-function-hint';tip.textContent='职能不可重复选择。灰色项已归入另一阶段，须先取消原选择。';fields[1].after(tip);
   const settings=followup.querySelectorAll(':scope>.rules-editor-field');settings.forEach(field=>field.classList.add('rules-editor-card'));
   settings[0].querySelector('.rules-field-head>b').textContent='进度采集时间';
   settings[0].querySelector('[data-rules-source]').classList.add('rules-editor-source');
   textRows(settings[0].querySelector('p:not([data-rules-source])'),[['时区','北京时间'],['采集范围','工单未完成且存在执行者']]);
   settings[1].querySelector('.rules-source').textContent='全部活跃版本';
   textRows(settings[1].querySelector('p:last-child'),[['关注条件','同一执行者的工单计划区间重叠达到阈值'],['处理方式','提示复核']]);
   root.querySelectorAll('.rules-source').forEach(node=>{if(node.textContent==='系统默认')node.remove()});
  }
  root.querySelectorAll('[data-rules-inherit]').forEach(button=>{button.textContent=button.textContent.replace('使用上层值 · ','使用上层值（')+'）'});
  root.querySelectorAll('[data-rules-source]').forEach(node=>{node.textContent=node.textContent.replace('当前来源：','来源：').replace('；未修改继续沿用','')});
  const review=document.createElement('section');review.className='rules-editor-review';
  const title=document.createElement('h3');title.textContent=e.mode==='restore'?'确认影响并说明原因':'保存前确认';review.append(title);
  const label=body.querySelector('.rules-reason'),reason=body.querySelector('[data-rules-reason]');label.textContent='变更原因（必填）';
  label.before(review);review.append(impact,label,reason);
  const caption=root.querySelector('.rules-dialog-actions>span.note');if(caption)caption.remove();
  const scope=e.ctx.scope,range=scope==='system'?'未单独配置对应项的版本和需求；关注阈值适用于全部活跃版本':scope==='version'?'当前版本及未单独配置对应项的下属需求':'仅当前需求';
  textRows(impact,[['影响范围',range],['生效范围','后续判断和采集'],['不影响','已留档历史、旧通知、实际上线认定']]);
  if(e.mode==='restore'){sections[0].querySelector('h3').textContent='移除当前对象的特殊配置';sections[0].querySelector('p').textContent='恢复上层最新值，保留操作记录。'}
  reason.placeholder='说明调整原因';
  refreshFeedback(root,e);
  return template.innerHTML;
 };
 for(const event of ['input','change','click'])document.addEventListener(event,ev=>{if(!ev.target.closest('#rules-dialog'))return;setTimeout(()=>{const dialog=document.getElementById('rules-dialog');if(dialog)refreshFeedback(dialog,state.rules.editor)},0)},true);
})();
