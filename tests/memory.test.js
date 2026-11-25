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
