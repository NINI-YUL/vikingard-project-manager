import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgressFormUrl, parseEnvFile } from "./dingtalk-progress-form-link.mjs";

test("adds task ID and title to a shared form URL", () => {
  const result = buildProgressFormUrl("https://alidocs.dingtalk.com/notable/share/form/example?source=link", {
    taskId: "TB-001",
    taskTitle: "登录界面优化",
  });
  const url = new URL(result);
  assert.equal(url.searchParams.get("source"), "link");
  assert.equal(url.searchParams.get("prefill_TB工单id"), "TB-001");
  assert.equal(url.searchParams.get("prefill_任务"), "登录界面优化");
});

test("replaces stale prefill values", () => {
  const result = buildProgressFormUrl("https://example.test/form?prefill_TB%E5%B7%A5%E5%8D%95id=OLD", {
    taskId: "NEW",
    taskTitle: "新任务",
  });
  const url = new URL(result);
  assert.deepEqual(url.searchParams.getAll("prefill_TB工单id"), ["NEW"]);
  assert.equal(url.searchParams.get("prefill_任务"), "新任务");
});

test("requires the shared form URL and task identity", () => {
  assert.throws(() => buildProgressFormUrl("", { taskId: "TB-1", taskTitle: "任务" }), /DINGTALK_PROGRESS_FORM_URL/);
  assert.throws(() => buildProgressFormUrl("https://example.test/form", { taskId: "", taskTitle: "任务" }), /工单 ID/);
  assert.throws(() => buildProgressFormUrl("https://example.test/form", { taskId: "TB-1", taskTitle: "" }), /任务标题/);
});

// Use fake credentials only; real local configuration must never enter test output.
test("configuration reader does not expose input in errors or stacks", async () => {
  const sensitiveInput = "DINGTALK_CLIENT_SECRET=fake-sensitive-value\nDINGTALK_CLIENT_ID=fake-client";
  for (const reader of [parseEnvFile]) {
    for (const input of [sensitiveInput, "missing-fake-sensitive-path.env", null]) {
      assert.throws(() => reader(input), error => {
        assert.equal(error.message, "无法读取配置文件，请检查文件路径与访问权限");
        assert.ok(!error.stack.includes("fake-sensitive"));
        assert.ok(!error.stack.includes("DINGTALK_CLIENT_SECRET"));
        return true;
      });
    }
  }
});

test("reads a real temporary configuration file without changing quoted values", t => {
  const folder = mkdtempSync(join(tmpdir(), "feedback-env-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "test.env");
  writeFileSync(file, "TEST_KEY='fake-value'\nTEST_OTHER=example\n");
  assert.deepEqual(parseEnvFile(file), { TEST_KEY: "fake-value", TEST_OTHER: "example" });
});
