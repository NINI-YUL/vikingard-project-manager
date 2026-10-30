import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../docs/prototypes/config-dashboard-prototype.html",import.meta.url),"utf8");
const code=html.split("<script>")[1].split("</script>")[0];
function element(){return {value:"",textContent:"",hidden:false,dataset:{},focus(){},showModal(){},setAttribute(){},classList:{toggle(){}}}}
function prototype(){
  const app={innerHTML:""},elements=new Map([["app",app]]),selectors=new Map();
  const document={getElementById:id=>elements.get(id)||null,querySelector:selector=>selectors.get(selector)?.[0]||null,querySelectorAll:selector=>selectors.get(selector)||[],body:{classList:{toggle(){}}},activeElement:{tagName:"BODY"}};
  const c=vm.createContext({document,location:{search:"?variant=A&page=workitem",href:"http://localhost/?variant=A&page=workitem"},URL,URLSearchParams,addEventListener(){},history:{replaceState(){}},console});
  vm.runInContext(code,c);
  return {app,elements,selectors,run:source=>vm.runInContext(source,c)};
}
function editor(p){p.run('workTimeOpen();state.workTime.editor.reason="遗漏状态流转";state.workTime.editor.evidence="执行者确认及工作记录"')}

test("work item detail exposes actual-time panel and unified accessible editor",()=>{
  const p=prototype();assert.match(p.app.innerHTML,/工作单详情/);assert.match(p.app.innerHTML,/data-work-time-open/);
  editor(p);const result=p.run('workTimeDialog()');
  for(const label of ["原始记录","当前生效时间","调整后开始日期","调整后结束日期","变更原因（必填）","补录依据（必填）","对应轮次"])assert.ok(result.includes(label));
  assert.match(result,/aria-labelledby="work-time-title"/);assert.match(result,/data-work-time-phase/);
  assert.equal(p.run('state.workTime.editor.selected'),"development-2");
});

test("permission is independent from business roles and is enforced on opening and saving",()=>{
  const p=prototype();
  for(const role of ["none","viewer"]){
    p.run(`state.workTime.actor.permission=${JSON.stringify(role)}`);
    assert.doesNotMatch(p.run('workTimePanel(selectedWorkitem())'),/data-work-time-open/);
    assert.equal(p.run('workTimeOpen()'),false);
  }
  p.run('state.workTime.actor.permission="owner"');editor(p);
  p.run('state.workTime.editor.drafts["development-2"].start="2026-09-01";state.workTime.actor.permission="viewer"');
  assert.equal(p.run('workTimeSave()'),false);assert.equal(p.run('state.workTime.audit.length'),0);
  assert.match(p.run('state.workTime.editor.error'),/系统管理员或系统所有者/);
});

test("save preserves source, keeps unknown end empty and appends before-after audit",()=>{
  const p=prototype();editor(p);
  const raw=p.run('JSON.stringify(workitemSourceEvents(selectedWorkitem()))');
  p.run('state.workTime.editor.drafts["development-2"].start="2026-09-01"');
  assert.equal(p.run('workTimeSave()'),true);
  assert.equal(p.run('state.workTime.editor'),null);
  assert.equal(p.run('workTimeCurrentDevelopment(selectedWorkitem()).start'),"2026-09-02");
  assert.equal(p.run('workTimeCurrentDevelopment(selectedWorkitem()).override.start'),"2026-09-01");
  assert.equal(p.run('workTimeCurrentDevelopment(selectedWorkitem()).override.end'),null);
  assert.equal(p.run('state.workTime.audit[0].before.start'),"2026-09-02");
  assert.equal(p.run('state.workTime.audit[0].after.start'),"2026-09-01");
  assert.equal(p.run('state.workTime.audit[0].reason'),"遗漏状态流转");
  assert.equal(p.run('JSON.stringify(workitemSourceEvents(selectedWorkitem()))'),raw);
  assert.match(p.run('workitemDetailPage()'),/人工补录/);assert.match(p.run('workitemDetailPage()'),/待重新计算（演示）/);
  assert.match(p.run('workitemHistoryDrawer()'),/时间修正/);assert.match(p.run('workitemHistoryDrawer()'),/遗漏状态流转/);
  p.run('workTimeOpen()');assert.equal(p.run('state.workTime.editor.drafts["development-2"].start'),"2026-09-01");
});

test("required reason and evidence, valid dates and date ordering block writes atomically",()=>{
  const p=prototype();editor(p);
  p.run('state.workTime.editor.drafts["development-2"].start="2026-09-01";state.workTime.editor.reason="";state.workTime.editor.evidence=""');
  assert.equal(p.run('workTimeSave()'),false);assert.match(p.run('state.workTime.editor.fieldErrors.reason'),/原因/);assert.match(p.run('state.workTime.editor.fieldErrors.evidence'),/依据/);
  p.run('state.workTime.editor.reason="纠错";state.workTime.editor.evidence="对应工作记录"');
  for(const [start,end] of [["2026-09-03","2026-09-01"],["2026-02-30",null],["2099-01-01",null]]){
    p.run(`state.workTime.editor.drafts["development-2"]={start:${JSON.stringify(start)},end:${JSON.stringify(end)}}`);
    assert.equal(p.run('workTimeSave()'),false);assert.equal(p.run('state.workTime.audit.length'),0);assert.equal(p.run('workTimeCurrentDevelopment(selectedWorkitem()).override'),null);
  }
});

test("work items, phases and rounds remain isolated; audit and unknown values survive later edits",()=>{
  const p=prototype();editor(p);
  p.run('state.workTime.editor.drafts["development-1"].end="2026-08-31";state.workTime.editor.drafts["testing-1"].start="2026-09-10"');
  assert.match(p.run('workTimeSummary()'),/2 个轮次/);assert.equal(p.run('workTimeSave()'),true);
  assert.equal(p.run('state.workTime.audit.length'),2);
  assert.equal(p.run('workTimeRecords(selectedWorkitem())[0].override.start'),null);
  const key=p.run('workTimeKey(selectedWorkitem())');
  assert.equal(p.run('workTimeCurrentDevelopment(selectedWorkitem()).override'),null);
  p.run('state.selectedWorkitem=timelineItems.find(x=>x.timeDemoKey!==workTimeKey(selectedWorkitem()))');
  assert.notEqual(p.run('workTimeKey(selectedWorkitem())'),key);
  assert.equal(p.run('workTimeRecords(selectedWorkitem()).some(r=>r.override)'),false);
  assert.doesNotMatch(p.run('workitemHistoryDrawer()'),/遗漏状态流转/);
});

test("history renders correction reason and evidence as text, never executable markup",()=>{
  const p=prototype();editor(p);
  p.run('state.workTime.editor.reason="<script>test</script>";state.workTime.editor.evidence="<img onerror=alert(1)>";state.workTime.editor.drafts["development-2"].start="2026-09-01";workTimeSave()');
  for(const code of ['workitemDetailPage()','workitemHistoryDrawer()']){
    assert.match(p.run(code),/&lt;script&gt;/);assert.doesNotMatch(p.run(code),/<script>test/);assert.doesNotMatch(p.run(code),/<img onerror/);
  }
});

test("bound editor preserves inputs across phase switches, submits and cancels with no writes",()=>{
  const p=prototype(),open=element();p.selectors.set('[data-work-time-open]',[open]);p.run('bindWorkTime()');open.onclick();
  assert.equal(p.run('state.workTime.editor.selected'),"development-2");
  const nodes=new Map();
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector)};
  const input=get('[data-work-time-date]');input.dataset.workTimeDate="start";
  const cancel=element();const dialog={querySelector:get,querySelectorAll:selector=>selector==='[data-work-time-date]'?[input]:selector==='[data-work-time-cancel]'?[cancel]:[]};
  p.elements.set('work-time-dialog',dialog);p.elements.set('work-time-summary',element());
  p.run('bindWorkTime()');input.value="2026-09-01";input.oninput();
  get('[data-work-time-reason]').oninput({target:{value:"遗漏状态"}});get('[data-work-time-evidence]').oninput({target:{value:"工作记录"}});
  get('[data-work-time-phase]').onchange({target:{value:"testing"}});
  assert.equal(p.run('state.workTime.editor.selected'),"testing-1");
  get('[data-work-time-phase]').onchange({target:{value:"development"}});
  assert.equal(p.run('state.workTime.editor.drafts["development-2"].start'),"2026-09-01");
  assert.equal(p.run('state.workTime.editor.reason'),"遗漏状态");
  get('[data-work-time-form]').onsubmit({preventDefault(){}});
  assert.equal(p.run('state.workTime.editor'),null);assert.equal(p.run('state.workTime.audit.length'),1);
  open.onclick();p.run('state.workTime.editor.drafts["development-2"].start="2026-08-30"');cancel.onclick();
  assert.equal(p.run('state.workTime.editor'),null);assert.equal(p.run('state.workTime.audit.length'),1);
  assert.equal(p.run('workTimeCurrentDevelopment(selectedWorkitem()).override.start'),"2026-09-01");
});
