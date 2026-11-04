(()=>{
 const originalNotices=cfgNotices;
 cfgNotices=function(){const t=document.createElement('template');t.innerHTML=originalNotices();const note=t.content.querySelector('.cfg-section-body.note');note.classList.add('people-notice-conditions');note.replaceChildren();const rows=[['投递条件','通知节点已触发、需求关系符合规则、身份映射已确认。'],['权限边界','系统权限不增加通知资格；无法投递时，不自动替换接收人。'],['接收人核对','在对应需求中查看具体接收人；本页不逐人模拟或推算人数。']];for(const [name,value]of rows){const line=document.createElement('div');const label=document.createElement('span');label.textContent=name;const content=document.createElement('span');content.textContent=value;line.append(label,content);note.append(line)}return t.innerHTML};
 const originalDialog=peopleDialog;
 peopleDialog=function(){const t=document.createElement('template');t.innerHTML=originalDialog();if(!t.content.querySelector('dialog'))return t.innerHTML;const d=t.content.querySelector('dialog');d.classList.add('people-dialog-d');const body=d.querySelector('.person-dialog-body');if(state.personModal==='edit'){
  const sections=body.querySelectorAll('.person-form-section');sections[0].querySelector('h3').textContent='身份映射';
  const roleTitle=sections[1].querySelector('h3');roleTitle.replaceChildren(document.createTextNode('业务角色'));const small=document.createElement('small');small.textContent='用于通知匹配';roleTitle.append(small);
  const permissionTitle=sections[2].querySelector('h3');permissionTitle.replaceChildren(document.createTextNode('系统权限'));const hint=document.createElement('small');hint.textContent='用于后台访问与操作';permissionTitle.append(hint);
  const group=document.createElement('div');group.className='people-access-groups';sections[1].before(group);group.append(sections[1],sections[2]);
  body.querySelector('[data-person-unmapped]').textContent='未映射：不能保留业务角色和系统权限，保存后撤销这些配置及后续通知资格。';
  const label=body.querySelector('.person-reason'),reason=body.querySelector('[name="reason"]'),error=body.querySelector('#person-reason-error');const review=document.createElement('section');review.className='people-change-reason';label.before(review);review.append(label,reason,error);
 }else{body.querySelector('.person-delete-copy').textContent='移除本系统的身份映射、业务角色和系统权限，停止后续通知。Teambition、钉钉账号及已同步事实不删除，操作记录保留。'}return t.innerHTML};
 function decorate(){document.body.classList.toggle('people-notices-d',state.page==='config'&&state.cfg.space==='people')}
 const base=render;render=function(){base();decorate()};const params=new URLSearchParams(location.search);if(params.get('page')==='config'&&params.has('peopleTab')){state.cfg.space='people';state.cfg.tab=params.get('peopleTab')==='notice'?'notice':'people';render()}else decorate();
})();
