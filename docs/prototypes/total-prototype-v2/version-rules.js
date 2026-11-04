(()=>{
function decorate(){
 const active=state.page==='config'&&state.cfg.space==='version';document.body.classList.toggle('version-rules-d',active);if(!active||state.cfg.tab!=='rules')return;
 const workspace=document.querySelector('.rules-workspace');if(!workspace)return;
 workspace.querySelectorAll('.rules-kicker,.rules-stage-index').forEach(n=>n.remove());
 const panels=[...workspace.children].filter(n=>n.classList.contains('rules-panel'));panels.forEach((panel,i)=>panel.classList.add(i===0?'rules-object-panel':i===1?'rules-progress-panel':'rules-followup-panel'));
 const object=panels[0];if(!object)return;
 if(!object.querySelector('.rules-object-controls')){const controls=document.createElement('div');controls.className='rules-object-controls';const scope=object.querySelector('.rules-scope'),selectors=object.querySelector('.rules-selectors');scope.before(controls);controls.append(scope);if(selectors)controls.append(selectors)}
 const controls=object.querySelector('.rules-object-controls'),scopeGroup=controls.querySelector('.rules-scope');
 if(!scopeGroup.closest('.rules-scope-field')){const field=document.createElement('div');field.className='rules-scope-field';const label=document.createElement('span');label.className='rules-control-label';label.textContent='配置层级';scopeGroup.before(field);field.append(label,scopeGroup)}
 const ctx=rulesContext(),resolved=rulesResolve(ctx),own=rulesOwn(ctx),isSystem=ctx.scope==='system';
 const objectName=isSystem?'系统默认':ctx.scope==='version'?ctx.version:ctx.version+' / '+ctx.requirement;
 object.querySelector('h2').textContent='当前配置：'+objectName;
 object.querySelector('.rules-panel-head p').textContent='先选择配置层级，再选择要查看或修改的对象。';
 const edit=object.querySelector('[data-rules-edit]');edit.setAttribute('aria-label','编辑配置：'+objectName);
 const fields=['foundation','detail','schedules'],ownCount=fields.filter(f=>Object.hasOwn(own,f)).length;
 const status=isSystem?'系统基础配置':ownCount===0?'全部继承上层配置':ownCount===3?'3 项已设置特殊配置':ownCount+' 项特殊配置，其余继承上层';
 const impact=isSystem?'修改后影响未覆盖对应配置项的版本和需求；开发关注阈值对全部活跃版本生效。':ctx.scope==='version'?'修改后影响当前版本及未覆盖对应配置项的下属需求，不影响其他版本。':'修改只影响当前需求，不修改版本或系统默认。';
 const context=object.querySelector('.rules-context');context.classList.add('rules-object-summary');context.replaceChildren();
 const sourceRow=document.createElement('div');sourceRow.className='rules-object-status';const label=document.createElement('span');label.textContent='继承状态';const value=document.createElement('b');value.textContent=status;sourceRow.append(label,value);context.append(sourceRow);
 if(!isSystem){const source=document.createElement('div');source.className='rules-object-sources';source.textContent='基础流程：'+resolved.foundation.source+' · 细节完整：'+resolved.detail.source+' · 进度采集：'+resolved.schedules.source;context.append(source)}
 const range=document.createElement('div');range.className='rules-object-impact';const rangeLabel=document.createElement('span');rangeLabel.textContent='影响范围';const rangeValue=document.createElement('span');rangeValue.textContent=impact;range.append(rangeLabel,rangeValue);context.append(range);
 const addMeta=(node,source,editable)=>{if(!node)return;node.classList.add('rules-field-meta');node.replaceChildren();const origin=document.createElement('span');origin.textContent='来源：'+source;const ability=document.createElement('span');ability.className='rules-field-ability';ability.textContent=editable;node.append(origin,ability)};
 const stages=workspace.querySelectorAll('.rules-stage');
 addMeta(stages[0]?.querySelector('.rules-source'),resolved.foundation.source,isSystem?'可修改系统默认':'可为当前'+(ctx.scope==='version'?'版本':'需求')+'单独配置');
 addMeta(stages[1]?.querySelector('.rules-source'),resolved.detail.source,isSystem?'可修改系统默认':'可为当前'+(ctx.scope==='version'?'版本':'需求')+'单独配置');
 addMeta(stages[2]?.querySelector('.rules-source'),'固定规则','只读，不可修改');
 const settings=workspace.querySelectorAll('.rules-setting');
 addMeta(settings[0]?.querySelector('.rules-source'),resolved.schedules.source,isSystem?'可修改系统默认':'可为当前'+(ctx.scope==='version'?'版本':'需求')+'单独配置');
 addMeta(settings[1]?.querySelector('.rules-source'),'系统默认 · 全部活跃版本',isSystem?'可在当前层级修改':'仅系统默认可修改');
 // Present values first and retain constraints without repeating edit instructions.
 object.querySelector('.rules-panel-head p')?.remove();
 if(isSystem)context.querySelector('.rules-object-status')?.remove();
 rangeValue.textContent=isSystem?'影响未单独配置对应项的版本和需求；开发关注阈值对全部活跃版本生效。':ctx.scope==='version'?'影响当前版本及未单独配置对应项的下属需求。':'仅影响当前需求。';
 const progress=workspace.querySelector('.rules-progress-panel');
 if(progress){progress.querySelector('h2').textContent='进度完成条件';progress.querySelector('.rules-panel-head p')?.remove()}
 const titles=['基础流程完成条件','细节完整完成条件','测试阶段完成条件 · 固定规则'];
 const descriptions=['所选职能的工单全部处理完成后，可开始验收测试。','基础流程与以下职能的工单全部处理完成后，开发内网才算全部完成。','全部应处理的后代工单满足终态要求后，才可进入上线确认；不代表已经上线。'];
 stages.forEach((stage,i)=>{stage.querySelector('h3').textContent=titles[i];const description=stage.querySelector('p'),values=stage.querySelector('.rules-values');description.textContent=descriptions[i];if(values)values.after(description);const meta=stage.querySelector('.rules-field-meta');if(i===2||isSystem)meta?.remove();else meta?.querySelector('.rules-field-ability')?.remove()});
 const followup=workspace.querySelector('.rules-followup-panel');if(followup)followup.querySelector('h2').textContent='进度采集与开发关注';
 if(settings[0]){settings[0].querySelector('h3').textContent='进度采集时间';if(isSystem)settings[0].querySelector('.rules-field-meta')?.remove();else settings[0].querySelector('.rules-field-ability')?.remove();settings[0].querySelector('p').textContent='北京时间，仅在公司工作日执行。调休和特殊工作日也须命中所选星期、时刻；休息日跳过，不补发。'}
 if(settings[1]){const meta=settings[1].querySelector('.rules-field-meta');meta.querySelector('span').textContent='全部活跃版本';if(isSystem)meta.querySelector('.rules-field-ability')?.remove()}

 if(!isSystem){
  const hasEditableRules=fields.some(f=>Object.hasOwn(own,f));
  if(hasEditableRules)context.querySelector('.rules-object-sources')?.remove();
  const inherit=workspace.querySelector('.rules-inherit');
  if(inherit&&ctx.version&&(ctx.scope!=='requirement'||ctx.requirement)){
   inherit.classList.add('rules-inherit-concise');
   inherit.querySelector('h2').textContent='沿用上层规则';
   const copy=inherit.querySelectorAll('p');
   copy[0].textContent='如需单独调整，点击“编辑配置”；未修改的项继续继承上层。';
   copy[1]?.remove();
  }
  workspace.querySelectorAll('.rules-field-meta').forEach(meta=>{
   const origin=meta.querySelector('span');if(!origin||meta.closest('.rules-setting')===settings[1])return;
   const source=origin.textContent.replace('来源：','');
   const explicit=source===(ctx.scope==='version'?'版本配置':'需求配置');
   meta.classList.toggle('rules-own-value',explicit);
   origin.textContent=explicit?(ctx.scope==='version'?'当前版本配置':'当前需求配置'):'继承'+source;
  });
  const sources=context.querySelector('.rules-object-sources');
  if(sources){sources.replaceChildren();for(const [key,title]of [['foundation','基础流程'],['detail','细节完整'],['schedules','进度采集']]){const row=document.createElement('span');row.className='rules-inherited-source';const name=document.createElement('span');name.textContent=title;const value=document.createElement('b');value.textContent=resolved[key].source;row.append(name,value);sources.append(row)}}
 }
 workspace.classList.add('rules-concise');

}
const base=render;render=function(){base();decorate()};decorate();
const previewParams=new URLSearchParams(location.search),previewScope=previewParams.get('ruleScope');if(previewParams.get('page')==='rules'&&['system','version','requirement'].includes(previewScope)){state.cfg.scope=previewScope;render()}
})();