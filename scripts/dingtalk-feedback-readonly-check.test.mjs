import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedback, readRawFeedback } from './dingtalk-feedback-readonly-check.mjs';
const context = {
  project: { id: 'project', uniqueIdPrefix: 'vkt' },
  task: { projectId: 'project', uniqueId: 64, content: '客户端任务', executorId: 'executor', isDone: false, isArchived: false },
  mapping: { confirmed: true, tbUserId: 'executor', unionId: 'known-user' },
};
function row(id, time, fields = {}) {
  return { id, createdTime: time, createdBy: { unionId: 'known-user' }, fields: {
    'TB工单id': 'vkt-64', '任务': '客户端任务', '提交人': { unionId: 'known-user' },
    '当前进度百分比': '0.5', '当前情况': { name: '进度正常' }, ...fields,
  } };
}
test('newer wrong title and wrong number cannot replace earlier matching sample; preserve inputs', () => {
  const input = [row('risk', 1, { '当前进度百分比': '0.15', '当前情况': { name: '存在风险' }, '风险原因与所需协助': { markdown: '与预估时间出现偏差' } }), row('normal', 2), row('bad-number', 3, { 'TB工单id': 'INVALID-TEST' }), row('bad-title', 4, { '任务': '伪造标题' })];
  const before = structuredClone(input), result = validateFeedback(input, context);
  assert.deepEqual(result.results.map(x => x.verdict), ['review', 'passes_checked_rules', 'reject', 'reject']);
  assert.equal(result.latestCheckedCandidate, 'normal');assert(result.blockers.length);assert.equal(result.writesPerformed, false);assert.deepEqual(input, before);
});
test('creator and submitter must both match confirmed executor; missing mapping aborts', () => {
  const r = row('wrong-person', 1);r.createdBy.unionId = 'other';
  assert.equal(validateFeedback([r], context).results[0].verdict, 'reject');
  const s = row('forged-person', 1, { '提交人': { unionId: 'other' } });
  assert.equal(validateFeedback([s], context).results[0].verdict, 'reject');
  assert.throws(() => validateFeedback([r], { ...context, mapping: { ...context.mapping, confirmed: false } }));
});
test('progress conversion rejects blanks, null, coercion, fractional percentages and out-of-range values', () => {
  for (const value of ['', ' ', null, undefined, false, '50', '0x1', '0.155', 0.155, '-0.1', 1.1]) {
    assert.equal(validateFeedback([row('x', 1, { '当前进度百分比': value })], context).results[0].verdict, 'reject', String(value));
  }
  for (const [value, expected] of [['0', 0], ['0.15', 15], [1, 100], ['1.00', 100]]) assert.equal(validateFeedback([row('x', 1, { '当前进度百分比': value })], context).results[0].progressPercent, expected);
});
test('risk needs text and content review; paused is not silently treated as blocked', () => {
  assert.equal(validateFeedback([row('x', 1, { '当前情况': { name: '存在风险' } })], context).results[0].verdict, 'reject');
  assert.equal(validateFeedback([row('x', 1, { '当前情况': { name: '已暂停' } })], context).results[0].verdict, 'review');
});
test('terminal or missing states reject; project mismatch aborts; missing time rejects; duplicate IDs abort', () => {
  for (const state of [{ isDone: true }, { isArchived: true }, { isDone: undefined }]) assert.equal(validateFeedback([row('x', 1)], { ...context, task: { ...context.task, ...state } }).results[0].verdict, 'reject');
  assert.throws(() => validateFeedback([], { ...context, task: { ...context.task, projectId: 'other' } }));
  assert.equal(validateFeedback([row('x', NaN)], context).results[0].verdict, 'reject');
  assert.throws(() => validateFeedback([row('same', 1), row('same', 2)], context));
  assert.equal(validateFeedback([row('a', 1), row('b', 1)], context).latestCheckedCandidate, null);
});
const values = { DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_OPERATOR_UNION_ID: 'operator' }, table = { baseId: 'base', sheetId: 'sheet' };
test('live reader only exchanges token and lists records, follows all pages without changing data', async () => {
  const calls = [];
  const rows = await readRawFeedback(values, table, async (url, opts) => {
    const address = String(url);calls.push({ address, opts });
    if (address.endsWith('/accessToken')) return Response.json({ accessToken: 'token' });
    assert(address.includes('/records/list?'));assert.equal(opts.method, 'POST');
    const body = JSON.parse(opts.body);
    return Response.json(body.nextToken ? { records: [row('b', 2)], hasMore: false } : { records: [row('a', 1)], hasMore: true, nextToken: 'second' });
  });
  assert.equal(rows.length, 2);assert.equal(calls.length, 3);assert.equal(JSON.parse(calls[2].opts.body).nextToken, 'second');
});
test('HTTP failures, malformed pages and looping cursor cannot produce partial success', async () => {
  for (const page of [{ records: [] }, { records: [], hasMore: true }, { records: [], hasMore: true, nextToken: 'same' }]) {
    await assert.rejects(readRawFeedback(values, table, async url => String(url).endsWith('/accessToken') ? Response.json({ accessToken: 'token' }) : Response.json(page)));
  }
  await assert.rejects(readRawFeedback(values, table, async () => new Response('denied', { status: 403 })));
});

test('latest valid task submission ignores notification round and accepts feedback without collection marker', () => {
  const oldNotice = row('old-notice-later', 3, { '采集标识': 'old-round', '当前进度百分比': '0.9' });
  const newNotice = row('new-notice-earlier', 2, { '采集标识': 'new-round', '当前进度百分比': '0.8' });
  oldNotice.lastModifiedTime = 4;
  newNotice.lastModifiedTime = 999;
  const result = validateFeedback([newNotice, oldNotice], context);
  assert.equal(result.selectionPolicy, 'latest_valid_submission_per_task');
  assert.equal(result.latestCheckedCandidate, 'old-notice-later');
  assert.equal(validateFeedback([oldNotice, row('without-marker', 4)], context).latestCheckedCandidate, 'without-marker');
  const wrongPerson = row('later-wrong-person', 5);
  wrongPerson.createdBy.unionId = 'someone-else';
  const laterInvalid = row('later-bad-number', 6, { 'TB工单id': 'wrong' });
  assert.equal(validateFeedback([oldNotice, wrongPerson, laterInvalid], context).latestCheckedCandidate, 'old-notice-later');
  assert.ok(!result.blockers.some(value => value.includes('未可靠关联采集轮次')));
});
