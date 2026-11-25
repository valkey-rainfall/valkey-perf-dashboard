'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/memory-helpers.js');

const FB = { 'memory-set-k16-v16': 32, 'memory-set-k16-v64': 80 };
const pt = (o) => Object.assign({ commit: 'c1', commit_index: 5, date: '2026-11-01',
  results: { 'memory-set-k16-v64': { rps: 50, cv: 1, reps: 3 } } }, o);
const W = 'memory-set-k16-v64';

test('user data: metadata, then fallback, else null', () => {
  assert.strictEqual(M.userDataFor({ metadata: { user_data_bytes: 96 } }, W, FB), 96);
  assert.strictEqual(M.userDataFor({ metadata: { user_data_bytes: { [W]: 90 } } }, W, FB), 90);
  assert.strictEqual(M.userDataFor({ metadata: {} }, W, FB), 80);
  assert.strictEqual(M.userDataFor({ metadata: {} }, 'memory-x', FB), null);
});

test('total: exported total wins, else overhead + user data, else null', () => {
  assert.strictEqual(M.pointMemory(pt({ memory: { total_bytes_per_item: 140 } }), {}, W, FB).total, 140);
  const m = M.pointMemory(pt({ breakdown: { a: 1 } }), {}, W, FB);
  assert.strictEqual(m.total, 130);
  assert.strictEqual(m.overhead, 50);
  assert.strictEqual(M.pointMemory(pt(), {}, 'memory-x', FB), null);
  const r = pt(); r.results['memory-x'] = { rps: 7 };
  const u = M.pointMemory(r, {}, 'memory-x', FB);
  assert.strictEqual(u.total, null);
  assert.strictEqual(u.overhead, 7);
});

test('hidden: unsettled, empty date, pre-exporter Redis only', () => {
  assert.strictEqual(M.hiddenReason(pt({ memory: { settled: false } }), 'valkey', W), 'not settled');
  assert.strictEqual(M.hiddenReason(pt({ date: '' }), 'valkey', W), 'no date');
  assert.ok(M.hiddenReason(pt({ date: '2026-10-19' }), 'redis', W));
  assert.strictEqual(M.hiddenReason(pt({ date: '2026-10-20' }), 'redis', W), null);
  assert.strictEqual(M.hiddenReason(pt({ date: '2026-10-19' }), 'valkey', W), null);
  assert.strictEqual(M.hiddenReason(pt({ date: '2026-10-19', memory: { settled: true } }), 'redis', W), null);
  assert.strictEqual(M.hiddenReason(pt({ date: '2026-10-19' }), 'redis', 'memory-set-k16-v16'), null);
});

test('settled null is unknown: old Redis rule applies, valkey shown', () => {
  const m = { settled: null };
  assert.ok(M.hiddenReason(pt({ date: '2026-10-19', memory: m }), 'redis', W));
  assert.strictEqual(M.hiddenReason(pt({ date: '2026-10-19', memory: m }), 'valkey', W), null);
  assert.strictEqual(M.hiddenReason(pt({ date: '2026-11-01', memory: m }), 'redis', W), null);
});

test('rss: shown only when exported and not null', () => {
  assert.strictEqual(M.pointMemory(pt({ memory: { rss_bytes_per_item: 150.5 } }), {}, W, FB).rss, 150.5);
  assert.strictEqual(M.pointMemory(pt({ memory: { rss_bytes_per_item: null } }), {}, W, FB).rss, null);
  assert.strictEqual(M.pointMemory(pt(), {}, W, FB).rss, null);
  const m = M.summarize([pt({ memory: { rss_bytes_per_item: 100 } }), pt()], {}, W, FB);
  assert.strictEqual(m.rss, null);
});

test('release: only distance 0', () => {
  const s = { points: [pt({ commit: 'a', commit_index: 10 }), pt({ commit: 'b', commit_index: 98 })] };
  assert.strictEqual(M.releasePoint(s, { commit: 'a', commit_index: 10 }, 'valkey', W).status, 'ok');
  assert.strictEqual(M.releasePoint(s, { commit: 'z', commit_index: 11 }, 'valkey', W).status, 'none');
  assert.strictEqual(M.releasePoint(s, { commit: 'z', commit_index: 98 }, 'valkey', W).point.commit, 'b');
});

test('release: hidden point needs the toggle', () => {
  const s = { points: [pt({ commit: 'a', commit_index: 10, memory: { settled: false } })] };
  const l = { commit: 'a', commit_index: 10 };
  assert.strictEqual(M.releasePoint(s, l, 'valkey', W, false).status, 'none');
  assert.strictEqual(M.releasePoint(s, l, 'valkey', W, true).status, 'hidden');
});

test('latest history: median of last five shown points', () => {
  const pts = [1, 2, 3, 4, 5, 6].map(i => pt({ commit: 'c' + i, results: { [W]: { rps: i * 10, cv: 1, reps: 3 } } }));
  pts[5].memory = { settled: false };
  const r = M.latestPoint({ points: pts }, 'history', 'valkey', W, false);
  assert.strictEqual(r.points.length, 5);
  const m = M.summarize(r.points, {}, W, FB);
  assert.strictEqual(m.overhead, 30);
  assert.strictEqual(m.total, 110);
});

test('overhead percent', () => {
  assert.strictEqual(M.overheadPct({ overhead: 90 }, { overhead: 100 }), -10);
  assert.strictEqual(M.overheadPct(null, { overhead: 100 }), null);
});

test('latest tip: the picked tip, with its exported total, RSS and N', () => {
  const tipOf = (s) => ({ point: s.points[s.points.length - 1] });
  const mem = { settled: true, profiled: false, total_bytes_per_item: 43.9, rss_bytes_per_item: 44.4, n: 5000000 };
  const s = { points: [
    pt({ commit: 'r', date: '2026-11-22', sample: 'release' }),
    pt({ commit: 't', date: '2026-11-25', sample: 'tip', memory: mem }),
  ] };
  const r = M.latestPoint(s, 'release-and-tip', 'redis', W, false, tipOf);
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.points.length, 1);
  assert.strictEqual(r.points[0].commit, 't');
  const m = M.summarize(r.points, s, W, FB);
  assert.strictEqual(m.total, 43.9);
  assert.strictEqual(m.rss, 44.4);
  assert.strictEqual(m.n, 5000000);
  assert.strictEqual(m.date, '2026-11-25');
});

test('latest tip: an unsettled tip is not shown, the previous shown point is', () => {
  const tipOf = (s) => ({ point: s.points[s.points.length - 1] });
  const s = { points: [
    pt({ commit: 'a', date: '2026-11-24', sample: 'tip' }),
    pt({ commit: 'b', date: '2026-11-25', sample: 'tip', memory: { settled: false } }),
  ] };
  const r = M.latestPoint(s, 'release-and-tip', 'redis', W, false, tipOf);
  assert.strictEqual(r.points[0].commit, 'a');
  assert.strictEqual(M.latestPoint(s, 'release-and-tip', 'redis', W, true, tipOf).points[0].commit, 'b');
});

test('release: no nearest-point fallback, a hidden release point needs the toggle', () => {
  const s = { points: [
    pt({ commit: 'a', commit_index: 10, date: '2026-11-20' }),
    pt({ commit: 'c', commit_index: 12, date: '2026-11-24' }),
  ] };
  // The landmark sits between two measured commits: nothing is shown.
  assert.strictEqual(M.releasePoint(s, { commit: 'b', commit_index: 11 }, 'redis', W).status, 'none');
  // A Redis release point measured before settling was exported is hidden by default.
  const old = { points: [pt({ commit: 'r', commit_index: 3, date: '2026-10-01' })] };
  const l = { commit: 'r', commit_index: 3 };
  const r = M.releasePoint(old, l, 'redis', W, false);
  assert.strictEqual(r.status, 'none');
  assert.strictEqual(r.hiddenReason, 'measured before settling was exported');
  assert.strictEqual(M.releasePoint(old, l, 'redis', W, true).status, 'hidden');
});

test('Redis before 2026-10-20: hidden on the five pre-exporter series only', () => {
  const p = pt({ date: '2026-10-19' });
  M.PRE_EXPORTER_SERIES.forEach((w) => assert.ok(M.hiddenReason(p, 'redis', w), w));
  ['memory-set-k16-v16', 'memory-set-k16-v16-expire', 'memory-hset-f16-v16']
    .forEach((w) => assert.strictEqual(M.hiddenReason(p, 'redis', w), null, w));
  assert.strictEqual(M.hiddenReason(pt({ date: '2026-10-19', memory: { settled: true } }), 'redis', W), null);
});

test('latest tip: a Redis tip from before 2026-10-20 with unknown settle is not shown', () => {
  const tipOf = (s) => (s.points.length ? { point: s.points[s.points.length - 1] } : null);
  const s = { points: [pt({ commit: 'z', date: '2026-10-19', sample: 'tip', memory: { settled: null } })] };
  const r = M.latestPoint(s, 'release-and-tip', 'redis', W, false, tipOf);
  assert.strictEqual(r.status, 'none');
  assert.strictEqual(r.hiddenReason, 'measured before settling was exported');
});

test('headline: total is the exported used_memory delta, not the heap profile sum', () => {
  const p = pt({
    results: { [W]: { rps: 30.93, cv: 0, reps: 1 } },
    memory: { total_bytes_per_item: 110.93 },
    breakdown: { robj_embval: 80.5, hashtable: 31.2 },
  });
  const m = M.pointMemory(p, {}, W, FB);
  assert.strictEqual(m.total, 110.93);
  assert.strictEqual(m.overhead, 30.93);
  // The same definition for an engine without a profile or an exported total.
  const r = M.pointMemory(pt({ results: { [W]: { rps: 54.93 } } }), {}, W, FB);
  assert.strictEqual(r.total, 54.93 + 80);
});

// config.js is a browser script; read its user-data table in a sandbox.
function configUserData() {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'config.js'), 'utf8');
  const ctx = { module: undefined, console };
  require('vm').createContext(ctx);
  require('vm').runInContext(src + '\n;this.__ud = MEMORY_USER_DATA;', ctx);
  return ctx.__ud;
}

test('grey band: every memory workload, the v16 shapes included, has user data', () => {
  const ud = configUserData();
  const want = {
    'memory-set-k16-v64': 80, 'memory-set-k16-v64-expire': 80, 'memory-zadd-m20': 28,
    'memory-sadd-m20': 20, 'memory-hset-f64-v64': 128,
    'memory-set-k16-v16': 32, 'memory-set-k16-v16-expire': 32, 'memory-hset-f16-v16': 32,
  };
  Object.keys(want).forEach((w) => assert.strictEqual(ud[w], want[w], w));
  // A v16 point without an exported total still gets a total, so the band is drawn.
  const w = 'memory-set-k16-v16';
  const m = M.pointMemory(pt({ results: { [w]: { rps: 38.93 } } }), {}, w, ud);
  assert.strictEqual(m.userData, 32);
  assert.strictEqual(m.total, 38.93 + 32);
});
