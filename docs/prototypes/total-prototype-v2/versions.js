(()=>{
function styleVersions(){const main=document.querySelector('.shell>.main'),active=!!main?.querySelector('.version-workspace');main?.classList.toggle('version-style',active);document.body.classList.toggle('version-preview',active);if(!active)return;main.querySelectorAll('.detail-table').forEach(table=>{if(!table.closest('.version-table-scroll')){const wrap=document.createElement('div');wrap.className='version-table-scroll';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','核心需求进展与风险，窄屏可横向滚动');table.before(wrap);wrap.append(table)}table.querySelectorAll('tbody tr[data-drill]').forEach(row=>{if(row.querySelector('.version-requirement-link'))return;const cell=row.cells[0],button=document.createElement('button');button.type='button';button.className='version-requirement-link';button.textContent=cell.textContent;button.setAttribute('aria-label','查看需求：'+cell.textContent);button.onclick=e=>{e.stopPropagation();row.click()};cell.replaceChildren(button)})})}
const previousRender=render;render=function(){previousRender();styleVersions()};
styleVersions();
})();

