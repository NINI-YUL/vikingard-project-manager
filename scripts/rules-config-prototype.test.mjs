import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../docs/prototypes/config-dashboard-prototype.html", import.meta.url), "utf8");
const code = html.split("<script>")[1].split("</script>")[0];
function prototype() {
  const app = { innerHTML: "" };
  const context = vm.createContext({
    document: {
      getElementById: (id) => id === "app" ? app : null,
      querySelector: () => null, querySelectorAll: () => [],
      body: { classList: { toggle() {} } }, activeElement: { tagName: "BODY" },
    },
    location: { search: "?variant=A&page=rules", href: "http://127.0.0.1/?variant=A&page=rules" },
    URL, URLSearchParams, addEventListener() {}, history: { replaceState() {} }, console,
  });
  vm.runInContext(code, context);
  return { app, run: (source) => vm.runInContext(source, context) };
}

test("rules entry renders system defaults; untouched version hides detail modules", () => {
  const p = prototype();
  assert.ok(p.app.innerHTML.includes("进度判断配置"));
  assert.ok(p.app.innerHTML.includes("进度采集与风险配置"));
  assert.ok(!p.app.innerHTML.includes("data-cfg-action=\"draft\""));
  const inherited = p.run('state.cfg.scope="version";cfgRules()');
  assert.ok(inherited.includes("继承系统配置"));
  assert.ok(!inherited.includes("02 / STAGES"));
  assert.ok(inherited.includes("data-rules-version"));
  assert.ok(!inherited.includes("data-rules-requirement"));
});

test("saving one override preserves inheritance and propagates later parent edits", () => {
  const p = prototype();
  assert.equal(p.run(`state.cfg.scope="version";rulesOpenEditor();state.rules.editor.values.schedules=[{day:3,time:"09:30"}];state.rules.editor.reason="调整版本采集时间";rulesSave()`), true);
  assert.equal(p.run('Object.keys(state.rules.versions["V1.8.0"]).join()'), "schedules");
  p.run('state.cfg.scope="system";rulesOpenEditor();state.rules.editor.values.threshold=5;state.rules.editor.reason="调整系统关注阈值";rulesSave()');
  assert.equal(p.run('rulesResolve({scope:"version",version:"V1.8.0"}).threshold.value'), 5);
  assert.equal(p.run('rulesResolve({scope:"version",version:"V1.8.0"}).schedules.value[0].time'), "09:30");
  p.run('state.cfg.scope="version";rulesOpenEditor()');
  assert.equal(p.run('state.rules.editor.values.schedules[0].time'), "09:30");
  assert.equal(p.run('state.rules.editor.values.threshold'), 5);
});

test("requirement overrides are isolated by both version and requirement; restore keeps audit", () => {
  const p = prototype();
  p.run('state.cfg.scope="requirement";rulesOpenEditor();state.rules.editor.values.schedules=[{day:1,time:"11:00"}];state.rules.editor.reason="当前需求例外";rulesSave()');
  assert.equal(p.run('rulesResolve({scope:"requirement",version:"V1.8.0",requirement:"公会跨服战"}).schedules.value[0].day'), 1);
  assert.equal(p.run('rulesResolve({scope:"requirement",version:"V1.7.5",requirement:"公会跨服战"}).schedules.value[0].day'), 2);
  assert.equal(p.run('rulesResolve({scope:"requirement",version:"V1.8.0",requirement:"商城重构"}).schedules.value[0].day'), 2);
  assert.equal(p.run('rulesOpenEditor();state.rules.editor.mode="restore";state.rules.editor.reason="恢复上层默认";rulesSave()'), true);
  assert.equal(p.run('Object.keys(rulesOwn(rulesContext())).length'), 0);
  assert.equal(p.run('state.rules.history.length'), 2);
  assert.ok(p.run('cfgRules()').includes("继承系统配置"));
});

test("validation rejects repeated schedules, overlapping functions, missing reasons and invalid thresholds without writing", () => {
  const p = prototype();
  assert.equal(p.run('rulesOpenEditor();state.rules.editor.values.schedules.push({day:2,time:"10:00"});state.rules.editor.reason="重复";rulesSave()'), false);
  assert.equal(p.run('state.rules.history.length'), 0);
  assert.equal(p.run('rulesOpenEditor();state.rules.editor.values.foundation.push("动效");state.rules.editor.reason="重复职能";rulesSave()'), false);
  assert.equal(p.run('rulesOpenEditor();state.rules.editor.values.threshold=0;state.rules.editor.reason="无效阈值";rulesSave()'), false);
  assert.equal(p.run('rulesOpenEditor();state.rules.editor.values.threshold=4;rulesSave()'), false);
  assert.equal(p.run('state.rules.system.threshold'), 3);
});

test("lower scopes cannot override global concurrency threshold", () => {
  const p = prototype();
  assert.equal(p.run('state.cfg.scope="version";rulesOpenEditor();state.rules.editor.values.threshold=99;state.rules.editor.values.schedules=[{day:5,time:"14:30"}];state.rules.editor.reason="版本采集";rulesSave()'), true);
  assert.equal(p.run('rulesResolve(rulesContext()).threshold.value'), 3);
  assert.equal(p.run('Object.hasOwn(rulesOwn(rulesContext()),"threshold")'), false);
  p.run('rulesOpenEditor()');
  assert.ok(!p.run('rulesDialogContent()').includes('data-rules-threshold'));
});

test("system edits that would create duplicate stage functions through inheritance roll back", () => {
  const p = prototype();
  assert.equal(p.run('rulesOpenEditor();state.rules.editor.values.foundation=state.rules.editor.values.foundation.filter(x=>x!=="KGUI");state.rules.editor.reason="系统调整基础范围";rulesSave()'), true);
  assert.equal(p.run('state.cfg.scope="version";rulesOpenEditor();state.rules.editor.values.detail.push("KGUI");state.rules.editor.reason="版本补充细节职能";rulesSave()'), true);
  assert.equal(p.run('Object.hasOwn(rulesOwn(rulesContext()),"foundation")'), false);
  // This system edit would put KGUI into the inherited foundation and explicit detail.
  assert.equal(p.run('state.cfg.scope="system";rulesOpenEditor();state.rules.editor.values.foundation.push("KGUI");state.rules.editor.reason="恢复系统职能";rulesSave()'), false);
  assert.ok(p.run('state.rules.editor.error').includes("继承后出现重复职能"));
  assert.equal(p.run('state.rules.system.foundation.includes("KGUI")'), false);
});

test("recipient preview honors PM role and does not qualify a participant merely for system permission", () => {
  const p = prototype();
  const preview = p.run('requirementRecipientDialog()');
  assert.ok(preview.includes("基础流程完成"));
  assert.ok(preview.includes("细节完整完成"));
  assert.ok(preview.includes("PM"));
  assert.equal((preview.match(/周岚 · 未命中接收业务角色/g) || []).length, 2);
  assert.ok(preview.includes("不代表实际投递"));
});
