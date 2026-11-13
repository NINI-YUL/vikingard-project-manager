import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseEnvFile } from '../scripts/dingtalk-progress-form-link.mjs';

export function readJson(path) {
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || /[\r\n]/.test(path)) throw 0;
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch { throw new Error('无法读取外部配置，请检查路径、格式及权限'); }
}
export function validateConfig(value) {
  try {
    const c = structuredClone(value);
    const origin = new URL(c.origin);
    const loopback = ['127.0.0.1', 'localhost'].includes(origin.hostname);
    if (origin.origin !== c.origin || origin.username || origin.password || (!loopback && origin.protocol !== 'https:') || !['http:', 'https:'].includes(origin.protocol)) throw 0;
    if (!['127.0.0.1', '0.0.0.0'].includes(c.host) || !Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw 0;
    if (c.host !== '127.0.0.1' && origin.protocol !== 'https:') throw 0;
    if (!c.database || c.database.host !== '127.0.0.1' || c.database.port !== 55432 || c.database.database !== 'vikingpm' || c.database.user !== 'vikingpm_app' || typeof c.database.password !== 'string' || c.database.password.length < 24) throw 0;
    if (typeof c.loginEnabled !== 'boolean') throw 0;
    if (c.loginEnabled && (!c.dingtalk?.corpId || !isAbsolute(c.dingtalk.envPath))) throw 0;
    if (origin.protocol === 'https:' && (!isAbsolute(c.tls?.certPath ?? '') || !isAbsolute(c.tls?.keyPath ?? ''))) throw 0;
    return Object.freeze(c);
  } catch { throw new Error('应用配置不合法；内网登录必须使用 HTTPS，业务库必须独立'); }
}
export function loadConfig(path = process.env.VIKINGPM_CONFIG) { return validateConfig(readJson(path)); }
// Credentials are read by path only. Never propagate parser/network errors to the browser or logs.
export function readDingtalk(config) {
  try {
    const values = parseEnvFile(config.dingtalk.envPath);
    if (!values.DINGTALK_CLIENT_ID || !values.DINGTALK_CLIENT_SECRET) throw 0;
    return { clientId: values.DINGTALK_CLIENT_ID, clientSecret: values.DINGTALK_CLIENT_SECRET };
  } catch { throw new Error('钉钉配置不可用'); }
}
