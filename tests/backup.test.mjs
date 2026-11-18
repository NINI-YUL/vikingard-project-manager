import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../scripts/backup-to-share.mjs';
test('备份恢复内容摘要忽略行顺序，排除会话但保留持久数据变化', async () => {
  const client = (rows) => ({ query: async sql => sql.includes('pg_tables') ? {rows: [{tablename:'login_sessions'}, {tablename:'oauth_requests'}, {tablename:'people'}]} : {rows: rows.map(value => ({value}))} });
  const a = await fingerprint(client([{id:1,name:'fake-a'},{id:2,name:'fake-b'}]));
  const b = await fingerprint(client([{id:2,name:'fake-b'},{id:1,name:'fake-a'}]));
  assert.deepEqual(a,b); assert.deepEqual(Object.keys(a),['people']); assert.equal(a.people.count,2);
  const changed = await fingerprint(client([{id:1,name:'changed'},{id:2,name:'fake-b'}]));
  assert.notEqual(changed.people.sha256,a.people.sha256);
  await assert.rejects(fingerprint({query:async()=>({rows:[{tablename:'invalid-table'}]})}));
});
