import { randomBytes, randomUUID } from 'node:crypto';
import { transaction, digest } from './database.mjs';

export class Denied extends Error {
  constructor(status = 403, message = '权限不足或身份未获授权') { super(message); this.status = status; }
}
export const roles = ['none', 'viewer', 'admin', 'owner'];
export function requireRole(actor, minimum) {
  if (!actor || roles.indexOf(actor.role) < roles.indexOf(minimum) || actor.role === 'none') throw new Denied(actor ? 403 : 401);
}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value);
const safePerson = row => row && ({ id: row.id, displayName: row.display_name, active: row.active, mappingEnabled: row.enabled, confirmed: row.confirmed, role: row.role });
async function actorNow(client, id) {
  if (!uuid(id)) return null;
  const result = await client.query(`SELECT p.id, g.role FROM people p JOIN identity_mappings i ON i.person_id=p.id JOIN access_grants g ON g.person_id=p.id
    WHERE p.id=$1 AND p.active AND i.enabled AND i.confirmed`, [id]);
  return result.rows[0];
}
async function lock(client) {
  // One row serializes bootstrap, role changes and identity changes, including concurrent owner removals.
  await client.query('SELECT id FROM security_state WHERE id=1 FOR UPDATE');
}
async function protectOwner(client) {
  const { rows } = await client.query(`SELECT count(*)::int AS count FROM people p JOIN identity_mappings i ON i.person_id=p.id
    JOIN access_grants g ON g.person_id=p.id WHERE p.active AND i.enabled AND i.confirmed AND g.role='owner'`);
  if (!rows[0].count) throw new Denied(409, '必须保留至少一名具有有效身份的系统所有者');
}
async function audit(client, actorId, subjectId, action, before, after, reason) {
  await client.query('INSERT INTO audit_events(actor_id,subject_id,action,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5,$6)', [actorId, subjectId, action, before, after, reason]);
}
export async function bootstrap(pool, approval, corpId) {
  if (approval?.confirmed !== true || approval.corpId !== corpId || !text(corpId, 200) || !Array.isArray(approval.people) || !approval.people.length || approval.people.length > 100 || !text(approval.reason, 500)) throw new Denied(400, '需要启用前核对的企业、所有者及访问名单');
  if (!approval.people.some(p => p.role === 'owner') || approval.people.some(p => !text(p.displayName, 100) || !text(p.unionId, 200) || !roles.includes(p.role)) || new Set(approval.people.map(p => p.unionId)).size !== approval.people.length) throw new Denied(400, '初始化名单不完整或重复');
  await transaction(pool, async client => {
    await lock(client);
    const { rows } = await client.query('SELECT initialized FROM security_state WHERE id=1');
    if (rows[0].initialized) throw new Denied(409, '初始化已完成，不可重复授予权限');
    for (const person of approval.people) {
      const id = randomUUID();
      await client.query('INSERT INTO people(id,display_name) VALUES($1,$2)', [id, person.displayName]);
      await client.query('INSERT INTO identity_mappings(person_id,corp_id,union_id,confirmed) VALUES($1,$2,$3,true)', [id, corpId, person.unionId]);
      await client.query('INSERT INTO access_grants(person_id,role) VALUES($1,$2)', [id, person.role]);
      await audit(client, null, id, 'access.bootstrap', null, { displayName: person.displayName, role: person.role }, approval.reason);
    }
    await protectOwner(client);
    await client.query('UPDATE security_state SET initialized=true WHERE id=1');
  });
}
export async function listPeople(pool, actorId) {
  return transaction(pool, async client => {
    requireRole(await actorNow(client, actorId), 'owner');
    return (await client.query(`SELECT p.*,i.enabled,i.confirmed,COALESCE(g.role,'none') AS role FROM people p JOIN identity_mappings i ON i.person_id=p.id LEFT JOIN access_grants g ON g.person_id=p.id ORDER BY p.created_at,p.id`)).rows.map(safePerson);
  });
}
export async function changePerson(pool, actorId, personId, patch, kind) {
  const allowed = kind === 'access' ? ['role', 'reason'] : ['active', 'mappingEnabled', 'reason'];
  if (!uuid(personId) || !patch || Object.keys(patch).some(key => !allowed.includes(key)) || !text(patch.reason, 500)) throw new Denied(400, '变更字段或原因不合法');
  if (kind === 'access' ? !roles.includes(patch.role) : (!['active', 'mappingEnabled'].some(key => key in patch) || ['active', 'mappingEnabled'].some(key => key in patch && typeof patch[key] !== 'boolean'))) throw new Denied(400, '变更值不合法');
  return transaction(pool, async client => {
    await lock(client);
    requireRole(await actorNow(client, actorId), kind === 'access' ? 'owner' : 'admin');
    const target = (await client.query(`SELECT p.*,i.enabled,i.confirmed,COALESCE(g.role,'none') AS role FROM people p JOIN identity_mappings i ON i.person_id=p.id LEFT JOIN access_grants g ON g.person_id=p.id WHERE p.id=$1`, [personId])).rows[0];
    if (!target) throw new Denied(404, '人员不存在');
    if (target.role === 'owner') requireRole(await actorNow(client, actorId), 'owner');
    const before = safePerson(target);
    if (kind === 'access') {
      if (patch.role !== 'none' && (!target.active || !target.enabled || !target.confirmed)) throw new Denied(409, '人员身份未启用，不能授予后台权限');
      await client.query('INSERT INTO access_grants(person_id,role,updated_by) VALUES($1,$2,$3) ON CONFLICT(person_id) DO UPDATE SET role=EXCLUDED.role,updated_at=now(),updated_by=EXCLUDED.updated_by', [personId, patch.role, actorId]);
      target.role = patch.role;
    } else {
      if ('active' in patch) { await client.query('UPDATE people SET active=$2 WHERE id=$1', [personId, patch.active]); target.active = patch.active; }
      if ('mappingEnabled' in patch) { await client.query('UPDATE identity_mappings SET enabled=$2 WHERE person_id=$1', [personId, patch.mappingEnabled]); target.enabled = patch.mappingEnabled; }
    }
    await protectOwner(client);
    await client.query('UPDATE login_sessions SET revoked_at=now() WHERE person_id=$1 AND revoked_at IS NULL', [personId]);
    const after = safePerson(target);
    await audit(client, actorId, personId, kind === 'access' ? 'access.change' : 'identity.change', before, after, patch.reason);
    return after;
  });
}
export async function createIdentity(pool, actorId, input, corpId) {
  if (!input || Object.keys(input).some(k => !['displayName','unionId','confirmed','reason'].includes(k)) || input.confirmed !== true || !text(input.displayName,100) || !text(input.unionId,200) || !text(input.reason,500)) throw new Denied(400,'必须核实人员身份并填写原因');
  return transaction(pool, async client => {
    await lock(client);
    requireRole(await actorNow(client, actorId), 'admin');
    const id = randomUUID();
    await client.query('INSERT INTO people(id,display_name) VALUES($1,$2)',[id,input.displayName]);
    await client.query('INSERT INTO identity_mappings(person_id,corp_id,union_id,confirmed) VALUES($1,$2,$3,true)',[id,corpId,input.unionId]);
    await client.query("INSERT INTO access_grants(person_id,role) VALUES($1,'none')",[id]);
    await audit(client,actorId,id,'identity.create',null,{displayName:input.displayName,role:'none'},input.reason);
    return {id,displayName:input.displayName,role:'none'};
  });
}
export async function establishSession(pool, identity) {
  return transaction(pool, async client => {
    await lock(client);
    const { rows } = await client.query(`SELECT p.id,p.display_name,g.role FROM people p JOIN identity_mappings i ON i.person_id=p.id JOIN access_grants g ON g.person_id=p.id
      JOIN security_state state ON state.id=1 AND state.initialized WHERE i.corp_id=$1 AND i.union_id=$2 AND i.confirmed AND i.enabled AND p.active AND g.role != 'none'`, [identity.corpId, identity.unionId]);
    if (!rows[0]) throw new Denied();
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    await client.query(`DELETE FROM login_sessions WHERE expires_at < now() OR revoked_at < now() - interval '1 day'`);
    await client.query(`INSERT INTO login_sessions(digest,person_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')`,[digest(token),rows[0].id,csrf]);
    await audit(client,rows[0].id,rows[0].id,'session.login',null,null,'钉钉可信身份及当前授权校验通过');
    return {token};
  });
}
export async function authenticate(pool, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await pool.query(`SELECT p.id,p.display_name AS "displayName",g.role,s.csrf FROM login_sessions s JOIN people p ON p.id=s.person_id
    JOIN identity_mappings i ON i.person_id=p.id JOIN access_grants g ON g.person_id=p.id WHERE s.digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
    AND p.active AND i.enabled AND i.confirmed AND g.role!='none'`,[digest(token)]);
  return rows[0] ?? null;
}
export async function logout(pool, token) {
  await pool.query('UPDATE login_sessions SET revoked_at=now() WHERE digest=$1 AND revoked_at IS NULL',[digest(token)]);
}
