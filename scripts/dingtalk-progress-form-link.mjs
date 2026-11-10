import { readFileSync } from "node:fs";
import { join } from "node:path";

export function parseEnvFile(path) {
  let contents;
  try {
    if (typeof path !== "string" || !path || /[\r\n]/.test(path)) throw new Error();
    contents = readFileSync(path, "utf8");
  } catch {
    // Never echo the input or underlying error: a caller may pass credentials instead of a path.
    throw new Error("无法读取配置文件，请检查文件路径与访问权限");
  }
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function buildProgressFormUrl(baseUrl, { taskId, taskTitle }) {
  if (!baseUrl) throw new Error("缺少 DINGTALK_PROGRESS_FORM_URL");
  if (!taskId) throw new Error("缺少 Teambition 工单 ID");
  if (!taskTitle) throw new Error("缺少任务标题");
  const url = new URL(baseUrl);
  url.searchParams.set("prefill_TB工单id", taskId);
  url.searchParams.set("prefill_任务", taskTitle);
  return url.toString();
}

const invokedPath = process.argv[1]?.replaceAll("\\", "/");
if (invokedPath && import.meta.url === new URL(`file:///${invokedPath}`).href) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("无法确定本机配置目录");
  const envPath = process.env.DINGTALK_ENV_FILE ?? join(localAppData, "VikingPM", "dingtalk.env");
  const values = parseEnvFile(envPath);
  const [taskId, taskTitle] = process.argv.slice(2);
  process.stdout.write(`${buildProgressFormUrl(values.DINGTALK_PROGRESS_FORM_URL, { taskId, taskTitle })}\n`);
}
