/**
 * Comprehensive unit tests for valkey-perf-dashboard pure logic.
 * Uses Node.js built-in test runner (node:test + node:assert).
 * Run: node --test tests/unit.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const status = require('../lib/status-helpers.js');
const compare = require('../lib/compare-helpers.js');
const config = require('../config.js');

// ═══════════════════════════════════════════════════════════════════════════
// status-helpers.js
// ═══════════════════════════════════════════════════════════════════════════

describe('formatScore', () => {
  it('returns dash for falsy score', () => {
    assert.equal(status.formatScore(0, 'throughput'), '—');
    assert.equal(status.formatScore(null, 'throughput'), '—');
    assert.equal(status.formatScore(undefined, 'throughput'), '—');
  });

  it('formats latency in microseconds', () => {
    assert.equal(status.formatScore(123.456, 'latency'), '123µs');
    assert.equal(status.formatScore(0.7, 'latency'), '1µs');
  });

  it('formats millions', () => {
    assert.equal(status.formatScore(1500000, 'throughput'), '1.50M');
    assert.equal(status.formatScore(2345678, 'throughput'), '2.35M');
  });

  it('formats thousands', () => {
    assert.equal(status.formatScore(50000, 'throughput'), '50.0K');
    assert.equal(status.formatScore(1001, 'throughput'), '1.0K');
  });

  it('formats small values with one decimal', () => {
    assert.equal(status.formatScore(42.7, 'throughput'), '42.7');
    assert.equal(status.formatScore(999.9, 'throughput'), '999.9');
  });
});

describe('timeAgo', () => {
  it('returns empty for falsy input', () => {
    assert.equal(status.timeAgo(''), '');
    assert.equal(status.timeAgo(null), '');
    assert.equal(status.timeAgo(undefined), '');
  });

  it('returns empty for unparseable input', () => {
    assert.equal(status.timeAgo('not-a-date'), '');
  });

  it('returns "just now" for recent timestamp', () => {
    const now = new Date().toISOString();
    assert.equal(status.timeAgo(now), 'just now');
  });

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    assert.equal(status.timeAgo(fiveMinAgo), '5m ago');
  });

  it('returns hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    assert.equal(status.timeAgo(twoHoursAgo), '2h ago');
  });

  it('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    assert.equal(status.timeAgo(threeDaysAgo), '3d ago');
  });

  it('parses Conductress timestamp format', () => {
    // A timestamp from far enough in the past to get "Xd ago"
    const result = status.timeAgo('2020.01.01_00.00.00.000000');
    assert.match(result, /d ago$/);
  });
});

describe('escapeHtml', () => {
  it('escapes all dangerous characters', () => {
    assert.equal(status.escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersand', () => {
    assert.equal(status.escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes single quotes', () => {
    assert.equal(status.escapeHtml("it's"), 'it&#39;s');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(status.escapeHtml(null), '');
    assert.equal(status.escapeHtml(undefined), '');
  });

  it('converts numbers to string', () => {
    assert.equal(status.escapeHtml(42), '42');
  });

  it('passes through safe strings unchanged', () => {
    assert.equal(status.escapeHtml('hello world'), 'hello world');
  });
});

describe('shortSpecifier', () => {
  it('truncates long SHA with ellipsis', () => {
    assert.equal(status.shortSpecifier('1234567890abcdef'), '12345678\u2026');
  });

  it('keeps short strings intact', () => {
    assert.equal(status.shortSpecifier('abcdefgh'), 'abcdefgh');
    assert.equal(status.shortSpecifier('short'), 'short');
  });

  it('handles empty/null/undefined', () => {
    assert.equal(status.shortSpecifier(''), '');
    assert.equal(status.shortSpecifier(null), '');
    assert.equal(status.shortSpecifier(undefined), '');
  });

  it('handles exactly 8 characters', () => {
    assert.equal(status.shortSpecifier('12345678'), '12345678');
  });

  it('handles exactly 9 characters (truncates)', () => {
    assert.equal(status.shortSpecifier('123456789'), '12345678\u2026');
  });
});

describe('formatDuration', () => {
  it('returns dash for null/undefined/negative/NaN', () => {
    assert.equal(status.formatDuration(null), '\u2014');
    assert.equal(status.formatDuration(undefined), '\u2014');
    assert.equal(status.formatDuration(-1), '\u2014');
    assert.equal(status.formatDuration(NaN), '\u2014');
    assert.equal(status.formatDuration(Infinity), '\u2014');
    assert.equal(status.formatDuration('not a number'), '\u2014');
  });

  it('formats zero seconds', () => {
    assert.equal(status.formatDuration(0), '0s');
  });

  it('formats seconds only', () => {
    assert.equal(status.formatDuration(45), '45s');
  });

  it('formats minutes and seconds', () => {
    assert.equal(status.formatDuration(125), '2m 5s');
    assert.equal(status.formatDuration(300), '5m 0s');
    assert.equal(status.formatDuration(420), '7m 0s');
  });

  it('formats hours and minutes', () => {
    assert.equal(status.formatDuration(3600), '1h 0m');
    assert.equal(status.formatDuration(7260), '2h 1m');
  });

  it('accepts numeric strings', () => {
    assert.equal(status.formatDuration('300'), '5m 0s');
  });

  it('rounds fractional seconds', () => {
    assert.equal(status.formatDuration(61.7), '1m 2s');
  });
});

describe('queueSummary', () => {
  it('singular task, no duration', () => {
    assert.equal(status.queueSummary(1, 0), '1 task');
  });

  it('plural tasks, no duration', () => {
    assert.equal(status.queueSummary(3, 0), '3 tasks');
  });

  it('singular task with duration', () => {
    assert.equal(status.queueSummary(1, 300), '1 task \u00b7 ~5m 0s total');
  });

  it('plural tasks with duration', () => {
    assert.equal(status.queueSummary(5, 7200), '5 tasks \u00b7 ~2h 0m total');
  });

  it('zero tasks', () => {
    assert.equal(status.queueSummary(0, 0), '0 tasks');
  });
});

describe('taskDescription', () => {
  it('prefers note', () => {
    assert.equal(status.taskDescription({ note: 'my note', specifier: 'spec', type: 'tp' }), 'my note');
  });

  it('falls back to specifier', () => {
    assert.equal(status.taskDescription({ specifier: 'abc123', type: 'tp' }), 'abc123');
  });

  it('falls back to type', () => {
    assert.equal(status.taskDescription({ type: 'mem-set' }), 'mem-set');
  });

  it('uses Unnamed task as last resort', () => {
    assert.equal(status.taskDescription({}), 'Unnamed task');
  });

  it('escapes HTML in description', () => {
    assert.equal(status.taskDescription({ note: '<script>bad</script>' }),
      '&lt;script&gt;bad&lt;/script&gt;');
  });
});

describe('fmtBytes', () => {
  it('formats gigabytes', () => {
    assert.equal(status.fmtBytes(2.5e9), '2.5 GB');
  });

  it('formats megabytes', () => {
    assert.equal(status.fmtBytes(150e6), '150 MB');
  });

  it('formats small values as bytes', () => {
    assert.equal(status.fmtBytes(1024), '1024 B');
    assert.equal(status.fmtBytes(0), '0 B');
  });
});

describe('diskTier', () => {
  it('returns null for null/undefined', () => {
    assert.equal(status.diskTier(null), null);
    assert.equal(status.diskTier(undefined), null);
  });

  it('returns crit below 5%', () => {
    assert.equal(status.diskTier(4), 'crit');
    assert.equal(status.diskTier(0), 'crit');
  });

  it('returns warn between 5% and 15%', () => {
    assert.equal(status.diskTier(5), 'warn');
    assert.equal(status.diskTier(14), 'warn');
  });

  it('returns null for 15% and above (healthy)', () => {
    assert.equal(status.diskTier(15), null);
    assert.equal(status.diskTier(80), null);
  });
});

describe('renderFleetControl', () => {
  it('returns null severity and disabled message when no fleet_control', () => {
    const result = status.renderFleetControl({});
    assert.equal(result.severity, null);
    assert.ok(result.summary.includes('not enabled'));
    assert.equal(result.banner, '');
  });

  it('returns crit for 3+ consecutive failures', () => {
    const result = status.renderFleetControl({
      fleet_control: { mode: 'live', control_reachable: false, claim_failures_consecutive: 3, pending_outcomes_count: 0 },
      measurement_isolation: {},
    });
    assert.equal(result.severity, 'crit');
    assert.ok(result.banner.includes('unreachable'));
  });

  it('returns warn for fewer than 3 consecutive failures', () => {
    const result = status.renderFleetControl({
      fleet_control: { mode: 'live', control_reachable: false, claim_failures_consecutive: 2, pending_outcomes_count: 0 },
      measurement_isolation: {},
    });
    assert.equal(result.severity, 'warn');
  });

  it('combined unreachable + pending outranks individual', () => {
    const result = status.renderFleetControl({
      fleet_control: { mode: 'live', control_reachable: false, claim_failures_consecutive: 3, pending_outcomes_count: 1 },
      measurement_isolation: { status_timer_migration_required: true },
    });
    assert.equal(result.severity, 'crit');
    assert.ok(result.banner.includes('pending'));
    assert.ok(result.banner.includes('unreachable'));
  });

  it('returns warn for pending outcomes only', () => {
    const result = status.renderFleetControl({
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 2 },
      measurement_isolation: {},
    });
    assert.equal(result.severity, 'warn');
    assert.ok(result.banner.includes('2 terminal'));
  });

  it('returns warn for timer migration needed', () => {
    const result = status.renderFleetControl({
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 0 },
      measurement_isolation: { status_timer_migration_required: true },
    });
    assert.equal(result.severity, 'warn');
    assert.ok(result.banner.includes('timer migration'));
  });

  it('includes boundary-only tag when applicable', () => {
    const result = status.renderFleetControl({
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 0 },
      measurement_isolation: { boundary_publisher_active: true, status_timer_migration_required: false },
    });
    assert.equal(result.severity, null);
    assert.ok(result.summary.includes('boundary-only'));
  });

  it('healthy control shows ok class', () => {
    const result = status.renderFleetControl({
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 0 },
      measurement_isolation: {},
    });
    assert.equal(result.severity, null);
    assert.ok(result.summary.includes('control-ok'));
    assert.ok(result.summary.includes('control healthy'));
  });
});

describe('renderRemoteTasks', () => {
  it('returns feed-unavailable for null', () => {
    const html = status.renderRemoteTasks(null);
    assert.ok(html.includes('feed unavailable'));
  });

  it('returns Empty for empty array', () => {
    const html = status.renderRemoteTasks([]);
    assert.ok(html.includes('Empty'));
  });

  it('renders tasks with escaped content', () => {
    const html = status.renderRemoteTasks([
      { note: '<img onerror=1>', source: 'valkey', specifier: 'abc123456', state: 'queued', type: 'throughput', expected_duration_sec: 300 },
    ]);
    assert.ok(html.includes('&lt;img onerror=1&gt;'), 'note must be escaped');
    assert.ok(!html.includes('<img onerror=1>'), 'raw HTML must not appear');
    assert.ok(html.includes('expected 5m 0s'));
  });

  it('shows the first 5 and expands all remaining tasks', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({ note: `task-${i}`, source: 'v' }));
    const html = status.renderRemoteTasks(tasks);
    assert.ok(html.includes('<details class="task-overflow">'));
    assert.ok(html.includes('Show 3 more tasks'));
    assert.ok(html.includes('task-5'));
    assert.ok(html.includes('task-7'));
  });

  it('omits priority when null', () => {
    const html = status.renderRemoteTasks([{ note: 'test', type: 'tp' }]);
    assert.ok(!html.includes('priority undefined'));
    assert.ok(!html.includes('priority null'));
  });
});

describe('renderLocalTasks', () => {
  it('returns Empty for null queue', () => {
    assert.ok(status.renderLocalTasks(null).includes('Empty'));
  });

  it('returns Empty for empty tasks', () => {
    assert.ok(status.renderLocalTasks({ tasks: [] }).includes('Empty'));
  });

  it('renders tasks and escapes HTML', () => {
    const html = status.renderLocalTasks({
      depth: 1,
      tasks: [{ note: '<b>bold</b>', type: 'mem', source: 'valkey', specifier: 'deadbeef12345678' }],
    });
    assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
    assert.ok(html.includes('deadbeef\u2026'));
  });

  it('expands all published overflow tasks', () => {
    const html = status.renderLocalTasks({
      depth: 8,
      tasks: Array.from({ length: 8 }, (_, i) => ({ note: `task-${i}` })),
    });
    assert.ok(html.includes('<details class="task-overflow">'));
    assert.ok(html.includes('Show 3 more tasks'));
    assert.ok(html.includes('task-7'));
  });

  it('discloses tasks omitted from a truncated boundary snapshot', () => {
    const html = status.renderLocalTasks({
      depth: 7,
      tasks: Array.from({ length: 5 }, (_, i) => ({ note: `task-${i}` })),
    });
    assert.ok(html.includes('2 additional tasks not included in this boundary snapshot'));
  });
});

describe('renderRecentResults', () => {
  it('returns None for empty/null', () => {
    assert.ok(status.renderRecentResults(null).includes('None'));
    assert.ok(status.renderRecentResults([]).includes('None'));
  });

  it('renders results with escaped content and score', () => {
    const html = status.renderRecentResults([{
      note: '<script>x</script>', score: 1500000, method: 'throughput',
      commit: 'abcdef1234567890', completed: new Date().toISOString(),
      observed_duration_sec: 375,
    }]);
    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
    assert.ok(html.includes('1.50M'));
    assert.ok(html.includes('observed 6m 15s'));
  });

  it('shows "duration unavailable" when observed_duration_sec is null', () => {
    const html = status.renderRecentResults([{
      note: 'test', score: 100, method: 'throughput', commit: 'abc', completed: new Date().toISOString(),
    }]);
    assert.ok(html.includes('duration unavailable'));
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// compare-helpers.js
// ═══════════════════════════════════════════════════════════════════════════

describe('normalCDF', () => {
  it('CDF(0) ≈ 0.5', () => {
    assert.ok(Math.abs(compare.normalCDF(0) - 0.5) < 1e-6);
  });

  it('CDF(+∞) → 1', () => {
    assert.ok(compare.normalCDF(6) > 0.9999);
  });

  it('CDF(-∞) → 0', () => {
    assert.ok(compare.normalCDF(-6) < 0.0001);
  });

  it('CDF(1.96) ≈ 0.975', () => {
    assert.ok(Math.abs(compare.normalCDF(1.96) - 0.975) < 0.001);
  });

  it('symmetry: CDF(-x) = 1 - CDF(x)', () => {
    for (const x of [0.5, 1.0, 2.0, 3.0]) {
      assert.ok(Math.abs(compare.normalCDF(-x) - (1 - compare.normalCDF(x))) < 1e-10);
    }
  });
});

describe('ci95', () => {
  it('returns 0 for missing CV or insufficient reps', () => {
    assert.equal(compare.ci95(1000, 0, 5), 0);
    assert.equal(compare.ci95(1000, 2, 0), 0);
    assert.equal(compare.ci95(1000, 2, 1), 0);
  });

  it('computes correct half-width', () => {
    // 100K value, 1% CV, 4 reps => SE = 0.01*100000/2 = 500 => CI = 1.96*500 = 980
    const result = compare.ci95(100000, 1, 4);
    assert.ok(Math.abs(result - 980) < 1);
  });

  it('wider CI for higher CV', () => {
    assert.ok(compare.ci95(100000, 5, 4) > compare.ci95(100000, 1, 4));
  });

  it('narrower CI for more reps', () => {
    assert.ok(compare.ci95(100000, 2, 16) < compare.ci95(100000, 2, 4));
  });
});

describe('welchPValue', () => {
  it('returns null for insufficient data', () => {
    assert.equal(compare.welchPValue(100, 0, 5, 200, 2, 5), null);
    assert.equal(compare.welchPValue(100, 2, 1, 200, 2, 5), null);
  });

  it('returns 0 for identical measurements with zero SE', () => {
    // When CV is non-zero but means are exactly equal
    const p = compare.welchPValue(100, 1, 5, 100, 1, 5);
    // t = 0, so p should be high (>0.9)
    assert.ok(p > 0.9, `expected p > 0.9 but got ${p}`);
  });

  it('returns small p for clearly different means', () => {
    // 100K vs 200K, both 1% CV with 10 reps — clearly different
    const p = compare.welchPValue(100000, 1, 10, 200000, 1, 10);
    assert.ok(p < 0.001, `expected p < 0.001 but got ${p}`);
  });

  it('returns high p for overlapping distributions', () => {
    // 100K vs 100.5K, 5% CV — noise
    const p = compare.welchPValue(100000, 5, 3, 100500, 5, 3);
    assert.ok(p > 0.05, `expected p > 0.05 but got ${p}`);
  });
});

describe('workloadLabel (compare)', () => {
  it('formats throughput workload ID', () => {
    assert.equal(compare.workloadLabel('get-k16-v128-t7-p10'), 'GET K=16B V=128B T=7 P=10');
  });

  it('formats memory workload ID', () => {
    assert.equal(compare.workloadLabel('memory-set-k16-v64'), 'SET K=16B V=64B');
  });

  it('handles expire suffix', () => {
    assert.equal(compare.workloadLabel('memory-set-k16-v64-expire'), 'SET K=16B V=64B +expire');
  });

  it('handles member/field size specs', () => {
    assert.equal(compare.workloadLabel('memory-zadd-m20'), 'ZADD M=20B');
    assert.equal(compare.workloadLabel('memory-hset-f64-v64'), 'HSET F=64 V=64B');
  });

  it('handles unknown parts gracefully', () => {
    assert.equal(compare.workloadLabel('memory-custom-unknown'), 'CUSTOM unknown');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// config-helpers.js
// ═══════════════════════════════════════════════════════════════════════════

describe('isValidWorkloadId', () => {
  it('accepts well-formed IDs', () => {
    assert.ok(config.isValidWorkloadId('get-k16-v16-t7-p10'));
    assert.ok(config.isValidWorkloadId('set-k16-v128-t24-p100'));
    assert.ok(config.isValidWorkloadId('get-k16-v64-t9-p50'));
  });

  it('rejects IDs without thread/pipeline suffix', () => {
    assert.ok(!config.isValidWorkloadId('get-k16-v16'));
    assert.ok(!config.isValidWorkloadId('set-k16'));
  });

  it('rejects empty/malformed IDs', () => {
    assert.ok(!config.isValidWorkloadId(''));
    assert.ok(!config.isValidWorkloadId('random-stuff'));
    assert.ok(!config.isValidWorkloadId('memory-set-k16-v64'));
  });

  it('rejects IDs with engine prefix', () => {
    assert.ok(!config.isValidWorkloadId('redis-get-k16-v16-t7-p10'));
  });
});

describe('workloadIdToLabel', () => {
  it('converts valkey workload ID to label', () => {
    assert.equal(config.workloadIdToLabel('get-k16-v128-t7-p1'), 'GET K=16B V=128B T=7 P=1');
  });

  it('converts redis-prefixed workload ID', () => {
    assert.equal(config.workloadIdToLabel('redis-set-k16-v16-t7-p10'), 'Redis SET K=16B V=16B T=7 P=10');
  });

  it('returns ID unchanged if format unrecognized', () => {
    assert.equal(config.workloadIdToLabel('some-custom-id'), 'some-custom-id');
  });
});

describe('isEnginePrefixed', () => {
  const engines = [{ id: 'valkey' }, { id: 'redis' }];

  it('returns true for non-valkey engine prefix', () => {
    assert.ok(config.isEnginePrefixed('redis-get-k16-v16-t7-p10', engines));
  });

  it('returns false for valkey-prefixed (valkey is default engine)', () => {
    assert.ok(!config.isEnginePrefixed('valkey-get-k16-v16-t7-p10', engines));
  });

  it('returns false for no prefix', () => {
    assert.ok(!config.isEnginePrefixed('get-k16-v16-t7-p10', engines));
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Terminal-boundary recheck scheduling
// ═══════════════════════════════════════════════════════════════════════════

describe('terminalRecheckQualifies', () => {
  it('qualifies: running + completed boundary + empty queue', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      boundary: { state: 'completed', task_id: 'task-1', timestamp: '2026-08-30T10:00:00Z' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, true);
    assert.equal(result.boundaryKey, 'task-1:2026-08-30T10:00:00Z');
  });

  it('qualifies: running + failed boundary + empty queue', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      boundary: { state: 'failed', task_id: 'task-2', timestamp: '2026-08-30T11:00:00Z' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, true);
    assert.equal(result.boundaryKey, 'task-2:2026-08-30T11:00:00Z');
  });

  it('does not qualify: boundary state is starting (in progress)', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      boundary: { state: 'starting', task_id: 'task-3', timestamp: '2026-08-30T10:00:00Z' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, false);
  });

  it('does not qualify: runner is stopped', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'stopped' },
      boundary: { state: 'completed', task_id: 'task-4', timestamp: '2026-08-30T10:00:00Z' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, false);
  });

  it('does not qualify: runner is unreachable', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'unreachable' },
      boundary: { state: 'completed', task_id: 'task-5', timestamp: '2026-08-30T10:00:00Z' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, false);
  });

  it('does not qualify: local queue is non-empty', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      boundary: { state: 'completed', task_id: 'task-6', timestamp: '2026-08-30T10:00:00Z' },
      queue: { depth: 3 },
    });
    assert.equal(result.qualify, false);
  });

  it('does not qualify: no boundary at all (idle host)', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, false);
  });

  it('does not qualify: null data', () => {
    const result = status.terminalRecheckQualifies(null);
    assert.equal(result.qualify, false);
  });

  it('does not qualify: missing runner', () => {
    const result = status.terminalRecheckQualifies({
      boundary: { state: 'completed', task_id: 'x', timestamp: 'y' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, false);
  });

  it('does not qualify: boundary without task_id and timestamp', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      boundary: { state: 'completed' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, false);
  });

  it('qualifies with only task_id (no timestamp)', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      boundary: { state: 'completed', task_id: 'task-7' },
      queue: { depth: 0 },
    });
    assert.equal(result.qualify, true);
    assert.equal(result.boundaryKey, 'task-7:');
  });

  it('treats missing queue as depth 0', () => {
    const result = status.terminalRecheckQualifies({
      runner: { state: 'running' },
      boundary: { state: 'completed', task_id: 'task-8', timestamp: 'ts' },
    });
    assert.equal(result.qualify, true);
  });
});

describe('createRecheckScheduler', () => {
  it('schedules a follow-up that fires the callback', () => {
    const fired = [];
    let timerId = 0;
    const timers = {};
    const scheduler = status.createRecheckScheduler({
      onRecheck(hostId) { fired.push(hostId); },
      delayMs: 5000,
      setTimeoutFn(fn, ms) { const id = ++timerId; timers[id] = fn; return id; },
      clearTimeoutFn(id) { delete timers[id]; },
    });

    const scheduled = scheduler.schedule('arm', 'task-1:ts1');
    assert.equal(scheduled, true);
    assert.equal(scheduler.pendingCount(), 1);

    // Fire the timer
    timers[1]();
    assert.deepEqual(fired, ['arm']);
    assert.equal(scheduler.pendingCount(), 0);
  });

  it('deduplicates: same boundary key is not scheduled twice', () => {
    let timerId = 0;
    const scheduler = status.createRecheckScheduler({
      onRecheck() {},
      setTimeoutFn(fn, ms) { return ++timerId; },
      clearTimeoutFn() {},
    });

    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), true);
    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), false);
    assert.equal(scheduler.pendingCount(), 1);
  });

  it('different hosts with same boundary key are independent', () => {
    let timerId = 0;
    const scheduler = status.createRecheckScheduler({
      onRecheck() {},
      setTimeoutFn(fn, ms) { return ++timerId; },
      clearTimeoutFn() {},
    });

    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), true);
    assert.equal(scheduler.schedule('x86', 'task-1:ts1'), true);
    assert.equal(scheduler.pendingCount(), 2);
  });

  it('a new boundary key for the same host schedules a new follow-up', () => {
    const fired = [];
    let timerId = 0;
    const timers = {};
    const scheduler = status.createRecheckScheduler({
      onRecheck(hostId) { fired.push(hostId); },
      setTimeoutFn(fn, ms) { const id = ++timerId; timers[id] = fn; return id; },
      clearTimeoutFn(id) { delete timers[id]; },
    });

    // First boundary
    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), true);
    // Fire first timer
    timers[1]();
    assert.equal(scheduler.pendingCount(), 0);

    // New boundary (different task or timestamp)
    assert.equal(scheduler.schedule('arm', 'task-2:ts2'), true);
    assert.equal(scheduler.pendingCount(), 1);
    timers[2]();
    assert.deepEqual(fired, ['arm', 'arm']);
    assert.equal(scheduler.pendingCount(), 0);
  });

  it('reset cancels all pending timers', () => {
    const cleared = [];
    let timerId = 0;
    const scheduler = status.createRecheckScheduler({
      onRecheck() {},
      setTimeoutFn(fn, ms) { return ++timerId; },
      clearTimeoutFn(id) { cleared.push(id); },
    });

    scheduler.schedule('arm', 'task-1:ts1');
    scheduler.schedule('x86', 'task-2:ts2');
    assert.equal(scheduler.pendingCount(), 2);

    scheduler.reset();
    assert.equal(scheduler.pendingCount(), 0);
    assert.equal(cleared.length, 2);
  });

  it('does not create indefinite polling: fired timer self-removes', () => {
    const fired = [];
    let timerId = 0;
    const timers = {};
    const scheduler = status.createRecheckScheduler({
      onRecheck(hostId) { fired.push(hostId); },
      setTimeoutFn(fn, ms) { const id = ++timerId; timers[id] = fn; return id; },
      clearTimeoutFn(id) { delete timers[id]; },
    });

    scheduler.schedule('arm', 'task-1:ts1');
    timers[1]();

    // After firing, the same key should be schedulable again (for a new boundary)
    // but the old timer is gone -- no indefinite loop.
    assert.equal(scheduler.pendingCount(), 0);
    assert.equal(fired.length, 1);
  });

  it('pendingKeys returns the composite keys', () => {
    let timerId = 0;
    const scheduler = status.createRecheckScheduler({
      onRecheck() {},
      setTimeoutFn(fn, ms) { return ++timerId; },
      clearTimeoutFn() {},
    });

    scheduler.schedule('arm', 'task-1:ts1');
    scheduler.schedule('x86', 'task-2:ts2');
    const keys = scheduler.pendingKeys().sort();
    assert.deepEqual(keys, ['arm::task-1:ts1', 'x86::task-2:ts2']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Integration: existing status-monitoring.test.js coverage via VM
// ═══════════════════════════════════════════════════════════════════════════

describe('status.html renderHost (via VM integration)', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');

  let ctx;
  const html = fs.readFileSync(
    require('node:path').join(__dirname, '..', 'status.html'), 'utf8'
  );
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const statusHelpers = fs.readFileSync(
    require('node:path').join(__dirname, '..', 'lib', 'status-helpers.js'), 'utf8'
  );

  // Re-create VM context for each describe block to avoid state leakage
  function createContext() {
    const context = {
      console,
      Date,
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      fetch: async () => ({ ok: false }),
      document: {
        getElementById: () => ({
          className: '', innerHTML: '', textContent: '',
          addEventListener: () => {},
        }),
      },
    };
    vm.createContext(context);
    vm.runInContext(statusHelpers, context);
    vm.runInContext(script, context);
    return context;
  }

  it('renders hardware platform as primary title', () => {
    ctx = createContext();
    const host = { runnerId: 'armbench', title: 'AWS Graviton 3', subtitle: 'c7g.metal · 64 cores' };
    const now = new Date().toISOString();
    const result = ctx.renderHost({
      timestamp: now, runner: { state: 'running' },
      queue: { depth: 0, tasks: [] }, recent_results: [], disk: {},
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 0 },
      measurement_isolation: { boundary_publisher_active: true, status_timer_migration_required: false },
    }, host, []);
    assert.ok(result.includes('AWS Graviton 3'));
    assert.ok(result.includes('armbench'));
  });

  it('renders three task sections', () => {
    ctx = createContext();
    const host = { runnerId: 'bench', title: 'AMD EPYC', subtitle: 'test' };
    const now = new Date().toISOString();
    const result = ctx.renderHost({
      timestamp: now, runner: { state: 'running' },
      queue: { depth: 0, tasks: [] }, recent_results: [], disk: {},
    }, host, []);
    assert.ok(result.includes('Remote mailbox'));
    assert.ok(result.includes('Local queue'));
    assert.ok(result.includes('Recent completions'));
  });

  it('escapes XSS in task descriptions', () => {
    ctx = createContext();
    const host = { runnerId: 'test', title: 'Test', subtitle: 'test' };
    const now = new Date().toISOString();
    const result = ctx.renderHost({
      timestamp: now, runner: { state: 'running' },
      queue: { depth: 1, tasks: [{ type: 'tp', note: '<script>evil</script>', source: 'v', specifier: 'abc' }] },
      recent_results: [{ note: '<img onerror=1>', score: 1, method: 'tp', commit: 'abc', completed: now }],
      disk: {},
    }, host, { remote_tasks: [{ note: '<b>xss</b>', state: 'queued' }] });
    assert.ok(!result.includes('<script>evil</script>'));
    assert.ok(!result.includes('<img onerror=1>'));
    assert.ok(!result.includes('<b>xss</b>'));
    assert.ok(result.includes('&lt;script&gt;evil&lt;/script&gt;'));
  });

  it('renders ARIA accessibility labels', () => {
    ctx = createContext();
    const host = { runnerId: 'test', title: 'Test', subtitle: 'sub' };
    const now = new Date().toISOString();
    const result = ctx.renderHost({
      timestamp: now, runner: { state: 'running' },
      queue: { depth: 0, tasks: [] }, recent_results: [], disk: {},
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 0 },
      measurement_isolation: { boundary_publisher_active: true, status_timer_migration_required: false },
    }, host, []);
    assert.ok(result.includes('aria-label="Status: running"'));
  });

  it('does not warn for 10m boundary-only task', () => {
    ctx = createContext();
    const host = { runnerId: 'test', title: 'Test', subtitle: 'sub' };
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const result = ctx.renderHost({
      timestamp: tenMinAgo, runner: { state: 'running' },
      queue: { depth: 0, tasks: [] }, recent_results: [], disk: {},
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 0 },
      measurement_isolation: { boundary_publisher_active: true, status_timer_migration_required: false },
      boundary: { state: 'starting', task_id: 'long-task' },
    }, host, []);
    assert.ok(!result.includes('No update for'));
  });

  it('warns for 10m periodic (non-boundary) publisher', () => {
    ctx = createContext();
    const host = { runnerId: 'test', title: 'Test', subtitle: 'sub' };
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const result = ctx.renderHost({
      timestamp: tenMinAgo, runner: { state: 'running' },
      queue: { depth: 0, tasks: [] }, recent_results: [], disk: {},
    }, host, []);
    assert.ok(result.includes('No update for'));
  });

  it('shows disk alarm banner', () => {
    ctx = createContext();
    const host = { runnerId: 'test', title: 'Test', subtitle: 'sub' };
    const now = new Date().toISOString();
    const result = ctx.renderHost({
      timestamp: now, runner: { state: 'running' },
      queue: { depth: 0, tasks: [] }, recent_results: [], disk: { free_pct: 3, avail_bytes: 5e9, size_bytes: 200e9 },
      fleet_control: { mode: 'live', control_reachable: true, pending_outcomes_count: 0 },
      measurement_isolation: {},
    }, host, []);
    assert.ok(result.includes('critically low'));
    assert.ok(result.includes('alarm-crit'));
  });

  it('remote feed null shows unavailable, not empty', () => {
    ctx = createContext();
    const result = ctx.StatusHelpers.renderRemoteTasks(null);
    assert.ok(result.includes('feed unavailable'));
    assert.ok(!result.includes('Empty'));
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Static structure validation
// ═══════════════════════════════════════════════════════════════════════════

describe('HTML structural integrity', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');

  it('status.html uses client-side ETA without host-reported percentage progress', () => {
    const html = fs.readFileSync(path.join(root, 'status.html'), 'utf8');
    assert.ok(!html.includes('progress_pct'), 'host-reported progress percentage must not be present');
    assert.ok(html.includes('timeline-shimmer'), 'active ETA timer animation must be present');
    assert.ok(html.includes('setInterval(renderCachedStatus, 1000)'), 'ETA timer must update from cached data');
    assert.ok(html.includes('prefers-reduced-motion: reduce'), 'animation must respect reduced motion');
  });

  it('status header keeps title, navigation, metrics, and refresh together', () => {
    const html = fs.readFileSync(path.join(root, 'status.html'), 'utf8');
    assert.ok(html.includes('class="status-header"'));
    assert.ok(html.includes('id="fleetMetrics"'));
    assert.ok(html.includes('class="refresh-toggle"'));
    assert.ok(html.includes('fleetMetricsSnapshot'));
  });

  it('main dashboard header groups controls without shrinking them individually', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('class="header-title"'));
    assert.ok(html.includes('class="zoom-controls"'));
    assert.ok(html.includes('class="header-links"'));
    assert.ok(html.includes('flex: 0 0 auto'));
  });

  it('all HTML pages have lang attribute', () => {
    for (const file of ['index.html', 'status.html', 'notable.html', 'compare.html']) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(html.includes('lang="en"'), `${file} missing lang attribute`);
    }
  });

  it('all HTML pages have viewport meta', () => {
    for (const file of ['index.html', 'status.html', 'notable.html', 'compare.html']) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(html.includes('viewport'), `${file} missing viewport meta`);
    }
  });

  it('dashboard pages load the tested helper modules', () => {
    const statusHtml = fs.readFileSync(path.join(root, 'status.html'), 'utf8');
    const compareHtml = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');
    assert.ok(statusHtml.includes('<script src="lib/status-helpers.js"></script>'));
    assert.ok(compareHtml.includes('<script src="lib/compare-helpers.js"></script>'));
    assert.ok(statusHtml.indexOf('lib/status-helpers.js') < statusHtml.indexOf('const {formatScore'));
    assert.ok(compareHtml.indexOf('lib/compare-helpers.js') < compareHtml.indexOf('const {workloadLabel'));
  });

  it('config.js defines all required constants', () => {
    const src = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
    for (const sym of ['DATA_URL', 'ENGINES', 'PLATFORMS', 'PLATFORM_LABELS', 'THROUGHPUT_WORKLOADS', 'MEMORY_WORKLOADS', 'CATEGORY_COLORS', 'HELP_TEXT']) {
      assert.ok(src.includes(sym), `config.js missing ${sym}`);
    }
  });

  it('data/status JSON files are valid JSON', () => {
    const statusDir = path.join(root, 'data', 'status');
    for (const file of fs.readdirSync(statusDir).filter(f => f.endsWith('.json'))) {
      const content = fs.readFileSync(path.join(statusDir, file), 'utf8');
      assert.doesNotThrow(() => JSON.parse(content), `${file} is not valid JSON`);
    }
  });

  it('no inclusive language violations in source', () => {
    // Check for non-inclusive terms per Amazon inclusive language guidelines.
    // Build the pattern from parts to avoid the test file itself matching the CI grep.
    const terms = ['mas' + 'ter', 'sla' + 've', 'white' + 'list', 'black' + 'list'];
    const banned = new RegExp('\\b(' + terms.join('|') + ')\\b', 'i');
    for (const file of ['config.js', 'lib/status-helpers.js', 'lib/compare-helpers.js']) {
      const fp = path.join(root, file);
      if (!fs.existsSync(fp)) continue;
      const content = fs.readFileSync(fp, 'utf8');
      assert.ok(!banned.test(content), `${file} contains non-inclusive language`);
    }
  });
});
