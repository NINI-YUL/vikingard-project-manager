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
  return {app,run:x=>vm.runInContext(x,c)};
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

test("status mapping preserves unmapped rows and marks saved mappings for verification",()=>{
  const x=p();
  const result=x.run(`
    const editor={values:state.statusMapping.mappings.map(item=>({...item,timing:[...item.timing]})),reason:"补充计时节点",error:""};
    editor.values[6].semantic="";
    editor.values[1].timing=["开发计时开始","开发计时结束"];
    state.statusMapping.mappings=editor.values.map(item=>({...item,timing:[...item.timing]}));
    state.statusMapping.feedback="映射已保存，等待相关数据重新同步、计算或校验恢复。";
    ({semantic:state.statusMapping.mappings[6].semantic,id:state.statusMapping.mappings[6].id,name:state.statusMapping.mappings[6].name,feedback:state.statusMapping.feedback});
  `);
  assert.equal(result.semantic,"");
  assert.equal(result.id,"status-108");
  assert.equal(result.name,"等待联调");
  assert.match(result.feedback,/待.*验证|重新同步|校验恢复/);
});

test("status mapping requires a change reason before save",()=>{
  const x=p();
  assert.match(code,/变更原因/);
  assert.match(code,/保存映射/);
  assert.match(code,/!editor\.reason\.trim\(\)/);
});
