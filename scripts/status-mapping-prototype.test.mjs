import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync("docs/prototypes/config-dashboard-prototype.html","utf8");
const code=html.split("<script>")[1].split("</script>")[0];

function element(){
  return {
    hidden:false,
    value:"",
    textContent:"",
    dataset:{},
    elements:{namedItem(){return element()}},
    classList:{toggle(){}},
    focus(){},
    close(){this.open=false;this.onclose?.()},
    showModal(){this.open=true},
    querySelector(){return element()},
    querySelectorAll(){return []},
    addEventListener(){},
    setAttribute(){},
    removeAttribute(){},
  };
}

function p(){
  const app=element();
  const elements=new Map([["app",app]]);
  const c=vm.createContext({
    document:{
      getElementById:id=>elements.get(id)??element(),
      querySelector:()=>null,
      querySelectorAll:()=>[],
      body:{classList:{toggle(){}}},
      activeElement:{tagName:"BODY"},
    },
    location:{search:"?variant=A&page=config",href:"http://localhost/?variant=A&page=config"},
    URL,
    URLSearchParams,
    addEventListener(){},
    history:{replaceState(){}},
    console,
  });
  vm.runInContext(code,c);
  return {app,elements,run:x=>vm.runInContext(x,c)};
}

test("status mapping renders seven semantics and one unified editor",()=>{
  const x=p();
  const rendered=x.run('state.cfg.space="status";state.cfg.tab="mapping";cfgMapping()');
  assert.ok(rendered.includes("原始状态 → 统一管理语义"));
  assert.ok(rendered.includes("未开始"));
  assert.ok(rendered.includes("开发中"));
  assert.ok(rendered.includes("测试中"));
  assert.ok(rendered.includes("处理中，但不计时"));
  assert.ok(rendered.includes("暂停"));
  assert.ok(rendered.includes("交付完成"));
  assert.ok(rendered.includes("非交付终态"));
  assert.ok(rendered.includes("开发计时开始"));
  assert.ok(rendered.includes("测试计时开始"));
  assert.equal((rendered.match(/data-status-edit/g)||[]).length,1);
  assert.match(code,/编辑状态映射/);
});

function openEditor(x,reason="补充状态映射"){
  x.run(`state.statusMapping.editor={values:state.statusMapping.mappings.map(item=>({...item,timing:[...item.timing]})),reason:${JSON.stringify(reason)},error:""}`);
}

test("partial save preserves source fields, pending exception and audit",()=>{
  const x=p();openEditor(x);
  const before=x.run('JSON.stringify(state.statusMapping.mappings.map(x=>[x.id,x.name]))');
  assert.equal(x.run('statusMappingSave()'),true);
  assert.equal(x.run('state.statusMapping.recovery.phase'),"pending");
  assert.equal(x.run('JSON.stringify(state.statusMapping.mappings.map(x=>[x.id,x.name]))'),before);
  assert.match(x.run('cfgImpact()'),/等待联调/);
  assert.match(x.run('cfgImpact()'),/status-108/);
  assert.match(x.run('cfgImpact()'),/data-status-validate="success" disabled/);
  assert.match(x.run('anomaliesV2()'),/<b>EX-101<\/b>/);
  assert.match(x.run('state.statusMapping.recovery.events[0][3]'),/补充状态映射/);
});

test("missing change reason cannot write mappings or recovery state",()=>{
  const x=p();openEditor(x,"  ");
  x.run('state.statusMapping.editor.values[6].semantic="暂停"');
  const before=x.run('JSON.stringify(state.statusMapping)');
  assert.equal(x.run('statusMappingSave()'),false);
  assert.equal(x.run('state.statusMapping.mappings[6].semantic'),"");
  assert.equal(x.run('state.statusMapping.recovery.phase'),"unmapped");
  assert.equal(x.run('state.statusMapping.recovery.events.length'),0);
  assert.match(x.run('state.statusMapping.editor.error'),/变更原因/);
});

test("unmapped states block simulated success even when action is invoked directly",()=>{
  const x=p();openEditor(x);x.run('statusMappingSave()');
  assert.equal(x.run('statusRecoveryValidate("success")'),false);
  assert.equal(x.run('state.statusMapping.recovery.phase'),"failed");
  assert.match(x.run('cfgImpact()'),/仍有 1 个状态未映射/);
  assert.match(x.run('anomaliesV2()'),/<b>EX-101<\/b>/);
});

test("failed validation keeps exception; retry succeeds only after mapping is complete",()=>{
  const x=p();
  assert.equal(x.run('statusRecoveryValidate("success")'),false);
  openEditor(x);x.run('state.statusMapping.editor.values[6].semantic="处理中，但不计时";statusMappingSave()');
  assert.equal(x.run('statusRecoveryValidate("failure")'),false);
  assert.equal(x.run('state.statusMapping.recovery.phase'),"failed");
  assert.match(x.run('anomaliesV2()'),/<b>EX-101<\/b>/);
  assert.equal(x.run('statusRecoveryValidate("success")'),true);
  assert.equal(x.run('state.statusMapping.recovery.phase'),"restored");
  const rendered=x.run('anomaliesV2()');
  assert.doesNotMatch(rendered,/<b>EX-101<\/b>/);
  assert.match(rendered,/5 项演示异常/);
  assert.match(rendered,/模拟恢复验证/);
  assert.match(rendered,/等待联调首次出现/);
  assert.match(x.run('cfgMapping()'),/已恢复（模拟）/);
  assert.equal(x.run('statusRecoveryValidate("failure")'),false);
});

test("saving again invalidates a successful recovery and reopens only mapping exception",()=>{
  const x=p();openEditor(x);
  x.run('state.statusMapping.editor.values[6].semantic="暂停";statusMappingSave();statusRecoveryValidate("success")');
  openEditor(x,'<script>演示原因</script>');x.run('statusMappingSave()');
  assert.equal(x.run('state.statusMapping.recovery.phase'),"pending");
  assert.match(x.run('anomaliesV2()'),/<b>EX-101<\/b>/);
  assert.match(x.run('anomaliesV2()'),/6 项演示异常/);
  assert.match(x.run('anomaliesV2()'),/&lt;script&gt;/);
  assert.doesNotMatch(x.run('anomaliesV2()'),/<script>演示原因/);
  assert.equal(x.run('state.statusMapping.recovery.events.length'),3);
});

test("bound save form and validation buttons drive the shared recovery state",()=>{
  const x=p();openEditor(x);
  x.run('state.statusMapping.editor.values[6].semantic="暂停"');
  const form=element(),error=element(),dialog=element();
  dialog.querySelector=selector=>selector==="form"?form:selector==="[data-status-error]"?error:element();
  x.elements.set("status-dialog",dialog);
  x.run('bind()');
  let prevented=false;
  form.onsubmit({preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  assert.equal(x.run('state.statusMapping.recovery.phase'),"pending");
  assert.equal(x.run('state.statusMapping.editor'),null);
  x.run(`
    globalThis.recoveryButtons=[{dataset:{statusValidate:"success"}},{dataset:{statusValidate:"failure"}}];
    document.querySelectorAll=selector=>selector==="[data-status-validate]"?recoveryButtons:[];
    bind();recoveryButtons[1].onclick();
  `);
  assert.equal(x.run('state.statusMapping.recovery.phase'),"failed");
  x.run('recoveryButtons[0].onclick()');
  assert.equal(x.run('state.statusMapping.recovery.phase'),"restored");
});
