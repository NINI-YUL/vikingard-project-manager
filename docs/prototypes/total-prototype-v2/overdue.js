(()=>{
function compactOverdue(){
 const section=document.querySelector('#overdue-section');if(!section||section.dataset.compactOverdue)return;section.dataset.compactOverdue='true';
 const groups=[...section.querySelectorAll(':scope>.overdue-group')];
 const table=document.createElement('div');table.className='overdue-compact-table';table.setAttribute('role','table');table.setAttribute('aria-label','按需求分组的已逾期工单');
 const header=document.createElement('div');header.className='overdue-compact-head';header.setAttribute('role','row');
 for(const label of ['工单 / 所属需求','负责人','逾期','当前情况']){const cell=document.createElement('span');cell.setAttribute('role','columnheader');cell.textContent=label;header.append(cell)}table.append(header);
 groups.forEach(group=>{
  const demand=group.querySelector('.overdue-demand'),demandName=demand.querySelector('b'),meta=demand.querySelector('.note'),period=group.querySelector('.period-detail');
  group.setAttribute('role','rowgroup');group.querySelector('.overdue-items').setAttribute('role','presentation');
  const items=[...group.querySelectorAll('[data-workitem]')];
  items.forEach((item,index)=>{
   item.setAttribute('role','row');
   const title=item.querySelector(':scope>b');const spans=[...item.querySelectorAll(':scope>span')];
   const identity=document.createElement('div');identity.className='overdue-identity';identity.setAttribute('role','cell');
   const link=document.createElement('button');link.type='button';link.className='overdue-task-link';link.setAttribute('aria-label','查看工单：'+title.textContent);link.append(title);link.addEventListener('click',e=>{e.stopPropagation();item.click()});identity.append(link);
   if(index===0){const sub=document.createElement('div');sub.className='overdue-context';sub.append(demandName,meta);identity.append(sub)}
   item.prepend(identity);spans.forEach((span,i)=>{span.setAttribute('role','cell');span.classList.add(['overdue-owner-cell','overdue-days-cell','overdue-reason-cell'][i]);span.dataset.column=['负责人','逾期','当前情况'][i]});
   const action=document.createElement('div');action.className='overdue-period-cell';action.setAttribute('role','presentation');
   if(index===0&&period){period.querySelector('summary').textContent='查看';period.querySelector('summary').setAttribute('aria-label','查看'+demandName.textContent+'逾期区间示意');period.addEventListener('click',e=>e.stopPropagation());action.append(period)}item.append(action);
  });
  demand.remove();table.append(group);
 });
 section.append(table);
 const headerActions=document.createElement('div');headerActions.className='overdue-header-actions';
 const toggle=document.createElement('button');toggle.type='button';toggle.className='overdue-interval-toggle light-object';toggle.textContent='区间示意';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','展开全部逾期区间示意');
 toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'收起区间':'区间示意';toggle.setAttribute('aria-label',open?'收起全部逾期区间示意':'展开全部逾期区间示意');section.querySelectorAll('.period-detail').forEach(d=>d.open=open)});
 const count=section.querySelector('#overdue-section-count');headerActions.append(toggle,count);section.querySelector(':scope>.section-head').append(headerActions);
 const empty=document.createElement('div');empty.className='overdue-compact-empty';empty.textContent='当前筛选范围内暂无逾期工单';empty.hidden=true;section.append(empty);
 refreshCompact();
}
function refreshCompact(){const section=document.querySelector('#overdue-section');if(!section?.dataset.compactOverdue)return;const visible=[...section.querySelectorAll('[data-workitem]')].filter(e=>!e.hidden).length;section.querySelector('.overdue-compact-table').hidden=visible===0;section.querySelector('.overdue-interval-toggle').disabled=visible===0;section.querySelector('.overdue-compact-empty').hidden=visible!==0}
const previousRender=render;render=function(){previousRender();compactOverdue()};const previousFilters=applyFilters;applyFilters=function(){previousFilters();refreshCompact()};compactOverdue();
})();

