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
const epochHelpers = require('../lib/epoch-helpers.js');
const pointHelpers = require('../lib/point-helpers.js');
const compareManifest = require('../lib/compare-manifest.js');
const perfGroups = require('../lib/perf-groups.js');

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

describe('computeHostLiveness', () => {
  const NOW = Date.UTC(2026, 8, 20, 21, 20, 0);
  const ago = (sec) => new Date(NOW - sec * 1000).toISOString();
  const boundaryOnly = { boundary_publisher_active: true, status_timer_migration_required: false };

  it('returns unreachable (grey) when there is no payload', () => {
    assert.equal(status.computeHostLiveness(null, NOW).dotClass, 'unreachable');
  });

  it('is green for an active boundary-only host even when runner_state is stopped', () => {
    // Live-fleet reality 2026-09-20: boundary-only publisher, runner sampled as
    // "stopped" at the boundary while a task is starting with queued work.
    const r = status.computeHostLiveness({
      timestamp: ago(1116),
      runner: { state: 'stopped' },
      boundary: { state: 'starting' },
      queue: { depth: 1 },
      measurement_isolation: boundaryOnly,
    }, NOW);
    assert.equal(r.dotClass, 'running');
    assert.equal(r.stale, false);
    assert.equal(r.working, true);
  });

  it('is green for a healthy-idle boundary-only host (terminal boundary, empty queue, fresh)', () => {
    const r = status.computeHostLiveness({
      timestamp: ago(699),
      runner: { state: 'stopped' },
      boundary: { state: 'completed' },
      queue: { depth: 0 },
      measurement_isolation: boundaryOnly,
    }, NOW);
    assert.equal(r.dotClass, 'running');
    assert.equal(r.stale, false);
  });

  it('goes amber for a boundary-only host silent for 2h–6h', () => {
    const r = status.computeHostLiveness({
      timestamp: ago(3 * 3600),
      runner: { state: 'stopped' },
      boundary: { state: 'completed' },
      queue: { depth: 0 },
      measurement_isolation: boundaryOnly,
    }, NOW);
    assert.equal(r.dotClass, 'stale');
  });

  it('goes red for a boundary-only host silent for over 6h', () => {
    const r = status.computeHostLiveness({
      timestamp: ago(7 * 3600),
      runner: { state: 'stopped' },
      boundary: { state: 'completed' },
      queue: { depth: 0 },
      measurement_isolation: boundaryOnly,
    }, NOW);
    assert.equal(r.dotClass, 'stopped');
    assert.ok(r.staleReason.includes('no boundary update'));
  });

  it('trusts the reported state directly for a legacy periodic publisher', () => {
    const running = status.computeHostLiveness({ timestamp: ago(120), runner: { state: 'running' } }, NOW);
    assert.equal(running.dotClass, 'running');
    const stopped = status.computeHostLiveness({ timestamp: ago(60), runner: { state: 'stopped' } }, NOW);
    assert.equal(stopped.dotClass, 'stopped');
  });

  it('applies the narrow window to a legacy periodic publisher', () => {
    const r = status.computeHostLiveness({ timestamp: ago(600), runner: { state: 'running' } }, NOW);
    assert.equal(r.dotClass, 'stale');
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

  it('formats a latency series id with its held rate', () => {
    assert.equal(compare.workloadLabel('get-k16-v16-t7-p1-r100k'), 'GET K=16B V=16B T=7 P=1 @ 100k req/s');
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
    assert.ok(config.isValidWorkloadId('mixed-s20-k16-v16-t7-p10'));
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

describe('isValidLatencyWorkloadId / latencyWorkloadIdToLabel', () => {
  it('accepts the fleet latency id shape and rejects throughput ids', () => {
    assert.equal(config.isValidLatencyWorkloadId('get-k16-v16-t7-p1-r100k'), true);
    assert.equal(config.isValidLatencyWorkloadId('mixed-s20-k16-v16-t7-p10-r50000'), true);
    assert.equal(config.isValidLatencyWorkloadId('get-k16-v16-t7-p1'), false);
    assert.equal(config.isValidLatencyWorkloadId('redis-get-k16-v16-t7-p1-r100k'), false);
  });

  it('the throughput validator still rejects latency ids', () => {
    assert.equal(config.isValidWorkloadId('get-k16-v16-t7-p1-r100k'), false);
  });

  it('labels the base workload plus the held rate', () => {
    assert.equal(config.latencyWorkloadIdToLabel('get-k16-v16-t7-p1-r100k'), 'GET K=16B V=16B T=7 P=1 @ 100k req/s');
    assert.equal(config.latencyWorkloadIdToLabel('set-k16-v16-t7-p1-r5000'), 'SET K=16B V=16B T=7 P=1 @ 5000 req/s');
    assert.equal(config.latencyWorkloadIdToLabel('not-a-latency-id'), 'not-a-latency-id');
  });
});

describe('workloadIdToLabel', () => {
  it('converts valkey workload ID to label', () => {
    assert.equal(config.workloadIdToLabel('get-k16-v128-t7-p1'), 'GET K=16B V=128B T=7 P=1');
  });

  it('converts redis-prefixed workload ID', () => {
    assert.equal(config.workloadIdToLabel('redis-set-k16-v16-t7-p10'), 'Redis SET K=16B V=16B T=7 P=10');
  });

  it('converts mixed workload ID', () => {
    assert.equal(
      config.workloadIdToLabel('mixed-s20-k16-v16-t7-p10'),
      '80:20 GET/SET K=16B V=16B T=7 P=10'
    );
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

  it('does not reschedule the same boundary after its one-shot fires', () => {
    const fired = [];
    let timerId = 0;
    const timers = {};
    const scheduler = status.createRecheckScheduler({
      onRecheck(hostId) { fired.push(hostId); },
      setTimeoutFn(fn, ms) { const id = ++timerId; timers[id] = fn; return id; },
      clearTimeoutFn(id) { delete timers[id]; },
    });

    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), true);
    timers[1]();

    assert.equal(scheduler.pendingCount(), 0);
    assert.equal(fired.length, 1);
    // A later regular 60-second refresh seeing the same terminal snapshot
    // must not create another follow-up.
    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), false);
  });

  it('reset forgets handled boundaries so re-enabling refresh can recheck', () => {
    let timerId = 0;
    const scheduler = status.createRecheckScheduler({
      onRecheck() {},
      setTimeoutFn() { return ++timerId; },
      clearTimeoutFn() {},
    });

    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), true);
    scheduler.reset();
    assert.equal(scheduler.schedule('arm', 'task-1:ts1'), true);
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
    for (const file of ['config.js', 'lib/status-helpers.js', 'lib/compare-helpers.js', 'lib/epoch-helpers.js']) {
      const fp = path.join(root, file);
      if (!fs.existsSync(fp)) continue;
      const content = fs.readFileSync(fp, 'utf8');
      assert.ok(!banned.test(content), `${file} contains non-inclusive language`);
    }
  });

  it('epoch-helpers.js is loaded by dashboard pages that need it', () => {
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const compareHtml = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');
    const notableHtml = fs.readFileSync(path.join(root, 'notable.html'), 'utf8');
    assert.ok(indexHtml.includes('<script src="lib/epoch-helpers.js"></script>'), 'index.html must load epoch-helpers.js');
    assert.ok(compareHtml.includes('<script src="lib/epoch-helpers.js"></script>'), 'compare.html must load epoch-helpers.js');
    assert.ok(notableHtml.includes('<script src="lib/epoch-helpers.js"></script>'), 'notable.html must load epoch-helpers.js');
    // status.html must NOT load it (status page unaffected)
    const statusHtml = fs.readFileSync(path.join(root, 'status.html'), 'utf8');
    assert.ok(!statusHtml.includes('epoch-helpers'), 'status.html must not load epoch-helpers.js');
  });

  it('index.html has epoch selector element', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('id="epochSelector"'), 'index.html must have epochSelector element');
    assert.ok(html.includes('buildEpochSelector'), 'index.html must call buildEpochSelector');
    assert.ok(html.includes('onEpochChange'), 'index.html must have onEpochChange handler');
  });

  it('compare.html has epoch selector element', () => {
    const html = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');
    assert.ok(html.includes('id="epochSelector"'), 'compare.html must have epochSelector element');
  });

  it('index.html persists epoch in URL hash', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('writeEpochToHash'), 'index.html must write epoch to hash');
    assert.ok(html.includes('parseEpochFromHash') || html.includes('hashState.epoch'), 'index.html must parse epoch from hash');
  });

  it('index.html uses epoch-aware series URLs', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('EpochHelpers.seriesUrl'), 'index.html must use EpochHelpers.seriesUrl for data fetches');
    assert.ok(html.includes('EpochHelpers.notableUrl'), 'index.html must use EpochHelpers.notableUrl');
  });

  it('compare.html uses epoch-aware series URLs', () => {
    const html = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');
    assert.ok(html.includes('EpochHelpers.seriesUrl'), 'compare.html must use EpochHelpers.seriesUrl');
  });

  it('epoch-helpers.js can be required from Node', () => {
    assert.ok(typeof epochHelpers.resolveEpochs === 'function');
    assert.ok(typeof epochHelpers.seriesUrl === 'function');
    assert.ok(typeof epochHelpers.parseEpochFromHash === 'function');
  });
});

// ===========================================================================
// point-helpers: score range + client saturation (v3 per-result metadata)
// ===========================================================================

describe('scoreRange (point-helpers)', () => {
  it('reads min/max/aggregate when present', () => {
    const r = pointHelpers.scoreRange({ rps: 100, score_min: 90, score_max: 110, score_aggregate: 'median' });
    assert.equal(r.known, true);
    assert.equal(r.min, 90);
    assert.equal(r.max, 110);
    assert.equal(r.aggregate, 'median');
  });

  it('absent keys resolve to known=false (not a zero range)', () => {
    const r = pointHelpers.scoreRange({ rps: 100, cv: 1.2 });
    assert.equal(r.known, false);
    assert.equal(r.min, undefined);
    assert.equal(r.max, undefined);
  });

  it('a lone bound is not enough — known=false', () => {
    assert.equal(pointHelpers.scoreRange({ score_min: 90 }).known, false);
    assert.equal(pointHelpers.scoreRange({ score_max: 110 }).known, false);
  });

  it('null/undefined result is known=false', () => {
    assert.equal(pointHelpers.scoreRange(null).known, false);
    assert.equal(pointHelpers.scoreRange(undefined).known, false);
  });

  it('normalizes inverted bounds', () => {
    const r = pointHelpers.scoreRange({ score_min: 120, score_max: 100 });
    assert.equal(r.min, 100);
    assert.equal(r.max, 120);
  });

  it('omits aggregate when not a non-empty string', () => {
    assert.equal(pointHelpers.scoreRange({ score_min: 1, score_max: 2, score_aggregate: '' }).aggregate, undefined);
    assert.equal(pointHelpers.scoreRange({ score_min: 1, score_max: 2 }).aggregate, undefined);
  });
});

describe('clientState (point-helpers)', () => {
  it('reads a saturated point', () => {
    const s = pointHelpers.clientState({
      client_saturated: true, client_utilization: 0.94,
      client_cores_busy: 7.5, client_allocated_cores: 8,
    });
    assert.equal(s.known, true);
    assert.equal(s.saturated, true);
    assert.equal(s.utilization, 0.94);
    assert.equal(s.cores, 7.5);
    assert.equal(s.allocated, 8);
  });

  it('present-but-false flag: known=true, saturated=false', () => {
    const s = pointHelpers.clientState({ client_saturated: false, client_utilization: 0.66 });
    assert.equal(s.known, true);
    assert.equal(s.saturated, false);
    assert.equal(s.utilization, 0.66);
  });

  it('absent keys resolve to known=false — NOT "not saturated"', () => {
    const s = pointHelpers.clientState({ rps: 100, cv: 1.2 });
    assert.equal(s.known, false);
    assert.equal(s.saturated, undefined);
  });

  it('null/undefined result is known=false', () => {
    assert.equal(pointHelpers.clientState(null).known, false);
    assert.equal(pointHelpers.clientState(undefined).known, false);
  });

  it('utilization alone (no flag) is known with saturated=false', () => {
    const s = pointHelpers.clientState({ client_utilization: 0.5 });
    assert.equal(s.known, true);
    assert.equal(s.saturated, false);
    assert.equal(s.utilization, 0.5);
  });
});

describe('clientTooltipLine (point-helpers)', () => {
  it('formats a saturated line with cores', () => {
    const line = pointHelpers.clientTooltipLine(pointHelpers.clientState({
      client_saturated: true, client_utilization: 0.94,
      client_cores_busy: 7.5, client_allocated_cores: 8,
    }));
    assert.equal(line, 'client saturated: util 0.94 (7.5/8 cores)');
  });

  it('formats a non-saturated util line', () => {
    const line = pointHelpers.clientTooltipLine(pointHelpers.clientState({ client_utilization: 0.66 }));
    assert.equal(line, 'client util 0.66');
  });

  it('unknown state -> empty string (caller omits the line)', () => {
    assert.equal(pointHelpers.clientTooltipLine(pointHelpers.clientState({ rps: 1 })), '');
    assert.equal(pointHelpers.clientTooltipLine(null), '');
  });

  it('trims whole-number cores (8.0 -> 8)', () => {
    const line = pointHelpers.clientTooltipLine(pointHelpers.clientState({
      client_utilization: 0.5, client_cores_busy: 4, client_allocated_cores: 8,
    }));
    assert.equal(line, 'client util 0.50 (4/8 cores)');
  });
});

describe('point-helpers.js can be required from Node', () => {
  it('exports the pure helpers', () => {
    assert.equal(typeof pointHelpers.scoreRange, 'function');
    assert.equal(typeof pointHelpers.clientState, 'function');
    assert.equal(typeof pointHelpers.clientTooltipLine, 'function');
  });
});

describe('score-range / saturation wiring in pages', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');

  it('index.html loads point-helpers.js', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('lib/point-helpers.js'), 'index.html must load lib/point-helpers.js');
  });

  it('index.html uses PointHelpers for range/client state', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('PointHelpers.scoreRange'), 'index.html must call PointHelpers.scoreRange');
    assert.ok(html.includes('PointHelpers.clientState'), 'index.html must call PointHelpers.clientState');
  });

  it('compare.html loads point-helpers.js and reads client state', () => {
    const html = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');
    assert.ok(html.includes('lib/point-helpers.js'), 'compare.html must load lib/point-helpers.js');
    assert.ok(html.includes('PointHelpers.clientState'), 'compare.html must call PointHelpers.clientState');
  });
});

// ===========================================================================
// epoch default selection + archived labelling (live-epoch default rule)
// ===========================================================================

describe('epoch default + archived labelling', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');

  it('resolveEpochs carries the archived flag as a strict boolean', () => {
    assert.equal(epochHelpers.resolveEpochs({ epochs: [{ id: 'v1', archived: true }] })[0].archived, true);
    assert.equal(epochHelpers.resolveEpochs({ epochs: [{ id: 'v3', archived: false }] })[0].archived, false);
    assert.equal(epochHelpers.resolveEpochs({ epochs: [{ id: 'v1' }] })[0].archived, false);
  });

  it('availableEpochs ORs archived across manifests', () => {
    const result = epochHelpers.availableEpochs({
      arm64: { epochs: [{ id: 'v1', archived: true }, { id: 'v3', archived: false }] },
      amd64: { epochs: [{ id: 'v1', archived: false }, { id: 'v3', archived: false }] },
    });
    assert.equal(result.find(e => e.id === 'v1').archived, true);
    assert.equal(result.find(e => e.id === 'v3').archived, false);
  });

  it('defaultEpochId picks the first live epoch when archived is listed first', () => {
    assert.equal(
      epochHelpers.defaultEpochId([{ id: 'v1', archived: true }, { id: 'v3', archived: false }]),
      'v3'
    );
  });

  it('defaultEpochId falls back to list order for pre-flag manifests', () => {
    assert.equal(epochHelpers.defaultEpochId([{ id: 'v1' }, { id: 'v3' }]), 'v1');
  });

  it('defaultEpochId falls back to the first entry when all archived, null when empty', () => {
    assert.equal(epochHelpers.defaultEpochId([{ id: 'v1', archived: true }, { id: 'v3', archived: true }]), 'v1');
    assert.equal(epochHelpers.defaultEpochId([]), null);
  });

  it('epochOptionLabel suffixes archived epochs only', () => {
    assert.equal(epochHelpers.epochOptionLabel({ label: 'Legacy v1 (stock generator)', archived: true }), 'Legacy v1 (stock generator) (archived)');
    assert.equal(epochHelpers.epochOptionLabel({ label: 'Cachecannon v3 (io_uring generator)', archived: false }), 'Cachecannon v3 (io_uring generator)');
  });

  it('index.html defaults the epoch via EpochHelpers.defaultEpochId', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('EpochHelpers.defaultEpochId(epochList)'), 'index.html must default via defaultEpochId, not epochList[0]');
  });

  it('compare.html defaults the epoch via EpochHelpers.defaultEpochId', () => {
    const html = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');
    assert.ok(html.includes('EpochHelpers.defaultEpochId(epochList)'), 'compare.html must default via defaultEpochId, not epochList[0]');
  });

  it('both pages label archived options via EpochHelpers.epochOptionLabel', () => {
    for (const f of ['index.html', 'compare.html']) {
      const html = fs.readFileSync(path.join(root, f), 'utf8');
      assert.ok(html.includes('EpochHelpers.epochOptionLabel(e)'), `${f} must render option text via epochOptionLabel`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// compare-manifest.js — manifest-driven engine and workload discovery
// ═══════════════════════════════════════════════════════════════════════════

describe('compare-manifest.js', () => {
  const ENGINES = [
    { id: 'valkey', label: 'Valkey' },
    { id: 'redis', label: 'Redis' },
  ];
  const PLATFORMS = ['amd64', 'arm64', 'graviton4', 'intel'];
  const cfg = {
    isValidWorkloadId: config.isValidWorkloadId,
    workloadIdToLabel: config.workloadIdToLabel,
  };
  const latencyCfg = {
    isValidWorkloadId: config.isValidLatencyWorkloadId,
    workloadIdToLabel: config.latencyWorkloadIdToLabel,
  };

  // A v3-shaped manifest: throughput + memory with redis-prefixed siblings,
  // a latency list, and epoch metadata.
  function v3Manifest(extra) {
    return Object.assign({
      throughput_workloads: [
        'get-k16-v16-t7-p10', 'set-k16-v16-t7-p10',
        'get-k16-v16-t7-p1', 'get-k16-v1024-t7-p10',
        'redis-get-k16-v16-t7-p10', 'redis-set-k16-v16-t7-p10',
      ],
      memory_workloads: [
        'memory-set-k16-v64', 'memory-zadd-m20',
        'memory-redis-set-k16-v64', 'memory-redis-zadd-m20',
      ],
      // Real fleet shape: a throughput id plus the held request rate.
      latency_workloads: ['get-k16-v16-t7-p1-r100k', 'redis-get-k16-v16-t7-p1-r100k', 'set-k16-v16-t7-p1-r100k'],
      epochs: [{ id: 'v3', label: 'Cachecannon v3', generator: 'cachecannon' }],
      groups: [],
    }, extra || {});
  }

  // A v1-shaped manifest: no epochs, no latency, unprefixed only.
  function v1Manifest(extra) {
    return Object.assign({
      throughput_workloads: ['get-k16-v16-t7-p10', 'set-k16-v16-t7-p10'],
      memory_workloads: ['memory-set-k16-v64'],
      groups: [],
    }, extra || {});
  }

  describe('engineIdsFromManifests', () => {
    it('reports valkey and redis for a v3 manifest with prefixed siblings', () => {
      const engines = compareManifest.engineIdsFromManifests([v3Manifest()], ENGINES);
      assert.deepEqual(engines.map(e => e.id), ['valkey', 'redis']);
    });

    it('reports only valkey when no engine-prefixed workloads exist', () => {
      const engines = compareManifest.engineIdsFromManifests([v1Manifest()], ENGINES);
      assert.deepEqual(engines.map(e => e.id), ['valkey']);
    });

    it('detects redis from a memory prefix even without a throughput prefix', () => {
      const m = v1Manifest({ memory_workloads: ['memory-set-k16-v64', 'memory-redis-set-k16-v64'] });
      const engines = compareManifest.engineIdsFromManifests([m], ENGINES);
      assert.deepEqual(engines.map(e => e.id), ['valkey', 'redis']);
    });

    it('preserves ENGINES order', () => {
      const three = [
        { id: 'valkey', label: 'Valkey' },
        { id: 'keydb', label: 'KeyDB' },
        { id: 'redis', label: 'Redis' },
      ];
      const m = v3Manifest({
        throughput_workloads: ['get-k16-v16-t7-p10', 'redis-get-k16-v16-t7-p10', 'keydb-get-k16-v16-t7-p10'],
      });
      const engines = compareManifest.engineIdsFromManifests([m], three);
      assert.deepEqual(engines.map(e => e.id), ['valkey', 'keydb', 'redis']);
    });

    it('returns empty for empty inputs', () => {
      assert.deepEqual(compareManifest.engineIdsFromManifests([], ENGINES), []);
      assert.deepEqual(compareManifest.engineIdsFromManifests([null], ENGINES), []);
    });
  });

  describe('compareThroughputWorkloads', () => {
    it('returns unprefixed valid ids in first-manifest order', () => {
      const w = compareManifest.compareThroughputWorkloads([v3Manifest()], PLATFORMS, cfg);
      assert.deepEqual(w.map(x => x.id), [
        'get-k16-v16-t7-p10', 'set-k16-v16-t7-p10', 'get-k16-v16-t7-p1', 'get-k16-v1024-t7-p10',
      ]);
      assert.equal(w[0].label, config.workloadIdToLabel('get-k16-v16-t7-p10'));
    });

    it('excludes an id missing from one platform (cross-platform only)', () => {
      const full = v3Manifest();
      const partial = v3Manifest({
        throughput_workloads: ['get-k16-v16-t7-p10', 'set-k16-v16-t7-p10', 'get-k16-v16-t7-p1'],
      }); // missing get-k16-v1024-t7-p10
      const w = compareManifest.compareThroughputWorkloads([full, partial], PLATFORMS, cfg);
      assert.ok(!w.some(x => x.id === 'get-k16-v1024-t7-p10'));
      assert.ok(w.some(x => x.id === 'get-k16-v16-t7-p10'));
    });

    it('drops engine-prefixed and malformed ids via isValidWorkloadId', () => {
      const w = compareManifest.compareThroughputWorkloads([v3Manifest()], PLATFORMS, cfg);
      assert.ok(!w.some(x => x.id.startsWith('redis-')));
    });

    it('returns empty when no manifest is present', () => {
      assert.deepEqual(compareManifest.compareThroughputWorkloads([null, null], PLATFORMS, cfg), []);
    });
  });

  describe('compareMemoryWorkloads', () => {
    const MEMORY_FALLBACK = config.MEMORY_WORKLOADS || ['memory-set-k16-v64'];

    it('returns unprefixed memory ids from the manifest', () => {
      const w = compareManifest.compareMemoryWorkloads([v3Manifest()], MEMORY_FALLBACK, ENGINES);
      assert.deepEqual(w, ['memory-set-k16-v64', 'memory-zadd-m20']);
    });

    it('excludes an id missing from one declaring manifest', () => {
      const full = v3Manifest();
      const partial = v3Manifest({
        memory_workloads: ['memory-set-k16-v64', 'memory-redis-set-k16-v64'],
      }); // missing memory-zadd-m20
      const w = compareManifest.compareMemoryWorkloads([full, partial], MEMORY_FALLBACK, ENGINES);
      assert.deepEqual(w, ['memory-set-k16-v64']);
    });

    it('falls back to the legacy list when NO manifest declares memory_workloads', () => {
      const noMem = { throughput_workloads: ['get-k16-v16-t7-p10'] };
      const w = compareManifest.compareMemoryWorkloads([noMem, noMem], MEMORY_FALLBACK, ENGINES);
      assert.deepEqual(w, MEMORY_FALLBACK);
    });
  });

  describe('compareLatencyWorkloads', () => {
    it('returns unprefixed, rate-suffixed latency ids for v3 with the latency predicates', () => {
      const w = compareManifest.compareLatencyWorkloads([v3Manifest()], latencyCfg, ENGINES);
      assert.deepEqual(w.map(x => x.id), ['get-k16-v16-t7-p1-r100k', 'set-k16-v16-t7-p1-r100k']);
      assert.equal(w[0].label, 'GET K=16B V=16B T=7 P=1 @ 100k req/s');
    });

    it('drops the redis-prefixed latency id', () => {
      const w = compareManifest.compareLatencyWorkloads([v3Manifest()], latencyCfg, ENGINES);
      assert.ok(!w.some(x => x.id.startsWith('redis-')));
    });

    it('yields nothing when handed the THROUGHPUT predicates (the fleet id shape is -r<rate>)', () => {
      // This is the defect a fixture without the rate suffix cannot catch:
      // isValidWorkloadId rejects every real latency id, so the page's
      // latency table silently never rendered.
      assert.deepEqual(compareManifest.compareLatencyWorkloads([v3Manifest()], cfg, ENGINES), []);
    });

    it('is empty for v1 manifests without latency_workloads', () => {
      assert.deepEqual(compareManifest.compareLatencyWorkloads([v1Manifest()], latencyCfg, ENGINES), []);
    });

    it('excludes a latency id missing from one declaring manifest', () => {
      const full = v3Manifest();
      const partial = v3Manifest({ latency_workloads: ['get-k16-v16-t7-p1-r100k'] });
      const w = compareManifest.compareLatencyWorkloads([full, partial], latencyCfg, ENGINES);
      assert.deepEqual(w.map(x => x.id), ['get-k16-v16-t7-p1-r100k']);
    });
  });

  it('is requirable and exports the four helpers', () => {
    assert.equal(typeof compareManifest.engineIdsFromManifests, 'function');
    assert.equal(typeof compareManifest.compareThroughputWorkloads, 'function');
    assert.equal(typeof compareManifest.compareMemoryWorkloads, 'function');
    assert.equal(typeof compareManifest.compareLatencyWorkloads, 'function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// compare.html — manifest-driven wiring (page-source assertions)
// ═══════════════════════════════════════════════════════════════════════════

describe('compare.html manifest wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');

  it('loads lib/compare-manifest.js', () => {
    assert.ok(html.includes('<script src="lib/compare-manifest.js"></script>'));
  });

  it('passes the latency predicates (not the throughput ones) to compareLatencyWorkloads', () => {
    assert.ok(/compareLatencyWorkloads\(manifests,\s*latencyConfig,/.test(html), 'compare.html must call compareLatencyWorkloads with latencyConfig');
    assert.ok(html.includes('isValidWorkloadId: isValidLatencyWorkloadId'), 'latencyConfig must use isValidLatencyWorkloadId');
  });

  it('no longer hardcodes the engine pair ["valkey","redis"]', () => {
    assert.ok(!/\[\s*'valkey'\s*,\s*'redis'\s*\]/.test(html), "compare.html must not contain ['valkey', 'redis']");
  });

  it('no longer assigns COMPARE_MEMORY = MEMORY_WORKLOADS directly', () => {
    assert.ok(!/COMPARE_MEMORY\s*=\s*MEMORY_WORKLOADS\s*;/.test(html), 'compare.html must not assign COMPARE_MEMORY = MEMORY_WORKLOADS');
  });

  it('rebuilds compare lists from the active epoch manifests', () => {
    assert.ok(html.includes('discoverCompareForEpoch'), 'must define/call discoverCompareForEpoch');
    assert.ok(html.includes('CompareManifest.engineIdsFromManifests'));
    assert.ok(html.includes('CompareManifest.compareThroughputWorkloads'));
    assert.ok(html.includes('CompareManifest.compareMemoryWorkloads'));
    assert.ok(html.includes('CompareManifest.compareLatencyWorkloads'));
  });

  it('discovers workloads on epoch change', () => {
    assert.ok(/onEpochChange[\s\S]{0,120}discoverCompareForEpoch/.test(html), 'onEpochChange must re-discover for the new epoch');
  });

  it('render() fetches all series concurrently, not one await per file', () => {
    const start = html.indexOf('async function render()');
    assert.ok(start > 0, 'compare.html must define render()');
    const body = html.slice(start, html.indexOf('ENGINE_SCOPE = {};', start));
    assert.ok(!/await\s+fetchSeries\(/.test(body), 'render() must not await fetchSeries inside the per-file loops');
    assert.ok(/await\s+Promise\.all\(jobs\)/.test(body), 'render() must gather the fetches with Promise.all');
    assert.strictEqual((body.match(/fetchSeries\(/g) || []).length, 3, 'one fetchSeries call per series type (throughput, memory, latency)');
  });

  it('keeps the client-saturated caveat glyph', () => {
    assert.ok(html.includes('saturated'), 'compare.html must keep the client-saturated caveat');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// perf-groups.js — perf/CPU chart group filtering + ordering
// ═══════════════════════════════════════════════════════════════════════════

describe('orderPerfGroups', () => {
  const g = id => ({ id });
  // A manifest in production order: throughput/memory, process-wide base groups,
  // then kernel, cpu profiles, then the per-thread variants.
  const manifest = [
    'throughput', 'memory',
    'efficiency', 'cache', 'pipeline', 'tma', 'branching',
    'kernel', 'cpu-main', 'cpu-io',
    'efficiency-main', 'efficiency-io',
    'cache-main', 'cache-io',
    'pipeline-main', 'pipeline-io',
    'tma-main', 'tma-io',
    'branching-main', 'branching-io',
    'syscalls-main', 'syscalls-io',
    'context-switches-main', 'context-switches-io',
  ].map(g);

  it('hides the process-wide base groups and the combined kernel group', () => {
    const ids = perfGroups.orderPerfGroups(manifest).map(x => x.id);
    for (const hidden of ['throughput', 'memory', 'efficiency', 'cache',
      'pipeline', 'tma', 'branching', 'kernel', 'syscalls', 'context-switches']) {
      assert.ok(!ids.includes(hidden), `${hidden} must be hidden`);
    }
  });

  it('leads with execution efficiency, then the CPU profile', () => {
    const ids = perfGroups.orderPerfGroups(manifest).map(x => x.id);
    assert.deepEqual(ids.slice(0, 4),
      ['efficiency-main', 'efficiency-io', 'cpu-main', 'cpu-io']);
  });

  it('keeps every metric main immediately before its io twin', () => {
    const ids = perfGroups.orderPerfGroups(manifest).map(x => x.id);
    for (const base of ['efficiency', 'cache', 'pipeline', 'tma', 'branching',
      'syscalls', 'context-switches']) {
      const mi = ids.indexOf(`${base}-main`);
      const io = ids.indexOf(`${base}-io`);
      assert.ok(mi !== -1 && io === mi + 1, `${base}: io must follow main (got main@${mi} io@${io})`);
    }
    // cpu profile pair too
    assert.equal(ids.indexOf('cpu-io'), ids.indexOf('cpu-main') + 1);
  });

  it('puts syscalls and context-switches last, syscalls before context-switches', () => {
    const ids = perfGroups.orderPerfGroups(manifest).map(x => x.id);
    assert.deepEqual(ids.slice(-4),
      ['syscalls-main', 'syscalls-io', 'context-switches-main', 'context-switches-io']);
  });

  it('sorts unknown/future groups to the end without dropping them', () => {
    const ids = perfGroups.orderPerfGroups([...manifest, g('newthing-main'), g('newthing-io')]).map(x => x.id);
    assert.ok(ids.includes('newthing-main'), 'unknown group must survive');
    assert.equal(ids.at(-1), 'newthing-io');
  });

  it('renders legacy pre-split kernel-main/-io when a cached manifest still has them', () => {
    const legacy = ['efficiency-main', 'efficiency-io', 'kernel-main', 'kernel-io'].map(g);
    const ids = perfGroups.orderPerfGroups(legacy).map(x => x.id);
    assert.deepEqual(ids, ['efficiency-main', 'efficiency-io', 'kernel-main', 'kernel-io']);
  });

  it('does not mutate the caller array and tolerates junk input', () => {
    const input = [g('cpu-io'), g('cpu-main')];
    const before = input.map(x => x.id);
    perfGroups.orderPerfGroups(input);
    assert.deepEqual(input.map(x => x.id), before, 'input array must be untouched');
    assert.deepEqual(perfGroups.orderPerfGroups(null), []);
    assert.deepEqual(perfGroups.orderPerfGroups(undefined), []);
  });
});

describe('index.html perf-group wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('loads lib/perf-groups.js', () => {
    assert.ok(html.includes('lib/perf-groups.js'), 'index.html must include the perf-groups script');
  });

  it('orders perf metrics via the helper chain rather than inline', () => {
    // index.html -> MetricSelector.buildCatalog -> PerfGroups.orderPerfGroups
    assert.ok(html.includes('MetricSelector.buildCatalog('), 'must build the metric catalog via the helper');
    const ms = fs.readFileSync(path.join(__dirname, '..', 'lib', 'metric-selector.js'), 'utf8');
    assert.ok(ms.includes('.orderPerfGroups(groups)'), 'catalog must be ordered by PerfGroups');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// scope-badge.js — "which workload are the detail charts about?" badge
// ═══════════════════════════════════════════════════════════════════════════

describe('scopeBadge', () => {
  const scopeBadge = require('../lib/scope-badge.js');
  const names = {
    workload: id => ({ 'get-k16-v16-t7-p10': 'GET 16B', 'set-k16-v16-t7-p10': 'SET 16B' }[id] || id),
    platform: id => ({ arm64: 'ARM G3', amd64: 'AMD' }[id] || id),
  };
  const colors = ['#aaa', '#bbb', '#ccc'];
  const getArm = { engine: 'valkey', platform: 'arm64', workloadId: 'get-k16-v16-t7-p10' };
  const setArm = { engine: 'valkey', platform: 'arm64', workloadId: 'set-k16-v16-t7-p10' };
  const getAmd = { engine: 'valkey', platform: 'amd64', workloadId: 'get-k16-v16-t7-p10' };

  it('returns null when nothing is selected', () => {
    assert.equal(scopeBadge.scopeBadge(null, [], names, colors, 'workload'), null);
  });

  it('single selection: workload · platform, that selection\'s colour, no note', () => {
    const b = scopeBadge.scopeBadge(getArm, [getArm], names, colors, 'workload');
    assert.deepEqual(b, { text: 'GET 16B · ARM G3', color: '#aaa', note: null });
  });

  it('multi selection: colour follows the primary\'s position in the selection', () => {
    const b = scopeBadge.scopeBadge(setArm, [getArm, setArm], names, colors, 'workload');
    assert.equal(b.color, '#bbb');
    assert.equal(b.text, 'SET 16B · ARM G3');
  });

  it('multi selection: workload-scoped sections carry the switch note', () => {
    const b = scopeBadge.scopeBadge(getArm, [getArm, setArm], names, colors, 'workload');
    assert.equal(b.note, scopeBadge.NOTE_WORKLOAD);
    assert.match(b.note, /★/);
  });

  it('palette wraps when there are more selections than colours', () => {
    const fourth = { engine: 'valkey', platform: 'arm64', workloadId: 'w4' };
    const b = scopeBadge.scopeBadge(fourth, [getArm, setArm, getAmd, fourth], names, colors, 'workload');
    assert.equal(b.color, '#aaa');
  });

  it('platform scope: text is the platform only; no note while one platform is selected', () => {
    const b = scopeBadge.scopeBadge(setArm, [getArm, setArm], names, colors, 'platform');
    assert.deepEqual(b, { text: 'ARM G3', color: '#bbb', note: null });
  });

  it('platform scope: note appears once the selection spans platforms', () => {
    const b = scopeBadge.scopeBadge(getAmd, [getArm, getAmd], names, colors, 'platform');
    assert.equal(b.text, 'AMD');
    assert.equal(b.note, scopeBadge.NOTE_PLATFORM);
  });

  it('primary not in the selection list still renders (first palette colour)', () => {
    const b = scopeBadge.scopeBadge(getAmd, [getArm], names, colors, 'workload');
    assert.equal(b.color, '#aaa');
    assert.equal(b.text, 'GET 16B · AMD');
  });
});

describe('index.html scope-badge wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('loads lib/scope-badge.js', () => {
    assert.ok(html.includes('lib/scope-badge.js'));
  });

  it('every detail section heading has a badge and a note slot', () => {
    for (const id of ['perfScope', 'perfScopeNote', 'latencyScope', 'latencyScopeNote', 'memoryScope', 'memoryScopeNote']) {
      assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }
  });

  it('badges are refreshed on render and cleared with the selection', () => {
    assert.ok(html.includes('ScopeBadge.scopeBadge('), 'must build badges via the helper');
    assert.ok((html.match(/updateScopeBadges\(\);/g) || []).length >= 2, 'called from render() and clearSelection()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// scope-helpers.js — perf-counter privilege scope (user vs user+kernel)
// Fixture mirrors the shape of a v1 series that was extended past Conductress
// PR #196: cycles/req/main on intel get-k16-v128-t7-p1 sat near 3500 counted
// user-only and jumped to ~9500 once kernel cycles were included.
// ═══════════════════════════════════════════════════════════════════════════

describe('scope-helpers', () => {
  const S = require('../lib/scope-helpers.js');
  const pt = (idx, value, scope) => Object.assign({ commit_index: idx, value }, scope === undefined ? {} : { scope });
  const stepped = [pt(1, 3500, 'user'), pt(2, 3520, 'user'), pt(3, 9500, 'user+kernel'), pt(4, 9480, 'user+kernel')];
  const single = [pt(1, 3500, 'user'), pt(2, 3520, 'user')];

  describe('pointScope', () => {
    it('reads the tagged scope', () => assert.equal(S.pointScope(pt(1, 1, 'user+kernel')), 'user+kernel'));
    it('untagged points are user-only, matching the exporter LEGACY_PERF_SCOPE', () => {
      assert.equal(S.pointScope(pt(1, 1)), 'user');
      assert.equal(S.LEGACY_SCOPE, 'user');
    });
  });

  describe('splitByScope', () => {
    it('single scope: one run with every point', () => {
      const runs = S.splitByScope(single);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].scope, 'user');
      assert.equal(runs[0].points.length, 2);
    });
    it('splits at the step and keeps commit order', () => {
      const runs = S.splitByScope(stepped);
      assert.deepEqual(runs.map(r => [r.scope, r.points.map(p => p.commit_index)]),
        [['user', [1, 2]], ['user+kernel', [3, 4]]]);
    });
    it('a scope that returns starts a new run (A,B,A -> three runs)', () => {
      const runs = S.splitByScope([pt(1, 1, 'user'), pt(2, 2, 'user+kernel'), pt(3, 3, 'user')]);
      assert.deepEqual(runs.map(r => r.scope), ['user', 'user+kernel', 'user']);
    });
    it('empty and missing input yield no runs', () => {
      assert.deepEqual(S.splitByScope([]), []);
      assert.deepEqual(S.splitByScope(null), []);
    });
  });

  describe('scopesOf / scopeBoundaries', () => {
    it('scopes in first-seen order', () => {
      assert.deepEqual(S.scopesOf(stepped), ['user', 'user+kernel']);
      assert.deepEqual(S.scopesOf([pt(1, 1, 'user'), pt(2, 2, 'user+kernel'), pt(3, 3, 'user')]), ['user', 'user+kernel']);
    });
    it('boundary sits on the first point of the new scope', () => {
      assert.deepEqual(S.scopeBoundaries(stepped), [{ commit_index: 3, from: 'user', to: 'user+kernel' }]);
    });
    it('single-scope series has no boundaries', () => assert.deepEqual(S.scopeBoundaries(single), []));
  });

  describe('scopeDatasets', () => {
    it('single scope renders exactly as before: plain label, solid line, in legend', () => {
      const ds = S.scopeDatasets('cycles-per-req-main', single);
      assert.equal(ds.length, 1);
      assert.equal(ds[0].label, 'cycles-per-req-main');
      assert.deepEqual(ds[0].borderDash, []);
      assert.equal(ds[0].legend, true);
      assert.deepEqual(ds[0].data, [{ x: 1, y: 3500 }, { x: 2, y: 3520 }]);
    });
    it('stepped series: one dataset per run, no point shared across the step', () => {
      const ds = S.scopeDatasets('cycles-per-req-main', stepped);
      assert.equal(ds.length, 2);
      assert.deepEqual(ds.map(d => d.data.map(p => p.x)), [[1, 2], [3, 4]]);
    });
    it('stepped series: labels name the scope, later scope is dashed', () => {
      const ds = S.scopeDatasets('cycles-per-req-main', stepped);
      assert.equal(ds[0].label, 'cycles-per-req-main (user)');
      assert.equal(ds[1].label, 'cycles-per-req-main (user+kernel)');
      assert.deepEqual(ds[0].borderDash, []);
      assert.ok(ds[1].borderDash.length > 0);
    });
    it('dash follows the scope, not the run position; repeat scope hidden from legend', () => {
      const ds = S.scopeDatasets('ipc-main', [pt(1, 1, 'user'), pt(2, 2, 'user+kernel'), pt(3, 3, 'user')]);
      assert.deepEqual(ds[2].borderDash, ds[0].borderDash, 'both user runs solid');
      assert.notDeepEqual(ds[1].borderDash, ds[0].borderDash);
      assert.deepEqual(ds.map(d => d.legend), [true, true, false]);
    });
  });

  describe('scopedDelta', () => {
    it('same scope: numeric delta', () => {
      assert.deepEqual(S.scopedDelta(stepped[1], stepped[0]), { comparable: true, delta: 20 });
    });
    it('across the step: not comparable, names both scopes, no number', () => {
      const d = S.scopedDelta(stepped[2], stepped[1]);
      assert.equal(d.comparable, false);
      assert.equal(d.from, 'user');
      assert.equal(d.to, 'user+kernel');
      assert.equal('delta' in d, false);
    });
    it('untagged previous point compares as user', () => {
      assert.equal(S.scopedDelta(pt(2, 5, 'user'), pt(1, 4)).comparable, true);
      assert.equal(S.scopedDelta(pt(2, 5, 'user+kernel'), pt(1, 4)).comparable, false);
    });
    it('missing point -> null', () => {
      assert.equal(S.scopedDelta(stepped[0], null), null);
      assert.equal(S.scopedDelta(null, stepped[0]), null);
    });
  });
});

describe('index.html scope-helpers wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('loads lib/scope-helpers.js', () => assert.ok(html.includes('lib/scope-helpers.js')));
  it('perf charts build datasets per scope run and mark boundaries', () => {
    assert.ok(html.includes('ScopeHelpers.scopeDatasets('), 'datasets must come from the split helper');
    assert.ok(html.includes('ScopeHelpers.scopeBoundaries('), 'boundaries drawn as annotations');
  });
  it('commit popup guards the perf delta with scopedDelta', () => {
    assert.ok(html.includes('ScopeHelpers.scopedDelta('));
  });
  it('info-row formatter receives the hit dataset index', () => {
    assert.ok(html.includes('formatter(chart, pts[0].index, pts[0].datasetIndex)'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// freshness-helpers.js — release / HEAD anchors, commit age, roster completeness
// Fixtures mirror live v3 series shapes read off the data server on
// 2026-09-22: Redis (release-and-tip) throughput points carry `sample`,
// Valkey (history) points carry `sample`, memory/latency points do not.
// ═══════════════════════════════════════════════════════════════════════════

const freshness = require('../lib/freshness-helpers.js');

const NOW = Date.parse('2026-09-22T16:00:00Z');
const REL_OLD = '58d0fb9c62e88df331c55dec378cd149909d406b';
const REL_NEW = '51913f6923875e26c7c7284ae0b10d0528d73900';
const TIP_A = '0d6266f2deb9c401b686898e263ebd6fe35bc2b0';
const TIP_B = 'c3215f01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function tpoint(commit, idx, date, sample, wl, rps) {
  return { commit, commit_index: idx, date, sample, results: { [wl]: { rps, cv: 0.3, reps: 5 } } };
}
// amd64 redis-get-k16-v16-t7-p10: both release landmarks measured, two tips.
const redisP10 = {
  metadata: { engine: 'redis', scope: 'release-and-tip', epoch: 'v3' },
  landmarks: [{ label: '8.12', commit_index: 716 }],
  points: [
    tpoint(REL_OLD, 642, '2026-07-29', 'release', 'redis-get-k16-v16-t7-p10', 3933603),
    tpoint(REL_NEW, 716, '2026-09-15', 'release', 'redis-get-k16-v16-t7-p10', 3900000),
    tpoint(TIP_A, 725, '2026-09-21', 'tip', 'redis-get-k16-v16-t7-p10', 3890000),
    tpoint(TIP_B, 727, '2026-09-22', 'tip', 'redis-get-k16-v16-t7-p10', 3895000),
  ],
};
// graviton4 redis-get-k16-v16-t7-p10: still on the OLD release, one tip behind.
const redisP10Lagging = {
  metadata: { engine: 'redis', scope: 'release-and-tip', epoch: 'v3' },
  landmarks: [{ label: '8.12', commit_index: 716 }],
  points: [
    tpoint(REL_OLD, 642, '2026-07-29', 'release', 'redis-get-k16-v16-t7-p10', 3933603),
    tpoint(TIP_A, 725, '2026-09-21', 'tip', 'redis-get-k16-v16-t7-p10', 3890000),
  ],
};
// graviton4 redis-get-k16-v16-t7-p1: new release, latest tip.
const redisP1 = {
  metadata: { engine: 'redis', scope: 'release-and-tip', epoch: 'v3' },
  landmarks: [{ label: '8.12', commit_index: 716 }],
  points: [
    tpoint(REL_NEW, 716, '2026-09-15', 'release', 'redis-get-k16-v16-t7-p1', 1200000),
    tpoint(TIP_B, 727, '2026-09-22', 'tip', 'redis-get-k16-v16-t7-p1', 1210000),
  ],
};
// Untagged latency series (no `sample`), landmark at 716, exact point present.
const latencyUntagged = {
  metadata: { engine: 'redis', epoch: 'v3' },
  landmarks: [{ label: '8.12', commit_index: 716 }],
  points: [
    { commit: REL_NEW, commit_index: 716, date: '2026-09-15', histogram: [[50, 20], [90, 22], [99, 29]] },
    { commit: TIP_B, commit_index: 727, date: '2026-09-22', histogram: [[50, 20], [90, 22], [99, 30]] },
  ],
};
// Valkey history-scope: tips only so far (rebuild), landmarks with no point yet.
const valkeyP10 = {
  metadata: { engine: 'valkey', scope: 'history', epoch: 'v3' },
  landmarks: [{ label: '9.1', commit_index: 1837 }, { label: '9.2', commit_index: 2261 }],
  points: [
    tpoint('f2bcd083', 2275, '2026-09-21', 'tip', 'get-k16-v16-t7-p10', 3100000),
    tpoint('77b00b2d', 2277, '2026-09-22', 'tip', 'get-k16-v16-t7-p10', 3120000),
  ],
};

describe('freshness releasePoint', () => {
  it('picks the newest sample=release point and labels it from the matching landmark', () => {
    const r = freshness.releasePoint(redisP10);
    assert.equal(r.point.commit, REL_NEW);
    assert.equal(r.label, '8.12');
  });
  it('an older release point with no landmark keeps a null label', () => {
    const r = freshness.releasePoint(redisP10Lagging);
    assert.equal(r.point.commit, REL_OLD);
    assert.equal(r.label, null);
  });
  it('untagged series: the point sitting exactly on the newest release landmark', () => {
    const r = freshness.releasePoint(latencyUntagged);
    assert.equal(r.point.commit, REL_NEW);
    assert.equal(r.label, '8.12');
  });
  it('untagged series with no point on the landmark -> null (never the nearest point)', () => {
    const s = { landmarks: [{ label: '8.12', commit_index: 716 }], points: [{ commit: TIP_B, commit_index: 727, date: '2026-09-22' }] };
    assert.equal(freshness.releasePoint(s), null);
  });
  it('tagged series with no release point and no landmark hit -> null', () => {
    assert.equal(freshness.releasePoint(valkeyP10), null);
  });
  it('null / empty -> null', () => {
    assert.equal(freshness.releasePoint(null), null);
    assert.equal(freshness.releasePoint({ points: [] }), null);
  });
});

describe('freshness headPoint', () => {
  it('tagged series: newest tip, even when a release point is present', () => {
    assert.equal(freshness.headPoint(redisP10).point.commit, TIP_B);
    assert.equal(freshness.headPoint(redisP10Lagging).point.commit, TIP_A);
  });
  it('tagged series whose newest point is a release still returns the tip', () => {
    const s = { points: [tpoint(TIP_A, 700, '2026-09-10', 'tip', 'w', 1), tpoint(REL_NEW, 716, '2026-09-15', 'release', 'w', 1)] };
    assert.equal(freshness.headPoint(s).point.commit, TIP_A);
  });
  it('tagged series with no tip -> null', () => {
    const s = { points: [tpoint(REL_NEW, 716, '2026-09-15', 'release', 'w', 1)] };
    assert.equal(freshness.headPoint(s), null);
  });
  it('untagged series: newest point by commit_index', () => {
    assert.equal(freshness.headPoint(latencyUntagged).point.commit, TIP_B);
  });
  it('history-scope Valkey: newest tip', () => {
    assert.equal(freshness.headPoint(valkeyP10).point.commit, '77b00b2d');
  });
});

describe('freshness commitAgeDays / formatAge', () => {
  it('whole days from a YYYY-MM-DD commit date', () => {
    assert.equal(freshness.commitAgeDays('2026-09-15', NOW), 7);
    assert.equal(freshness.commitAgeDays('2026-09-22', NOW), 0);
    assert.equal(freshness.commitAgeDays('2026-07-29', NOW), 55);
  });
  it('never negative; invalid -> null', () => {
    assert.equal(freshness.commitAgeDays('2026-09-23', NOW), 0);
    assert.equal(freshness.commitAgeDays('garbage', NOW), null);
    assert.equal(freshness.commitAgeDays(null, NOW), null);
  });
  it('formats today / N d / empty', () => {
    assert.equal(freshness.formatAge(0), 'today');
    assert.equal(freshness.formatAge(7), '7 d');
    assert.equal(freshness.formatAge(null), '');
  });
});

describe('freshness rosterFreshness / engineFreshness', () => {
  it('complete: every sweep on the same commit (amd64 today)', () => {
    const f = freshness.engineFreshness([{ id: 'get-k16-v16-t7-p10', series: redisP10 }, { id: 'get-k16-v16-t7-p1', series: redisP1 }], NOW);
    assert.equal(f.release.state, 'complete');
    assert.equal(f.release.newest.commit, REL_NEW);
    assert.equal(f.release.newest.label, '8.12');
    assert.equal(f.release.newest.ageDays, 7);
    assert.equal(f.head.state, 'complete');
    assert.equal(f.head.newest.commit, TIP_B);
    assert.equal(f.head.newest.ageDays, 0);
    assert.equal(f.head.measured, 2);
    assert.equal(f.head.total, 2);
  });
  it('partial: sweeps span more than one commit (graviton4 today) with newest reported', () => {
    const f = freshness.engineFreshness([{ id: 'get-k16-v16-t7-p10', series: redisP10Lagging }, { id: 'get-k16-v16-t7-p1', series: redisP1 }], NOW);
    assert.equal(f.release.state, 'partial');
    assert.deepEqual(f.release.commits, [REL_NEW, REL_OLD]);
    assert.equal(f.release.newest.commit, REL_NEW);
    assert.equal(f.release.spanDays, 48);
    assert.equal(f.head.state, 'partial');
    assert.equal(f.head.newest.commit, TIP_B);
    assert.equal(f.head.spanDays, 1);
  });
  it('missing: a sweep with no point (or no series) is counted, not dropped', () => {
    const f = freshness.engineFreshness([{ id: 'a', series: redisP10 }, { id: 'b', series: null }], NOW);
    assert.equal(f.release.state, 'missing');
    assert.equal(f.release.measured, 1);
    assert.equal(f.release.total, 2);
    assert.equal(f.release.items[1].present, false);
    const g = freshness.engineFreshness([{ id: 'a', series: redisP10 }, { id: 'v', series: valkeyP10 }], NOW);
    assert.equal(g.release.state, 'missing', 'no release point on one sweep is missing, not partial');
    assert.equal(g.head.state, 'partial', 'both have tips, on different commits');
  });
  it('none: empty roster or nothing measured', () => {
    assert.equal(freshness.rosterFreshness([], freshness.headPoint, NOW).state, 'none');
    const f = freshness.rosterFreshness([{ id: 'a', series: null }], freshness.headPoint, NOW);
    assert.equal(f.state, 'none');
    assert.equal(f.newest, null);
  });
  it('mixed tagged and untagged sweeps agree when on the same commit', () => {
    const f = freshness.engineFreshness([{ id: 'p1', series: redisP1 }, { id: 'lat', series: latencyUntagged }], NOW);
    assert.equal(f.release.state, 'complete');
    assert.equal(f.head.state, 'complete');
  });
});

describe('freshness engineScope / headBasis / columnSummary', () => {
  it('scope comes from the first series carrying metadata.scope', () => {
    assert.equal(freshness.engineScope([null, latencyUntagged, redisP10]), 'release-and-tip');
    assert.equal(freshness.engineScope([valkeyP10]), 'history');
    assert.equal(freshness.engineScope([latencyUntagged]), null);
    assert.equal(freshness.engineScope([]), null);
  });
  it('HEAD basis: newest tip for release-and-tip, median otherwise', () => {
    assert.equal(freshness.headBasis('release-and-tip'), 'newest tip point');
    assert.equal(freshness.headBasis('history'), 'median of last 5 points');
    assert.equal(freshness.headBasis(null), 'median of last 5 points');
  });
  it('columnSummary renders label, short sha, date, age, count', () => {
    const f = freshness.engineFreshness([{ id: 'a', series: redisP10 }], NOW);
    assert.deepEqual(freshness.columnSummary(f.release), { label: '8.12', sha: '51913f69', date: '2026-09-15', age: '7 d', count: '1/1' });
    assert.deepEqual(freshness.columnSummary(f.head), { label: null, sha: 'c3215f01', date: '2026-09-22', age: 'today', count: '1/1' });
    assert.equal(freshness.columnSummary(freshness.rosterFreshness([{ id: 'a', series: null }], freshness.headPoint, NOW)).count, '0/1');
  });
  it('state colours use theme variables only', () => {
    for (const s of ['complete', 'partial', 'missing', 'none', 'bogus']) assert.match(freshness.stateColor(s), /^var\(--/);
  });
});

describe('historyEngines (config.js)', () => {
  it('keeps only engines with a per-commit history line (Redis is release-and-tip)', () => {
    assert.deepEqual(config.historyEngines().map(e => e.id), ['valkey']);
  });
  it('an engine without the flag is treated as history (backwards compatible)', () => {
    assert.deepEqual(config.historyEngines([{ id: 'x' }, { id: 'y', history: false }]).map(e => e.id), ['x']);
  });
});

describe('compare.html freshness + HEAD wiring', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'compare.html'), 'utf8');
  it('loads the freshness helper and renders the strip', () => {
    assert.ok(html.includes('lib/freshness-helpers.js'));
    assert.ok(html.includes('renderFreshnessStrip('));
  });
  it('HEAD values are scope-aware everywhere (no bare getLatestValue/getLatencyLatest calls)', () => {
    const bare = html.match(/getLat(?:estValue|encyLatest)\([^)]*\)(?:;|\s*$)/gm) || [];
    const unscoped = bare.filter(c => !c.includes('ENGINE_SCOPE') && !c.startsWith('function'));
    assert.deepEqual(unscoped, []);
    assert.ok(!html.includes('— median of last 5 data points'), 'fixed median text must be replaced by the per-engine basis');
  });
});

describe('index.html history engines only', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  it('selector items and hash decoding iterate historyEngines()', () => {
    assert.ok(!/for \(const eng of ENGINES\)/.test(html));
    assert.ok((html.match(/historyEngines\(\)/g) || []).length >= 2);
  });
  // The history page shows Valkey only, so the selector carries no engine
  // chip group, no engine column and no engine prefix in its summary line.
  // The engine stays in the selection model (file ids, hash) untouched.
  it('selector has no engine filter chip or column', () => {
    assert.ok(!/key: 'engine', values:/.test(html), 'engine chip group must not be built');
    assert.ok(!/key: 'engine',\s+label: 'Engine'/.test(html), 'engine column must not be defined');
    assert.ok(!/activeFilters = \{ engine:/.test(html), 'engine must not be a filter key');
    assert.ok(/SELECTOR_COLUMNS\.slice\(1, 3\)\)/.test(html), 'fallback columns must still be Cmd + Value');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// latency-helpers.js — latency series id, header, load label, percentiles
// Fixtures mirror the live manifests: the legacy manifest lists
// ['get-k16-v16']; the v3 manifest lists a full shape with a held rate plus
// an engine-prefixed twin, and its points carry named pNN_us fields with no
// histogram.
// ═══════════════════════════════════════════════════════════════════════════
const latency = require('../lib/latency-helpers.js');

describe('latencyCommand', () => {
  it('reads get/set from the primary workload id', () => {
    assert.equal(latency.latencyCommand('get-k16-v16-t7-p10'), 'get');
    assert.equal(latency.latencyCommand('set-k16-v1024-t7-p1'), 'set');
  });
  it('falls back to get for mixed, empty and unknown ids', () => {
    assert.equal(latency.latencyCommand('mixed-s20-k16-v16-t7-p10'), 'get');
    assert.equal(latency.latencyCommand(undefined), 'get');
    assert.equal(latency.latencyCommand('bogus'), 'get');
  });
});

describe('latencySeriesId', () => {
  const v3 = ['get-k16-v16-t7-p1-r100k', 'redis-get-k16-v16-t7-p1-r100k'];
  const legacy = ['get-k16-v16'];

  it('picks the un-prefixed id for valkey from a v3 manifest', () => {
    assert.equal(latency.latencySeriesId(v3, 'get', 'valkey'), 'get-k16-v16-t7-p1-r100k');
  });
  it('picks the engine-prefixed id for another engine', () => {
    assert.equal(latency.latencySeriesId(v3, 'get', 'redis'), 'redis-get-k16-v16-t7-p1-r100k');
  });
  it('returns null when the manifest has no series for the command', () => {
    assert.equal(latency.latencySeriesId(v3, 'set', 'valkey'), null);
    assert.equal(latency.latencySeriesId(v3, 'set', 'redis'), null);
  });
  it('keeps the legacy id from a legacy manifest', () => {
    assert.equal(latency.latencySeriesId(legacy, 'get', 'valkey'), 'get-k16-v16');
  });
  it('prefixes at fetch time when a legacy manifest lists only valkey ids', () => {
    assert.equal(latency.latencySeriesId(legacy, 'get', 'redis'), 'redis-get-k16-v16');
  });
  it('falls back to the legacy id when the manifest is missing or empty', () => {
    assert.equal(latency.latencySeriesId(undefined, 'get', 'valkey'), 'get-k16-v16');
    assert.equal(latency.latencySeriesId([], 'set', 'valkey'), 'set-k16-v16');
    assert.equal(latency.latencySeriesId(null, 'get', 'redis'), 'redis-get-k16-v16');
  });
  it('does not mistake a prefixed id for a valkey one', () => {
    assert.equal(latency.latencySeriesId(['redis-get-k16-v16-t7-p1-r100k'], 'get', 'valkey'), null);
  });
  it('ignores non-string entries', () => {
    assert.equal(latency.latencySeriesId([null, 42, 'get-k16-v16-t7-p1-r100k'], 'get', 'valkey'), 'get-k16-v16-t7-p1-r100k');
  });
});

describe('latencyShapeLabel', () => {
  it('spells out a full v3 id without the command word', () => {
    assert.equal(latency.latencyShapeLabel('get-k16-v16-t7-p1-r100k'), 'K=16B V=16B T=7 P=1 @ 100k req/s');
  });
  it('drops the engine prefix', () => {
    assert.equal(latency.latencyShapeLabel('redis-get-k16-v16-t7-p1-r100k'), 'K=16B V=16B T=7 P=1 @ 100k req/s');
  });
  it('omits parts a legacy id does not carry', () => {
    assert.equal(latency.latencyShapeLabel('get-k16-v16'), 'K=16B V=16B');
  });
  it('handles a bare rate without the k suffix and mixed ids', () => {
    assert.equal(latency.latencyShapeLabel('mixed-s20-k16-v64-t7-p10-r500'), 'K=16B V=64B T=7 P=10 @ 500 req/s');
  });
  it('returns unparseable ids unchanged', () => {
    assert.equal(latency.latencyShapeLabel('weird'), 'weird');
    assert.equal(latency.latencyShapeLabel(undefined), '');
  });
});

describe('latencyLoadLabel', () => {
  it('formats thousands and millions', () => {
    assert.equal(latency.latencyLoadLabel(100000), '100k req/s');
    assert.equal(latency.latencyLoadLabel(99999.4), '100k req/s');
    assert.equal(latency.latencyLoadLabel(1500000), '1.50M req/s');
    assert.equal(latency.latencyLoadLabel(500), '500 req/s');
  });
  it('shows a dash for unknown rates', () => {
    assert.equal(latency.latencyLoadLabel(undefined), '\u2014');
    assert.equal(latency.latencyLoadLabel(0), '\u2014');
    assert.equal(latency.latencyLoadLabel('nope'), '\u2014');
  });
});

describe('latencyPercentiles', () => {
  it('reads named fields when no histogram is published (v3 point)', () => {
    const pc = latency.latencyPercentiles({ p50_us: 13, p99_us: 19, p99_9_us: 98, p100_us: 511 });
    assert.equal(pc.p50, 13);
    assert.equal(pc.p99, 19);
    assert.equal(pc['p99.9'], 98);
    assert.equal(pc.p100, 511);
    assert.equal(pc.p90, null);
    assert.equal(pc.p10, null);
  });
  it('reads every percentile from a full histogram', () => {
    const histogram = latency.HISTOGRAM_PCTS.map((_, i) => [i, (i + 1) * 10]);
    const pc = latency.latencyPercentiles({ histogram });
    assert.equal(pc.p1, 10);
    assert.equal(pc.p50, 40);
    assert.equal(pc.p90, 60);
    assert.equal(pc.p99, 80);
    assert.equal(pc['p99.9'], 100);
    assert.equal(pc.p100, 110);
  });
  it('prefers the histogram but fills gaps from named fields', () => {
    const histogram = [[1, 5], [10, 6], [25, 7], [50, 0]];
    const pc = latency.latencyPercentiles({ histogram, p50_us: 12, p99_us: 20 });
    assert.equal(pc.p25, 7);
    assert.equal(pc.p50, 12);
    assert.equal(pc.p99, 20);
  });
  it('yields all-null for a missing point', () => {
    const pc = latency.latencyPercentiles(null);
    assert.ok(Object.values(pc).every(v => v === null));
    assert.deepEqual(Object.keys(pc), latency.HISTOGRAM_PCTS);
  });
});

describe('index.html latency + render-race wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('loads lib/latency-helpers.js and resolves the series id from the manifest', () => {
    assert.ok(html.includes('lib/latency-helpers.js'));
    assert.ok(html.includes('LatencyHelpers.latencySeriesId('));
    assert.ok(!/`\$\{command\}-k16-v16`/.test(html), 'latency id must not be hardcoded');
    assert.ok(!html.includes('(P=1 @ 100K rps flat)'), 'latency header must derive from the series id');
    assert.ok(!html.includes('(70%)'), 'load label must derive from target_rps');
  });

  it('fans zoom and crosshair out over live charts only', () => {
    assert.ok(html.includes('function liveCharts()'));
    // Every remaining direct walk of allCharts must be a destroy sweep.
    const walks = html.match(/allCharts\.forEach\([^)]*\)/g) || [];
    assert.ok(walks.every(w => w.includes('destroy')), `unexpected direct walks: ${walks.join(' | ')}`);
    assert.ok(/function syncZoom[^\n]*liveCharts\(\)/.test(html));
  });

  it('stamps renders with a generation and re-checks it after awaits', () => {
    assert.ok(html.includes('const gen = ++renderGeneration;'));
    const checks = (html.match(/if \(renderIsStale\(gen\)\) return;/g) || []).length;
    assert.ok(checks >= 9, `expected staleness checks after every await, found ${checks}`);
    // The perf section has its own generation (a metric change redraws it
    // alone); its loop checks both through one closure after each await.
    assert.ok(html.includes('const stale = () => renderIsStale(gen) || perfGen !== perfRenderGeneration;'));
    assert.ok(html.includes('if (stale()) return;'));
    for (const fn of ['renderMemory(platform, data, gen)', 'renderPerfCharts(platform, gen)', 'renderLatency(platform, gen)']) {
      assert.ok(html.includes(fn), `${fn} must receive the generation`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// selector-helpers.js — two-section workload selector (selected / available)
// ═══════════════════════════════════════════════════════════════════════════
const selector = require('../lib/selector-helpers.js');

describe('parseWorkloadId', () => {
  it('extracts command, value size, threads and pipelining', () => {
    assert.deepEqual(selector.parseWorkloadId('get-k16-v128-t7-p10'), { command: 'get', valsize: '128', threads: '7', pipelining: '10' });
    assert.deepEqual(selector.parseWorkloadId('mixed-s20-k16-v16-t7-p1'), { command: 'mixed-s20', valsize: '16', threads: '7', pipelining: '1' });
  });
  it('yields nulls for unknown shapes', () => {
    assert.deepEqual(selector.parseWorkloadId('bogus'), { command: null, valsize: null, threads: null, pipelining: null });
    assert.deepEqual(selector.parseWorkloadId(undefined), { command: null, valsize: null, threads: null, pipelining: null });
  });
});

describe('partitionSelectorItems', () => {
  const mk = (platform, id) => ({ engine: 'valkey', platform, workloadId: id, engineLabel: 'Valkey', platLabel: platform, ...selector.parseWorkloadId(id) });
  const items = [
    mk('amd64', 'get-k16-v16-t7-p10'), mk('amd64', 'set-k16-v16-t7-p10'), mk('amd64', 'get-k16-v16-t7-p1'),
    mk('graviton4', 'get-k16-v16-t7-p10'), mk('graviton4', 'set-k16-v16-t7-p10'),
  ];
  const noFilters = { engine: null, platform: null, command: null, valsize: null, pipelining: null };

  it('keeps the selected section in selection order and out of the available section', () => {
    const selected = [items[4], items[0]];
    const { selected: s, available: a } = selector.partitionSelectorItems(items, selected, noFilters);
    assert.deepEqual(s.map(selector.selectionKey), selected.map(selector.selectionKey));
    assert.equal(a.length, 3);
    assert.ok(a.every(it => !selected.some(sel => selector.selectionKey(sel) === selector.selectionKey(it))));
  });

  it('never hides a selected row behind a filter', () => {
    const selected = [items[1]]; // amd64 SET
    const { selected: s, available: a } = selector.partitionSelectorItems(items, selected, { ...noFilters, command: 'get' });
    assert.equal(s.length, 1);
    assert.equal(s[0].workloadId, 'set-k16-v16-t7-p10');
    assert.ok(a.every(it => it.command === 'get'));
    assert.equal(a.length, 3);
  });

  it('applies platform and pipelining filters to the available section', () => {
    const { available } = selector.partitionSelectorItems(items, [], { ...noFilters, platform: 'graviton4', pipelining: '10' });
    assert.deepEqual(available.map(it => it.workloadId), ['get-k16-v16-t7-p10', 'set-k16-v16-t7-p10']);
  });

  it('synthesizes a row for a selected series the manifest no longer lists', () => {
    const stale = { engine: 'valkey', platform: 'intel', workloadId: 'get-k16-v16-t24-p100' };
    const { selected } = selector.partitionSelectorItems(items, [stale], noFilters);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].missing, true);
    assert.equal(selected[0].command, 'get');
    assert.equal(selected[0].pipelining, '100');
  });

  it('sorts only the available section', () => {
    const columns = [{ key: 'pipelining', val: it => +it.pipelining, num: true }];
    const selected = [items[1], items[0]];
    const { selected: s, available: a } = selector.partitionSelectorItems(items, selected, noFilters, { col: 'pipelining', dir: 1, columns });
    assert.deepEqual(s.map(it => it.workloadId), ['set-k16-v16-t7-p10', 'get-k16-v16-t7-p10']);
    assert.deepEqual(a.map(it => +it.pipelining), [1, 10, 10]);
    const desc = selector.partitionSelectorItems(items, selected, noFilters, { col: 'pipelining', dir: -1, columns }).available;
    assert.deepEqual(desc.map(it => +it.pipelining), [10, 10, 1]);
  });

  it('tolerates missing inputs', () => {
    assert.deepEqual(selector.partitionSelectorItems(undefined, undefined, undefined), { selected: [], available: [] });
  });
});

describe('visibleColumns', () => {
  const cols = [
    { key: 'platform', text: it => it.platform },
    { key: 'command', text: it => it.command },
  ];
  it('keeps only columns that vary across both sections together', () => {
    const rows = [{ platform: 'amd64', command: 'get' }, { platform: 'amd64', command: 'set' }];
    assert.deepEqual(selector.visibleColumns(rows, cols).map(c => c.key), ['command']);
  });
  it('falls back when nothing varies', () => {
    const rows = [{ platform: 'amd64', command: 'get' }];
    assert.deepEqual(selector.visibleColumns(rows, cols, [cols[1]]).map(c => c.key), ['command']);
    assert.deepEqual(selector.visibleColumns([], cols), []);
  });
});

describe('index.html selector overlay wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('renders the panel inside the header as a positioned overlay', () => {
    const header = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
    assert.ok(header.includes('id="selectorPanel"'), 'panel must live inside the header so it is anchored to it');
    assert.ok(/\.selector-panel \{[^}]*position: absolute/.test(html));
    assert.ok(/\.selector-panel \{[^}]*z-index/.test(html));
    assert.ok(!/\.selector-panel \{[^}]*margin-top/.test(html), 'overlay must not take layout space');
  });

  it('closes on Escape and on clicks outside, via the helper', () => {
    assert.ok(html.includes('function setSelectorPanel(open)'));
    assert.ok(/e\.key === 'Escape' && isSelectorPanelOpen\(\)/.test(html));
    assert.ok(html.includes("e.target.closest('#selectorPanel')"));
  });

  it('builds the two-section list through SelectorHelpers', () => {
    assert.ok(html.includes('lib/selector-helpers.js'));
    assert.ok(html.includes('SelectorHelpers.partitionSelectorItems('));
    assert.ok(html.includes('SelectorHelpers.visibleColumns('));
    assert.ok(html.includes('data-action="clear-selection"'));
    assert.ok(!html.includes("clearS.textContent = '✕ Clear Selection'"), 'Clear Selection chip moved into the Selected section');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// selection-helpers.js — cross-platform overlays: labels + hash encoding
// ═══════════════════════════════════════════════════════════════════════════
const selection = require('../lib/selection-helpers.js');

describe('seriesLabel', () => {
  const names = { workload: id => 'W(' + id + ')', platform: id => 'P(' + id + ')', engine: id => 'E(' + id + ')' };
  const g4get = { engine: 'valkey', platform: 'graviton4', workloadId: 'get' };
  const g4set = { engine: 'valkey', platform: 'graviton4', workloadId: 'set' };
  const amdget = { engine: 'valkey', platform: 'amd64', workloadId: 'get' };

  it('is just the workload label within one platform', () => {
    assert.equal(selection.seriesLabel(g4get, [g4get, g4set], names), 'W(get)');
  });
  it('prepends the platform when the selection spans platforms', () => {
    assert.equal(selection.seriesLabel(g4get, [g4get, amdget], names), 'P(graviton4) · W(get)');
    assert.equal(selection.seriesLabel(amdget, [g4get, amdget], names), 'P(amd64) · W(get)');
  });
  it('prepends the engine too when engines differ', () => {
    const redis = { engine: 'redis', platform: 'graviton4', workloadId: 'get' };
    assert.equal(selection.seriesLabel(redis, [g4get, redis], names), 'E(redis) · W(get)');
    assert.equal(selection.seriesLabel(redis, [amdget, redis], names), 'E(redis) · P(graviton4) · W(get)');
  });
});

describe('encodeWorkloads / decodeWorkloads', () => {
  const g4get = { engine: 'valkey', platform: 'graviton4', workloadId: 'get-k16-v16-t7-p10' };
  const g4set = { engine: 'valkey', platform: 'graviton4', workloadId: 'set-k16-v16-t7-p10' };
  const amdget = { engine: 'valkey', platform: 'amd64', workloadId: 'get-k16-v16-t7-p10' };

  it('writes bare ids when everything is on the primary platform (old form)', () => {
    assert.equal(selection.encodeWorkloads([g4get, g4set], 'graviton4'), 'get-k16-v16-t7-p10,set-k16-v16-t7-p10');
  });
  it('writes platform:id for every entry once any entry is elsewhere', () => {
    assert.equal(selection.encodeWorkloads([g4get, amdget], 'graviton4'), 'graviton4:get-k16-v16-t7-p10,amd64:get-k16-v16-t7-p10');
  });
  it('decodes the old bare form onto the fallback platform', () => {
    assert.deepEqual(selection.decodeWorkloads('get-k16-v16-t7-p10,set-k16-v16-t7-p10', 'graviton4', 'valkey'), [g4get, g4set]);
  });
  it('decodes platform-qualified entries and mixes with bare ones', () => {
    assert.deepEqual(selection.decodeWorkloads('graviton4:get-k16-v16-t7-p10,amd64:get-k16-v16-t7-p10', 'intel', 'valkey'), [g4get, amdget]);
    assert.deepEqual(selection.decodeWorkloads('set-k16-v16-t7-p10,amd64:get-k16-v16-t7-p10', 'graviton4', 'valkey'), [g4set, amdget]);
  });
  it('round-trips a mixed selection', () => {
    const sels = [g4get, amdget, g4set];
    assert.deepEqual(selection.decodeWorkloads(selection.encodeWorkloads(sels, 'graviton4'), 'graviton4', 'valkey'), sels);
  });
  it('drops empty entries and handles a missing parameter', () => {
    assert.deepEqual(selection.decodeWorkloads('', 'x', 'valkey'), []);
    assert.deepEqual(selection.decodeWorkloads(null, 'x', 'valkey'), []);
    assert.equal(selection.decodeWorkloads('a,,b', 'x', 'valkey').length, 2);
  });
});

describe('index.html cross-platform selection wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('no longer gates multi-select on engine+platform', () => {
    assert.ok(!html.includes('sameContext'));
  });
  it('labels and hash go through SelectionHelpers', () => {
    assert.ok(html.includes('lib/selection-helpers.js'));
    assert.ok(html.includes('SelectionHelpers.seriesLabel('));
    assert.ok(html.includes('SelectionHelpers.encodeWorkloads('));
    assert.ok(html.includes('SelectionHelpers.decodeWorkloads('));
    assert.ok(!html.includes("params.get('workloads')?.split(',')"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// axis-ticks.js — release-marked x axis
// ═══════════════════════════════════════════════════════════════════════════

describe('axis-ticks.js', () => {
  const axis = require('../lib/axis-ticks.js');
  // Live graviton4 landmarks as of 9.2 (total_commits 2278).
  const LANDMARKS = [
    { label: 'First benchmarkable', commit_index: 105 },
    { label: '7.2.4', commit_index: 163 },
    { label: '8.0', commit_index: 645 },
    { label: '8.1', commit_index: 1093 },
    { label: '9.0', commit_index: 1425 },
    { label: '9.1', commit_index: 1837 },
    { label: '9.2', commit_index: 2261 },
  ];

  describe('releaseLandmarks', () => {
    it('keeps only version-labelled landmarks, sorted ascending', () => {
      assert.deepEqual(axis.releaseLandmarks(LANDMARKS).map(l => l.label), ['7.2.4', '8.0', '8.1', '9.0', '9.1', '9.2']);
    });
    it('drops entries without a finite commit_index and de-duplicates by label', () => {
      const out = axis.releaseLandmarks([
        { label: '8.0', commit_index: 645 }, { label: '8.0', commit_index: 646 },
        { label: '9.0', commit_index: null }, null, { label: 7 },
      ]);
      assert.deepEqual(out, [{ label: '8.0', commit_index: 645 }]);
    });
    it('handles missing input', () => {
      assert.deepEqual(axis.releaseLandmarks(undefined), []);
    });
  });

  describe('releaseTicks', () => {
    it('full range: one tick per release, no numeric ticks, "First benchmarkable" skipped', () => {
      const r = axis.releaseTicks(LANDMARKS, 0, 2279);
      assert.equal(r.mode, 'releases');
      assert.deepEqual(r.ticks.map(t => t.label), ['7.2.4', '8.0', '8.1', '9.0', '9.1', '9.2']);
      assert.deepEqual(r.ticks.map(t => t.value), [163, 645, 1093, 1425, 1837, 2261]);
    });
    it('"Since Previous Release" (9.1..HEAD) still has two releases in view', () => {
      const r = axis.releaseTicks(LANDMARKS, 1837, 2279);
      assert.equal(r.mode, 'releases');
      assert.deepEqual(r.ticks.map(t => t.label), ['9.1', '9.2']);
    });
    it('"Since Last Release" (9.2..HEAD) falls back to commit-index ticks with 9.2 labelled', () => {
      const r = axis.releaseTicks(LANDMARKS, 2261, 2279);
      assert.equal(r.mode, 'index');
      const labels = r.ticks.map(t => t.label);
      assert.ok(labels.includes('9.2'), labels.join(','));
      assert.ok(labels.some(l => /^\d+$/.test(l)), 'needs numeric scale ticks');
      const values = r.ticks.map(t => t.value);
      assert.deepEqual([...values].sort((a, b) => a - b), values, 'ascending');
      assert.equal(new Set(values).size, values.length, 'no duplicate values');
      assert.ok(values.every(v => v >= 2261 && v <= 2279));
    });
    it('"Last 100 Commits" with no release in view: numeric ticks only', () => {
      const r = axis.releaseTicks(LANDMARKS, 1900, 2000);
      assert.equal(r.mode, 'index');
      assert.ok(r.ticks.length >= 3 && r.ticks.length <= 8, `got ${r.ticks.length}`);
      assert.ok(r.ticks.every(t => /^\d+$/.test(t.label)));
    });
    it('a numeric tick that would collide with a release label is dropped', () => {
      // Last 100 at HEAD 2279: step 20 gives 2260, one index from 9.2 @ 2261.
      const r = axis.releaseTicks(LANDMARKS, 2178, 2279);
      assert.deepEqual(r.ticks.map(t => t.label), ['2180', '2200', '2220', '2240', '9.2']);
    });
    it('a release exactly on the window edge is in view', () => {
      const r = axis.releaseTicks(LANDMARKS, 645, 1093);
      assert.deepEqual(r.ticks.map(t => t.label), ['8.0', '8.1']);
    });
    it('tolerates swapped bounds and empty landmarks', () => {
      assert.equal(axis.releaseTicks(LANDMARKS, 2279, 0).mode, 'releases');
      const r = axis.releaseTicks([], 0, 2279);
      assert.equal(r.mode, 'index');
      assert.ok(r.ticks.length > 0);
    });
  });

  describe('indexTicks / niceStep', () => {
    it('nice steps are 1/2/5 x 10^n and never below 1', () => {
      assert.equal(axis.niceStep(0.3), 1);
      assert.equal(axis.niceStep(3), 5);
      assert.equal(axis.niceStep(17), 20);
      assert.equal(axis.niceStep(380), 500);
      assert.equal(axis.niceStep(0), 1);
    });
    it('ticks land on multiples of the step inside the window', () => {
      assert.deepEqual(axis.indexTicks(2261, 2279, 6), [2265, 2270, 2275]);
      assert.deepEqual(axis.indexTicks(0, 2279, 6), [0, 500, 1000, 1500, 2000]);
      assert.deepEqual(axis.indexTicks(5, 5, 6), []);
    });
  });

  describe('formatRange', () => {
    it('rounds and uses an en dash', () => {
      assert.equal(axis.formatRange(1424.6, 2279), '1425\u20132279');
      assert.equal(axis.formatRange(undefined, 3), '');
    });
  });
});

describe('index.html release-marked axis wiring', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  it('loads the helper and every x axis goes through xAxisOpts', () => {
    assert.ok(html.includes('lib/axis-ticks.js'));
    assert.ok(html.includes('AxisTicks.releaseTicks('));
    // No chart builds its own linear x scale with maxTicksLimit any more.
    assert.ok(!/x: \{ type: 'linear'[^\n]*maxTicksLimit/.test(html), 'stray hand-built x scale');
    assert.ok((html.match(/xAxisOpts\(/g) || []).length >= 3, 'definition + baseChartOpts + perf charts');
  });
  it('landmark lines no longer carry top labels (ticks carry the release names)', () => {
    assert.ok(!/content: lm\.label/.test(html));
  });
  it('the visible commit window is shown next to the zoom buttons', () => {
    assert.ok(html.includes('id="visibleRange"'));
    assert.ok((html.match(/updateVisibleRange\(\)/g) || []).length >= 4, 'definition + hash update + initial render + hash restore');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// intro-helpers.js — sign-on intro overlay: prefs, iframe URL, sound decision, release
// ═══════════════════════════════════════════════════════════════════════════

const intro = require('../lib/intro-helpers.js');

function memStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    dump: () => Object.fromEntries(map),
  };
}

describe('intro prefs', () => {
  it('defaults: enabled, sound AUTO; nothing else to choose (one score, no CRT overlay)', () => {
    assert.deepEqual(intro.readPrefs(memStorage()), { enabled: true, sound: 'auto' });
    assert.equal(intro.DEFAULT_PREFS.sound, 'auto', 'auto = sound only where the browser already allows it; nobody gets nagged');
    assert.deepEqual(Object.keys(intro.DEFAULT_PREFS).sort(), ['enabled', 'sound']);
  });

  it('reads a stored preference back', () => {
    const s = memStorage({ [intro.STORAGE_KEY]: JSON.stringify({ enabled: false, sound: 'on' }) });
    assert.deepEqual(intro.readPrefs(s), { enabled: false, sound: 'on' });
  });

  it('migrates older stored shapes: boolean sound -> on/off; retired score/crt/tape keys dropped', () => {
    assert.deepEqual(intro.sanitizePrefs({ enabled: true, sound: true, score: 'sid', tape: true }), { enabled: true, sound: 'on' });
    assert.deepEqual(intro.sanitizePrefs({ sound: false }), { enabled: true, sound: 'off' });
    assert.deepEqual(intro.sanitizePrefs({ enabled: true, sound: 'on', score: 'orch', crt: true }), { enabled: true, sound: 'on' }, 'PR #24 second-cut prefs');
  });

  it('sanitizes garbage: unknown sound mode, non-boolean flags, junk JSON, throwing storage', () => {
    assert.deepEqual(intro.sanitizePrefs({ score: 'wagner', sound: 'loud', enabled: 0, crt: null }), intro.DEFAULT_PREFS);
    assert.deepEqual(intro.readPrefs(memStorage({ [intro.STORAGE_KEY]: '{not json' })), intro.DEFAULT_PREFS);
    assert.deepEqual(intro.readPrefs(memStorage({ [intro.STORAGE_KEY]: '"a string"' })), intro.DEFAULT_PREFS);
    assert.deepEqual(intro.readPrefs({ getItem() { throw new Error('denied'); } }), intro.DEFAULT_PREFS);
    assert.deepEqual(intro.readPrefs(null), intro.DEFAULT_PREFS);
  });

  it('writePrefs persists the sanitized object under one key and round-trips', () => {
    const s = memStorage();
    const written = intro.writePrefs(s, { sound: 'on', score: 'vhs', bogus: 1 });
    assert.deepEqual(written, { enabled: true, sound: 'on' });
    assert.deepEqual(Object.keys(s.dump()), [intro.STORAGE_KEY]);
    assert.deepEqual(intro.readPrefs(s), written);
    assert.ok(!s.dump()[intro.STORAGE_KEY].includes('score'), 'a retired key is not written back');
  });

  it('writePrefs never throws on a full or denied storage', () => {
    const out = intro.writePrefs({ setItem() { throw new Error('QuotaExceededError'); } }, { sound: 'on' });
    assert.equal(out.sound, 'on');
  });
});

describe('intro shouldPlay / introSrc / parseEmbedQuery', () => {
  it('plays when enabled and motion is not reduced', () => {
    assert.equal(intro.shouldPlay(intro.DEFAULT_PREFS, false), true);
    assert.equal(intro.shouldPlay(intro.DEFAULT_PREFS, true), false, 'prefers-reduced-motion must suppress the intro');
    assert.equal(intro.shouldPlay({ ...intro.DEFAULT_PREFS, enabled: false }, false), false);
    assert.equal(intro.shouldPlay(null, false), false);
  });

  it('introSrc carries the sound mode and nothing else', () => {
    assert.equal(intro.introSrc(intro.DEFAULT_PREFS), 'intro.html?embed=1&sound=auto');
    assert.equal(intro.introSrc({ sound: 'on', score: 'vhs', crt: true }), 'intro.html?embed=1&sound=on', 'retired keys do not reach the URL');
    assert.equal(intro.introSrc({ sound: 'off' }), 'intro.html?embed=1&sound=off');
    assert.equal(intro.introSrc({ sound: true }), 'intro.html?embed=1&sound=on', 'legacy boolean');
  });

  it('parseEmbedQuery is the inverse of introSrc, and an undecided URL stays silent', () => {
    for (const prefs of [{ sound: 'auto' }, { sound: 'on' }, { sound: 'off' }]) {
      const url = intro.introSrc(prefs);
      const q = intro.parseEmbedQuery(url.slice(url.indexOf('?')));
      assert.deepEqual(q, { embed: true, sound: prefs.sound });
    }
    assert.deepEqual(intro.parseEmbedQuery('?embed=1&score=evil&sound=loud&crt=1'), { embed: true, sound: 'off' });
    assert.deepEqual(intro.parseEmbedQuery(''), { embed: false, sound: 'off' });
  });
});

describe('intro soundDecision', () => {
  it('auto: sound only when the browser allows autoplay; otherwise silent and no button', () => {
    assert.deepEqual(intro.soundDecision('auto', true), { start: true, offer: false });
    assert.deepEqual(intro.soundDecision('auto', false), { start: false, offer: false });
  });
  it('on: sound when allowed; otherwise offer the SOUND (restart) button', () => {
    assert.deepEqual(intro.soundDecision('on', true), { start: true, offer: false });
    assert.deepEqual(intro.soundDecision('on', false), { start: false, offer: true });
  });
  it('off: never, whatever the browser says', () => {
    assert.deepEqual(intro.soundDecision('off', true), { start: false, offer: false });
    assert.deepEqual(intro.soundDecision('off', false), { start: false, offer: false });
    assert.equal(intro.wantsAudio('off'), false);
    assert.equal(intro.wantsAudio('auto'), true);
    assert.equal(intro.wantsAudio('on'), true);
  });
  it('legacy booleans and garbage map through soundMode', () => {
    assert.equal(intro.soundMode(true), 'on');
    assert.equal(intro.soundMode(false), 'off');
    assert.equal(intro.soundMode('whatever'), 'auto');
    assert.deepEqual(intro.soundDecision(undefined, false), { start: false, offer: false }, 'undefined = auto = silent when refused');
  });
  it('autoplayStatus explains the verdict in one line, per mode', () => {
    assert.equal(intro.autoplayStatus(null), '', 'nothing to say before the intro has answered');
    assert.match(intro.autoplayStatus({ allowed: true, mode: 'auto' }), /allowed sound without a click/);
    assert.match(intro.autoplayStatus({ allowed: false, mode: 'on' }), /refused.*SOUND button/);
    assert.match(intro.autoplayStatus({ allowed: false, mode: 'auto' }), /refused.*ran silent/);
    assert.match(intro.autoplayStatus({ allowed: false, mode: 'off' }), /sound off/);
  });
});

describe('intro shouldRelease', () => {
  const st = (o) => ({ chartsReady: false, introDone: false, skipped: false, released: false, ...o });
  it('holds until BOTH charts ready and intro done', () => {
    assert.equal(intro.shouldRelease(st()), false);
    assert.equal(intro.shouldRelease(st({ chartsReady: true })), false, 'fast charts must wait for the intro');
    assert.equal(intro.shouldRelease(st({ introDone: true })), false, 'a finished intro must wait for slow charts');
    assert.equal(intro.shouldRelease(st({ chartsReady: true, introDone: true })), true);
  });
  it('skip releases immediately, once', () => {
    assert.equal(intro.shouldRelease(st({ skipped: true })), true);
    assert.equal(intro.shouldRelease(st({ skipped: true, released: true })), false);
    assert.equal(intro.shouldRelease(st({ chartsReady: true, introDone: true, released: true })), false);
    assert.equal(intro.shouldRelease(null), false);
  });
});

describe('intro starField (night sky)', () => {
  const sky = intro.SKY;
  it('is deterministic for a seed and sized by count', () => {
    const a = intro.starField({count: 400}), b = intro.starField({count: 400});
    assert.deepEqual(a.stars, b.stars);
    assert.ok(a.stars.length >= 400 && a.stars.length <= 400 * 1.3 + 1, `${a.stars.length} stars for count 400 (+outer)`);
    assert.notDeepEqual(intro.starField({count: 400, seed: 7}).stars, a.stars);
    assert.ok(intro.starField({count: 3000}).stars.length > intro.starField({count: 1000}).stars.length);
  });
  it('places nothing over the sun, below the horizon or outside the scenery box', () => {
    const f = intro.starField({count: 3000});
    for (const s of f.stars) {
      assert.ok(Math.hypot(s.x - sky.sun.x, s.y - sky.sun.y) >= sky.sun.r, `star on the sun at ${s.x},${s.y}`);
      assert.ok(s.y < sky.horizon, `star below the horizon at ${s.y}`);
      assert.ok(s.x >= sky.box.x0 && s.x <= sky.box.x1 && s.y >= sky.box.y0, 'inside the scenery box');
    }
  });
  it('visibility: zero on the disc, washed out near the glow, growing with distance and height', () => {
    assert.equal(intro.starVisibility(450, 110), 0);
    assert.equal(intro.starVisibility(450, 196), 0);
    assert.equal(intro.starVisibility(0, 300), 0, 'below the horizon');
    const nearGlow = intro.starVisibility(650, 60), farUp = intro.starVisibility(650, -500), corner = intro.starVisibility(0, 0);
    assert.ok(nearGlow < corner && corner < farUp, `near ${nearGlow} < corner ${corner} < far-up ${farUp}`);
    assert.ok(intro.starVisibility(-400, 190) < intro.starVisibility(-400, -100), 'thinner just above the horizon');
    assert.ok(intro.starVisibility(-400, -600) > 0.95, 'full high in the dark sky');
  });
  it('density and brightness grow away from the sunset', () => {
    const f = intro.starField({count: 6000});
    const inBox = (x0, x1, y0, y1) => f.stars.filter(s => s.x >= x0 && s.x < x1 && s.y >= y0 && s.y < y1);
    // same x span: right beside the sun (glow rho ~0.36) vs high in the dark sky
    const twilight = inBox(600, 760, 60, 160), dark = inBox(600, 760, -700, -600);
    assert.ok(dark.length > 3 * twilight.length, `dark ${dark.length} vs twilight ${twilight.length}`);
    const mean = l => l.reduce((n, s) => n + s.a, 0) / Math.max(1, l.length);
    assert.ok(mean(dark) > mean(twilight), 'brighter where the sky is dark');
  });
  it('brightness ladder: most stars faint, few brilliant; size scales radii', () => {
    const f = intro.starField({count: 6000});
    const faint = f.stars.filter(s => s.r <= 0.4).length, bright = f.stars.filter(s => s.r >= 0.9).length;
    assert.ok(faint > 0.7 * f.stars.length, `faint share ${faint / f.stars.length}`);
    assert.ok(bright < 0.05 * f.stars.length && bright > 0, `bright share ${bright / f.stars.length}`);
    const big = intro.starField({count: 500, size: 2});
    assert.ok(Math.max(...big.stars.map(s => s.r)) >= 2.4);
    for (const s of f.stars) { assert.ok(s.a >= 0.1 && s.a <= 1); assert.ok(['#fff6ea', '#dfe9ff', '#ffd9a8'].includes(s.fill)); }
  });
  it('groups the field into a few dozen dot paths', () => {
    const f = intro.starField({count: 6000});
    assert.ok(f.groups.length >= 20 && f.groups.length <= 80, `${f.groups.length} groups`);
    const dots = f.groups.reduce((n, g) => n + (g.d.match(/M-?[\d.]+ -?[\d.]+h\.01/g) || []).length, 0);
    assert.equal(dots, f.stars.length, 'every star is one dot');
    for (const g of f.groups) assert.ok(g.fill && g.r > 0 && g.a > 0 && /^(M-?[\d.]+ -?[\d.]+h\.01)+$/.test(g.d));
  });
  it('wash override reaches further into the twilight; bad options fall back to defaults', () => {
    const tight = intro.starField({count: 6000, wash: {from: 0.2, to: 0.6}}), wide = intro.starField({count: 6000, wash: {from: 0.5, to: 1.0}});
    const twilight = f => f.stars.filter(s => s.x >= 100 && s.x < 800 && s.y >= -120 && s.y < 40).length;
    assert.ok(twilight(tight) > twilight(wide));
    assert.equal(intro.starField({count: NaN, size: -1}).stars.length, intro.starField().stars.length);
    assert.equal(intro.starField({count: 0}).stars.length, 0);
  });
});

describe('intro releasePlan', () => {
  const st = (o) => ({ skipped: false, audioOn: false, audioStartedAt: null, now: 0, ...o });
  it('CRT power-off normally, hard cut under reduced motion', () => {
    assert.equal(intro.releasePlan(st(), false).transition, 'crt');
    assert.equal(intro.releasePlan(st(), true).transition, 'cut');
  });
  it('silent run: nothing to keep, frame goes with the picture', () => {
    assert.deepEqual(intro.releasePlan(st(), false), { transition: 'crt', keepAudio: false, tailMs: 0 });
  });
  it('a playing score finishes under the dashboard: tail = score end minus elapsed, capped', () => {
    const p = intro.releasePlan(st({ audioOn: true, audioStartedAt: 1000, now: 6800 }), false);
    assert.equal(p.keepAudio, true);
    assert.equal(p.tailMs, intro.AUDIO_TAIL_S * 1000 - 5800);
    assert.equal(intro.releasePlan(st({ audioOn: true, audioStartedAt: 0, now: 0 }), false).tailMs, intro.AUDIO_TAIL_S * 1000);
    assert.equal(intro.releasePlan(st({ audioOn: true, audioStartedAt: 0, now: 20000 }), false).tailMs, 0, 'already past the tail');
    assert.ok(intro.releasePlan(st({ audioOn: true }), false).tailMs <= intro.AUDIO_TAIL_CAP_MS);
  });
  it('skip cuts the audio with the picture (the user said enough)', () => {
    const p = intro.releasePlan(st({ audioOn: true, skipped: true, audioStartedAt: 0, now: 2000 }), false);
    assert.deepEqual(p, { transition: 'crt', keepAudio: false, tailMs: 0 });
  });
  it('the score stays audible past Chrome\'s 7 s media-engagement threshold', () => {
    assert.ok(intro.AUDIO_TAIL_S > 7, `tail ${intro.AUDIO_TAIL_S}s`);
  });
  it('the tail ends in a fade that reaches silence before the context is closed', () => {
    const p = intro.audioFadePlan(2.5);
    assert.equal(p.closeAt, 2.5 + intro.AUDIO_TAIL_S);
    assert.ok(p.fadeStart < p.silentAt && p.silentAt < p.closeAt, 'fadeStart < silentAt < closeAt');
    assert.ok(Math.abs((p.silentAt - p.fadeStart) - intro.AUDIO_FADE_S) < 1e-9, 'the ramp is the fade length');
    assert.ok(Math.abs((p.closeAt - p.silentAt) - intro.AUDIO_SILENT_LEAD_S) < 1e-9, 'silence leads the close');
    assert.ok(intro.AUDIO_FADE_S >= 1.5, 'gentle: at least 1.5 s');
    assert.ok(p.silentAt - 2.5 > 7.5, 'still audible well past the 7 s engagement mark');
    assert.ok(intro.AUDIO_TAIL_S * 1000 <= intro.AUDIO_TAIL_CAP_MS, 'the parent cap must not cut the fade');
  });
});

describe('intro overlay wiring (index.html + intro.html)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const introHtml = fs.readFileSync(path.join(root, 'intro.html'), 'utf8');

  it('index.html loads the helper, mounts the overlay before the header, and gates release on init()', () => {
    assert.ok(index.includes('lib/intro-helpers.js'));
    assert.ok(index.indexOf('id="introOverlay"') < index.indexOf('<header>'), 'overlay must precede the header so it paints first');
    assert.ok(index.includes('IntroHelpers.shouldPlay(prefs, reducedMotion)'));
    assert.ok(index.includes('prefers-reduced-motion: reduce'), 'must honour reduced motion');
    assert.ok(index.includes('IntroHelpers.shouldRelease(state)'));
    assert.ok(index.includes('IntroHelpers.releasePlan(state, reducedMotion)'));
    assert.ok(/init\(\)\.catch\(.*\)\.finally\(\(\) => Intro\.chartsReady\(\)\)/.test(index), 'chartsReady must fire even when init fails');
    assert.ok(index.includes('READY_TIMEOUT_MS'), 'a missing intro.html must not hold the dashboard');
    assert.ok(index.includes(`setAttribute('allow', 'autoplay')`), 'the frame needs the autoplay right delegated');
  });

  it('index.html has the CRT power-off transition and the hard-cut class', () => {
    for (const k of ['intro-collapse-y', 'intro-collapse-x', 'intro-lift', '#introOverlay.closing', '#introOverlay.cut', '#introOverlay.tail']) {
      assert.ok(index.includes(k), `missing ${k}`);
    }
  });

  it('index.html popover: play-on-load, sound mode, verdict line; no score or CRT controls', () => {
    for (const id of ['introSettingsBtn', 'introSettings', 'introEnabled', 'introSound', 'introSoundNote', 'introAutoplayStatus']) {
      assert.ok(index.includes(`id="${id}"`), `missing #${id}`);
    }
    for (const id of ['introScore', 'introCrt', 'introScoreRow', 'introCrtRow']) assert.ok(!index.includes(id), `${id} should be gone`);
    for (const mode of intro.SOUND_MODES) assert.ok(index.includes(`<option value="${mode}">`), `sound select lacks ${mode}`);
    assert.ok(index.includes('Intro.setPrefs('), 'popover must persist through Intro.setPrefs');
    assert.ok(index.includes('Intro.replay()'));
    assert.ok(index.includes("m.event === 'autoplay'"), 'the browser verdict must be recorded');
    assert.ok(index.includes('IntroHelpers.autoplayStatus(Intro.lastAutoplay())'), 'and shown in the popover');
  });

  it('intro.html is the Conductress sign-on and speaks the postMessage protocol the overlay expects', () => {
    assert.ok(introHtml.includes('CONDUCTRESS — sign-on'));
    assert.ok(introHtml.includes("q.get('embed') === '1'"));
    assert.ok(introHtml.includes('lib/intro-helpers.js'), 'embed mode shares the pure rules with the parent');
    assert.ok(introHtml.includes("'conductress-intro'"), 'message type must match index.html');
    assert.ok(index.includes("'conductress-intro'"));
    for (const ev of ["{event: 'ready'}", "{event: 'autoplay', allowed, mode: opts.sound}", "{event: 'audio'}", "{event: 'done'}", "{event: 'skip'}", "{event: 'restart'}", "{event: 'audio-ended'}"]) assert.ok(introHtml.includes(ev), `intro must post ${ev}`);
    assert.ok(introHtml.includes("m.cmd === 'release'"), 'intro must honour the parent release');
    assert.ok(introHtml.includes('getAutoplayPolicy'), 'must ask the browser first where it can');
    assert.ok(introHtml.includes('embedDone: 5.8'), 'done mark must be a named timeline constant at the end of the hold');
    assert.ok(introHtml.includes('id="soundhint"'), 'sound=on needs a gesture fallback; the intro must offer a button');
    assert.ok(!/\bmaster\b/i.test(introHtml), 'inclusive-language check');
  });

  it('intro.html carries one score and no CRT overlay', () => {
    assert.ok(introHtml.includes('function scoreCosmos'));
    for (const gone of ['scoreVHS', 'scoreChip', 'scoreOrch', 'name="score"', 'id="crt"', 'id="scan"', 'id="vignette"', '.crt ', "q.get('crt')", 'function brass', 'function chip(']) {
      assert.ok(!introHtml.includes(gone), `${gone} should be gone`);
    }

  it('intro.html ends the audio tail with an output-bus fade placed after the reverb, and closes only once silent', () => {
    assert.ok(introHtml.includes('comp.connect(outBus); outBus.connect(ctx.destination)'), 'outBus gain must sit after the compressor/convolver sum');
    assert.ok(introHtml.includes('function fadeOut('), 'one fade routine for the tail and for skips');
    assert.ok(/fadeOut\(plan\.fadeStart, plan\.silentAt\)/.test(introHtml), 'the scheduled tail fade follows the helper plan');
    assert.ok(/const endAt = plan\.closeAt/.test(introHtml), 'the context closes at the plan\'s closeAt, after silence');
    assert.ok(introHtml.includes('H.audioFadePlan(t0)'), 'plan comes from the shared helper');
    assert.ok(/fadeOut\(now, now \+ Math\.max\(\.05, ms \/ 1000\)\)/.test(introHtml), 'a skip fades the output bus, not the pre-reverb bus');
    assert.ok(!/mainOut\.gain\.(cancelScheduledValues|linearRampToValueAtTime)/.test(introHtml), 'no fade may ride mainOut: the reverb would ring on after it');
  });
  });

  it('intro.html draws full-bleed: viewBox unchanged, overflow visible, scenery outside the box, mask hex arrives with the C', () => {
    assert.ok(introHtml.includes('viewBox="0 0 900 340"'), 'every transform-origin depends on the core box');
    assert.ok(/svg#art\{[^}]*overflow:visible/.test(introHtml), 'the root svg must paint outside its box');
    assert.ok(/svg#art\{[^}]*width:min\(100vw,177\.7vh\)/.test(introHtml), 'core sized to the viewport width, height-capped');
    assert.ok(introHtml.includes('<rect x="-2700" y="-1400" width="6300" height="3200" fill="url(#sky)"/>'), 'sky covers the scenery box');
    assert.ok(introHtml.includes('<rect id="ground" x="-2700" y="196" width="6300" height="1604"'), 'ground covers the scenery box');
    assert.ok(/<radialGradient id="sky" gradientUnits="userSpaceOnUse"/.test(introHtml), 'sky gradient pinned so the bigger rect does not stretch it');
    assert.ok(!/<circle cx="-?\d+" cy="-?\d+" r="[\d.]+" opacity="[\d.]+"\/>/.test(introHtml), 'no stored star circles: the field is generated');
    assert.ok(/<g id="stars" class="anim" stroke-linecap="round"><\/g>/.test(introHtml), 'empty star group for starField to fill');
    assert.ok(introHtml.indexOf('<g id="stars"') < introHtml.indexOf('<circle id="glow"'), 'the sun is drawn in front of the stars');
    assert.ok(introHtml.includes('H.starField(opts)'), 'intro.html fills the sky from the shared generator');
    assert.ok(/<linearGradient id="ruleg" gradientUnits="userSpaceOnUse" x1="60" y1="0" x2="840" y2="0">/.test(introHtml), 'rule gradient pinned in user space, opaque to both ends');
    assert.ok(!/stop-color="#6d3bd8" stop-opacity="0"\/><stop offset="25%"/.test(introHtml), 'rule no longer fades out at its ends');
    for (const id of ['hrule', 'hotrule']) {
      assert.ok(new RegExp(`<g id="${id}"[^>]*>\\s*<line class="anim" x1="450" y1="196" x2="-2700" y2="196"\\/><line class="anim" x1="450" y1="196" x2="3600" y2="196"\\/>`).test(introHtml), `${id} runs from the vanishing point to both scenery edges`);
    }
    assert.ok(/#hrule line\{stroke-dasharray:3200;stroke-dashoffset:3200;animation-name:draw;animation-duration:3\.2s/.test(introHtml), 'rule halves draw with a dash covering their 3150 units');
    assert.ok(/#hotrule line\{[^}]*animation-name:draw,coolhot/.test(introHtml), 'hot rule cools on the rays\' clock');
    assert.ok(!introHtml.includes('@keyframes drawhot'), 'drawhot keyframes retired');
    assert.ok(/<filter id="hotglow" filterUnits="userSpaceOnUse" x="-700" y="120" width="2400" height="900">/.test(introHtml), 'hot-grid filter region pinned (bbox-relative region left a black tile near the origin)');
    assert.ok((introHtml.match(/<path d="M-2700 196 /g) || []).length === 1 && /<path d="M900 196 /.test(introHtml), 'far mountain ranges both sides');
    assert.ok(introHtml.includes('stroke-dasharray:3600'), 'grid rays extended; dash covers the longest ray');
    assert.ok(/#hot line\{[^}]*animation-name:draw,coolhot/.test(introHtml), 'hot grid cools on its own 2.2 s clock');
    assert.ok(/#lead,#leadmask\{animation-name:snap/.test(introHtml), 'the mask hex snaps in with the C (no sky-coloured hole on frame one)');
    assert.ok(/<g id="leadmask" class="anim" clip-path="url\(#leadclip\)">\s*<rect[^>]*fill="url\(#sky\)"\/>\s*<circle class="anim" cx="450" cy="110" r="150" fill="#ff7a3d"\/>/.test(introHtml), 'mask = sky + glow clipped to the hex');
    assert.ok(!/<g clip-path="url\(#leadclip\)"><rect width="900" height="340"/.test(introHtml), 'the always-on mask is gone');
  });

  it('intro.html text lands in one go and holds: whole-word slam, no typing, cursor rests', () => {
    assert.ok(/#word \.w\{[^}]*animation-name:slam[^}]*animation-delay:2\.70s/.test(introHtml), 'one slam on the word group');
    assert.ok(!/#word \.g:nth-child/.test(introHtml), 'no per-letter stagger');
    assert.equal((introHtml.match(/<g class="w anim"/g) || []).length, 1);
    assert.ok(!introHtml.includes('typein') && !introHtml.includes('typecur'), 'no typing keyframes');
    assert.ok(/#sub\s*\{animation-name:fadein/.test(introHtml), 'subtitle appears whole');
    assert.ok(/<rect id="cursor" class="anim" x="600"/.test(introHtml), 'cursor parked after the last letter');
    const wordAt = 2.70, subAt = parseFloat(introHtml.match(/#sub\s*\{[^}]*animation-delay:([\d.]+)s/)[1]);
    assert.ok(subAt >= wordAt + 0.3 && subAt <= wordAt + 0.5, `subtitle lands as the slam settles (${subAt})`);
    assert.ok(5.8 - subAt >= 2.5, 'at least 2.5 s of full text on screen before the done mark');
  });

  it('intro.html is a valid standalone page and its script parses', () => {
    assert.ok(introHtml.includes('lang="en"'));
    const scripts = [...introHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length >= 1);
    for (const s of scripts) assert.doesNotThrow(() => new Function(s));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// metric-selector.js — Performance Counters metric selection model
// Fixture mirrors the live platform manifests (identical across intel/arm64/
// amd64): process-wide base groups plus per-thread -main/-io variants.
// ═══════════════════════════════════════════════════════════════════════════

describe('metric-selector', () => {
  const MS = require('../lib/metric-selector.js');
  const scopeBadgeLib = require('../lib/scope-badge.js');
  const G = (id, title, series, axes) => ({ id, title, series, y_axes: axes });
  const groups = [
    G('throughput', 'Throughput', ['throughput'], [{ id: 'left', label: 'requests/sec', series: ['throughput'] }]),
    G('efficiency', 'Execution Efficiency', ['ipc', 'instructions-per-req', 'cycles-per-req'], []),
    G('cpu-main', 'CPU Profile — Main Thread', ['cpu-main'], [{ id: 'left', label: '% of samples', series: ['cpu-main'] }]),
    G('cpu-io', 'CPU Profile — IO Threads', ['cpu-io'], [{ id: 'left', label: '% of samples', series: ['cpu-io'] }]),
    G('efficiency-main', 'Execution Efficiency — Main Thread', ['ipc-main', 'instructions-per-req-main', 'cycles-per-req-main'],
      [{ id: 'left', label: 'IPC', series: ['ipc-main'] }, { id: 'right', label: 'per request', series: ['instructions-per-req-main', 'cycles-per-req-main'] }]),
    G('efficiency-io', 'Execution Efficiency — IO Threads', ['ipc-io', 'instructions-per-req-io', 'cycles-per-req-io'], []),
    G('cache-main', 'Cache Pressure — Main Thread', ['icache-mpki-main', 'llc-mpki-main'], [{ id: 'left', label: 'misses per 1K instructions', series: ['icache-mpki-main', 'llc-mpki-main'] }]),
    G('tma-main', 'Pipeline Breakdown (TMA) — Main Thread', ['tma-retiring-pct-main', 'tma-fe-bound-pct-main'], [{ id: 'left', label: '% of pipeline slots', series: ['tma-retiring-pct-main', 'tma-fe-bound-pct-main'] }]),
    G('branching-main', 'Branch Prediction — Main Thread', ['branch-mpki-main'], [{ id: 'left', label: 'mispredictions per 1K instructions', series: ['branch-mpki-main'] }]),
    G('kernel-main', 'Kernel Interaction — Main Thread', ['syscalls-per-req-main', 'context-switches-per-sec-main'],
      [{ id: 'left', label: 'syscalls/request', series: ['syscalls-per-req-main'] }, { id: 'right', label: 'context switches/s', series: ['context-switches-per-sec-main'] }]),
    G('mystery-main', 'Mystery — Main Thread', ['widgets-per-req-main'], [{ id: 'left', label: 'widgets', series: ['widgets-per-req-main'] }]),
  ];
  const catalog = MS.buildCatalog(groups);
  const ids = catalog.map(e => e.id);

  describe('buildCatalog', () => {
    it('hides process-wide base groups and follows PerfGroups display order', () => {
      assert.ok(!ids.includes('ipc'), 'base efficiency group hidden');
      assert.ok(!ids.includes('throughput'));
      assert.equal(ids[0], 'ipc-main', 'efficiency-main leads');
      assert.ok(ids.indexOf('cpu-main') > ids.indexOf('cycles-per-req-main'));
      assert.ok(ids.indexOf('cache-main') < 0 && ids.indexOf('icache-mpki-main') > ids.indexOf('cpu-io'));
      assert.equal(ids.at(-1), 'widgets-per-req-main', 'unknown group sorts last, not dropped');
    });

    it('one line entry per series, with thread, human label and a specific axis label', () => {
      const e = catalog.find(x => x.id === 'instructions-per-req-main');
      assert.equal(e.kind, 'line');
      assert.equal(e.thread, 'main');
      assert.equal(e.label, 'Instructions / request');
      assert.equal(e.title, 'Instructions / request — Main thread');
      assert.equal(e.group, 'efficiency-main');
      assert.equal(e.axisLabel, 'instructions per request', 'not the manifest\'s shared "per request"');
      assert.equal(catalog.find(x => x.id === 'ipc-io').title, 'IPC — IO threads');
    });

    it('falls back to the manifest axis label and a humanized id for unknown metrics', () => {
      const e = catalog.find(x => x.id === 'widgets-per-req-main');
      assert.equal(e.label, 'widgets / req');
      assert.equal(e.axisLabel, 'widgets');
    });

    it('CPU-profile and TMA groups become single panel entries keyed by group id', () => {
      const cpu = catalog.find(x => x.id === 'cpu-main');
      assert.equal(cpu.kind, 'cpu'); assert.equal(cpu.title, 'CPU Profile — Main Thread'); assert.equal(cpu.axisLabel, '% of samples');
      const tma = catalog.find(x => x.id === 'tma-main');
      assert.equal(tma.kind, 'tma');
      assert.ok(!ids.includes('tma-retiring-pct-main'), 'TMA components are not individually selectable');
    });

    it('tolerates a missing or malformed manifest', () => {
      assert.deepEqual(MS.buildCatalog(undefined), []);
      assert.deepEqual(MS.buildCatalog([{ id: 'efficiency-main' }]), []);
    });

    it('groupedCatalog keeps catalog order and group membership', () => {
      const g = MS.groupedCatalog(catalog);
      assert.deepEqual(g.map(x => x.group), ['efficiency-main', 'efficiency-io', 'cpu-main', 'cpu-io', 'cache-main', 'tma-main', 'branching-main', 'kernel-main', 'mystery-main']);
      assert.equal(g[0].entries.length, 3);
      assert.equal(g[0].groupTitle, 'Execution Efficiency — Main Thread');
    });
  });

  describe('selection operations (pure, order-preserving)', () => {
    const sel = ['ipc-main', 'cpu-main', 'llc-mpki-main'];

    it('sanitize drops unknown ids and duplicates but keeps order', () => {
      assert.deepEqual(MS.sanitize(['llc-mpki-main', 'nope', 'ipc-main', 'llc-mpki-main', 'ipc'], catalog), ['llc-mpki-main', 'ipc-main']);
      assert.deepEqual(MS.sanitize(null, catalog), []);
    });

    it('add appends once; remove filters; toggle flips; inputs are not mutated', () => {
      const added = MS.addMetric(sel, 'ipc-io');
      assert.deepEqual(added, [...sel, 'ipc-io']);
      assert.deepEqual(MS.addMetric(sel, 'ipc-main'), sel);
      assert.deepEqual(MS.removeMetric(sel, 'cpu-main'), ['ipc-main', 'llc-mpki-main']);
      assert.deepEqual(MS.toggleMetric(sel, 'cpu-main'), ['ipc-main', 'llc-mpki-main']);
      assert.deepEqual(MS.toggleMetric(sel, 'ipc-io'), [...sel, 'ipc-io']);
      assert.deepEqual(sel, ['ipc-main', 'cpu-main', 'llc-mpki-main']);
    });

    it('move shifts by delta and clamps at the ends', () => {
      assert.deepEqual(MS.moveMetric(sel, 'llc-mpki-main', -1), ['ipc-main', 'llc-mpki-main', 'cpu-main']);
      assert.deepEqual(MS.moveMetric(sel, 'ipc-main', -1), sel, 'already first');
      assert.deepEqual(MS.moveMetric(sel, 'ipc-main', 5), ['cpu-main', 'llc-mpki-main', 'ipc-main'], 'clamped to last');
      assert.deepEqual(MS.moveMetric(sel, 'missing', 1), sel);
    });

    it('addGroup appends the unselected members of a group in catalog order', () => {
      assert.deepEqual(MS.addGroup(['cycles-per-req-main'], catalog, 'efficiency-main'),
        ['cycles-per-req-main', 'ipc-main', 'instructions-per-req-main']);
      assert.deepEqual(MS.addGroup(sel, catalog, 'nope'), sel);
    });

    it('sameSelection is order-sensitive', () => {
      assert.ok(MS.sameSelection(['a', 'b'], ['a', 'b']));
      assert.ok(!MS.sameSelection(['a', 'b'], ['b', 'a']));
      assert.ok(!MS.sameSelection(['a'], ['a', 'b']));
      assert.ok(!MS.sameSelection(null, []));
    });
  });

  describe('presets', () => {
    const builtins = MS.builtinPresets(catalog);
    const byName = Object.fromEntries(builtins.map(p => [p.name, p]));

    it('Default is the layout-noise quartet, Efficiency is the old IPC trio, All is the whole catalog', () => {
      assert.deepEqual(byName.Default.metrics, MS.DEFAULT_METRICS);
      assert.deepEqual(MS.DEFAULT_METRICS, ['instructions-per-req-main', 'cycles-per-req-main', 'icache-mpki-main', 'branch-mpki-main']);
      assert.deepEqual(byName.Efficiency.metrics, ['ipc-main', 'instructions-per-req-main', 'cycles-per-req-main']);
      assert.deepEqual(byName.All.metrics, ids);
      assert.ok(builtins.every(p => p.builtin === true));
    });

    it('thread presets hold only line metrics of that thread; Profiles holds the stacked panels', () => {
      assert.deepEqual(byName['Main thread'].metrics, ['ipc-main', 'instructions-per-req-main', 'cycles-per-req-main', 'icache-mpki-main', 'llc-mpki-main', 'branch-mpki-main', 'syscalls-per-req-main', 'context-switches-per-sec-main', 'widgets-per-req-main']);
      assert.deepEqual(byName['IO threads'].metrics, ['ipc-io', 'instructions-per-req-io', 'cycles-per-req-io']);
      assert.deepEqual(byName.Profiles.metrics, ['cpu-main', 'cpu-io', 'tma-main']);
      assert.deepEqual(byName.Cache.metrics, ['icache-mpki-main', 'llc-mpki-main', 'branch-mpki-main']);
      assert.deepEqual(byName.Kernel.metrics, ['syscalls-per-req-main', 'context-switches-per-sec-main']);
    });

    it('presets with no members on this manifest are omitted; Default shrinks to what the manifest has', () => {
      const small = MS.builtinPresets(MS.buildCatalog(groups.filter(g => g.id === 'efficiency-main')));
      assert.deepEqual(small.map(p => p.name), ['Default', 'Efficiency', 'Main thread', 'All']);
      assert.deepEqual(small[0].metrics, ['instructions-per-req-main', 'cycles-per-req-main']);
    });

    it('savePreset adds, replaces by name case-insensitively, trims, and refuses empties', () => {
      let list = MS.savePreset([], '  Work  ', ['ipc-main']);
      assert.deepEqual(list, [{ name: 'Work', metrics: ['ipc-main'] }]);
      list = MS.savePreset(list, 'work', ['cpu-main']);
      assert.deepEqual(list, [{ name: 'work', metrics: ['cpu-main'] }], 'replaced in place; the re-save\'s spelling wins');
      assert.deepEqual(MS.savePreset(list, '', ['x']), list);
      assert.deepEqual(MS.savePreset(list, 'Empty', []), list);
      assert.equal(MS.savePreset(list, 'x'.repeat(80), ['a'])[1].name.length, 40, 'name capped');
    });

    it('deletePreset and matchingPreset', () => {
      const list = [{ name: 'A', metrics: ['ipc-main'] }, { name: 'B', metrics: ['ipc-main', 'ipc-io'] }];
      assert.deepEqual(MS.deletePreset(list, 'a'), [list[1]]);
      assert.equal(MS.matchingPreset(['ipc-main', 'ipc-io'], [...builtins, ...list]), 'B');
      assert.equal(MS.matchingPreset(['ipc-io', 'ipc-main'], list), null, 'order matters');
      assert.equal(MS.matchingPreset(MS.DEFAULT_METRICS, builtins), 'Default');
    });

    it('summaryLabel names the section and a matching preset, else counts', () => {
      assert.equal(MS.summaryLabel(MS.DEFAULT_METRICS, builtins), 'Perf metrics: Default');
      assert.equal(MS.summaryLabel(['ipc-main'], builtins), '1 perf metric');
      assert.equal(MS.summaryLabel(['ipc-main', 'cpu-io'], builtins), '2 perf metrics');
      assert.equal(MS.summaryLabel([], builtins), '0 perf metrics');
    });
  });

  describe('persistence', () => {
    const fakeStore = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; };

    it('selection round-trips through storage; malformed or missing storage reads as null', () => {
      const st = fakeStore();
      assert.ok(MS.writeSelection(st, ['ipc-main', 'cpu-io']));
      assert.deepEqual(MS.readSelection(st), ['ipc-main', 'cpu-io']);
      assert.equal(MS.readSelection(fakeStore()), null);
      assert.equal(MS.readSelection(fakeStore({ [MS.STORAGE_SELECTION]: '{not json' })), null);
      assert.equal(MS.readSelection(fakeStore({ [MS.STORAGE_SELECTION]: '"ipc-main"' })), null);
      assert.deepEqual(MS.readSelection(fakeStore({ [MS.STORAGE_SELECTION]: '["a", 3, null]' })), ['a']);
      assert.equal(MS.readSelection(null), null);
      assert.equal(MS.writeSelection(null, ['a']), false);
    });

    it('a throwing store (private mode quota) is swallowed', () => {
      const bad = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
      assert.equal(MS.readSelection(bad), null);
      assert.equal(MS.writeSelection(bad, ['a']), false);
      assert.deepEqual(MS.readPresets(bad), []);
    });

    it('presets round-trip and malformed entries are dropped', () => {
      const st = fakeStore();
      MS.writePresets(st, [{ name: 'Work', metrics: ['ipc-main'] }]);
      assert.deepEqual(MS.readPresets(st), [{ name: 'Work', metrics: ['ipc-main'] }]);
      const dirty = fakeStore({ [MS.STORAGE_PRESETS]: JSON.stringify([{ name: 'ok', metrics: ['a', 1] }, { name: 7, metrics: ['a'] }, { name: 'nometrics' }, { name: '', metrics: ['a'] }, null]) });
      assert.deepEqual(MS.readPresets(dirty), [{ name: 'ok', metrics: ['a'] }]);
    });

    it('hash encode/decode', () => {
      assert.equal(MS.encodeMetrics(['ipc-main', 'cpu-io']), 'ipc-main,cpu-io');
      assert.deepEqual(MS.decodeMetrics('ipc-main, cpu-io,,'), ['ipc-main', 'cpu-io']);
      assert.deepEqual(MS.decodeMetrics(null), []);
    });

    it('hashValue is null for the default selection so plain URLs stay short', () => {
      assert.equal(MS.hashValue(MS.DEFAULT_METRICS, catalog), null);
      assert.equal(MS.hashValue(['ipc-main'], catalog), 'ipc-main');
      assert.equal(MS.hashValue(['cycles-per-req-main', 'ipc-main', 'instructions-per-req-main'], catalog), 'cycles-per-req-main,ipc-main,instructions-per-req-main', 'reordered default is not the default');
    });

    it('resolveInitialSelection: hash beats storage beats default, each validated against the catalog', () => {
      assert.deepEqual(MS.resolveInitialSelection('cpu-main,bogus', ['ipc-io'], catalog), { selection: ['cpu-main'], source: 'hash' });
      assert.deepEqual(MS.resolveInitialSelection('bogus', ['ipc-io', 'gone'], catalog), { selection: ['ipc-io'], source: 'storage' });
      assert.deepEqual(MS.resolveInitialSelection(null, null, catalog), { selection: MS.DEFAULT_METRICS, source: 'default' });
      assert.deepEqual(MS.resolveInitialSelection(null, ['gone'], catalog), { selection: MS.DEFAULT_METRICS, source: 'default' });
    });
  });

  describe('scope badge for the perf section', () => {
    const names = { workload: id => id.toUpperCase(), platform: id => id };
    const a = { engine: 'valkey', platform: 'arm64', workloadId: 'get' }, b = { engine: 'valkey', platform: 'arm64', workloadId: 'set' };
    it("'perf' scope keeps the primary badge but explains that lines overlay every workload", () => {
      const one = scopeBadgeLib.scopeBadge(a, [a], names, ['#1'], 'perf');
      assert.deepEqual(one, { text: 'GET · arm64', color: '#1', note: null });
      const two = scopeBadgeLib.scopeBadge(b, [a, b], names, ['#1', '#2'], 'perf');
      assert.equal(two.color, '#2');
      assert.equal(two.note, scopeBadgeLib.NOTE_PERF);
      assert.match(two.note, /every selected workload/);
      assert.match(two.note, /★ primary only/);
    });
  });
});

describe('index.html metric-selector wiring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');

  it('loads lib/metric-selector.js after lib/perf-groups.js (it reads the PerfGroups global)', () => {
    const a = html.indexOf('lib/perf-groups.js'), b = html.indexOf('lib/metric-selector.js');
    assert.ok(a > 0 && b > a);
  });

  it('sticky header carries the Perf metrics toggle beside the workload toggle, and the overlay panel with preset bar and list', () => {
    for (const id of ['metricToggle', 'metricSummary', 'metricPanel', 'metricPresetBar', 'metricList']) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    assert.ok(html.includes('class="selector-panel metric-panel"'), 'reuses the workload selector shell');
    assert.ok(html.includes("aria-controls=\"metricPanel\""));
    const headerStart = html.indexOf('<header>'), headerEnd = html.indexOf('</header>');
    const inHeader = id => { const i = html.indexOf(`id="${id}"`); return i > headerStart && i < headerEnd; };
    assert.ok(inHeader('selectorToggle') && inHeader('metricToggle') && inHeader('metricPanel'), 'toggle and panel live in the header');
    assert.ok(html.indexOf('id="selectorToggle"') < html.indexOf('id="metricToggle"'), 'workload selector first, metrics second');
    const sectionHead = html.slice(html.indexOf('id="perfChartsSection"'), html.indexOf('id="perfCharts"'));
    assert.ok(!sectionHead.includes('metricToggle'), 'no second toggle left in the section heading');
    assert.ok(html.includes('<span id="metricSummary">Perf metrics</span>'), 'placeholder names the section it governs');
  });

  it('opening one header panel closes the other', () => {
    assert.ok(html.includes('if (open && isSelectorPanelOpen()) setSelectorPanel(false);'));
    assert.ok(html.includes('if (open && isMetricPanelOpen()) setMetricPanel(false);'));
  });

  it('selection is restored at init (hash > storage > default), persisted, and carried in the hash', () => {
    assert.ok(html.includes('MetricSelector.resolveInitialSelection(hashState.metrics'));
    assert.ok(html.includes("metrics: params.get('metrics')"));
    assert.ok(html.includes('MetricSelector.hashValue(metricSelection, metricCatalog)'));
    assert.ok((html.match(/MetricSelector\.writeSelection\(metricStore/g) || []).length >= 2, 'written at init and on change');
    assert.ok(html.includes('MetricSelector.readPresets(metricStore)'));
    assert.ok(html.includes('MetricSelector.writePresets(metricStore'));
  });

  it('renderer draws one chart per selected metric with one line per workload in throughput colours', () => {
    const body = html.slice(html.indexOf('async function renderPerfCharts('), html.indexOf('// Latency band chart'));
    assert.ok(body.includes('MetricSelector.sanitize(metricSelection, metricCatalog)'));
    assert.ok(body.includes('selectedWorkloads.map((sel, si) =>'), 'fetches every selected workload');
    assert.ok(body.includes('MULTI_COLORS[si % MULTI_COLORS.length]'), 'colour = position in the selection');
    assert.ok(body.includes('SelectionHelpers.seriesLabel(sel, selectedWorkloads, names)'), 'platform shown only when the selection spans platforms');
    assert.ok(body.includes('ScopeHelpers.scopeDatasets(wlLabel, pts)'), 'scope runs carry over per line');
    assert.ok(body.includes('getSelectionKey(sel) === primaryKey) popupPerfData[entry.id] = pts'), 'commit popup deltas stay primary-only');
    assert.ok(body.includes("entry.kind === 'cpu'") && body.includes("entry.id === 'cpu-io' ? 'io' : 'main'"), 'flamegraph panels survive as panel metrics');
    assert.ok(body.includes('platforms differ, not directly comparable'));
    assert.ok(body.includes('class="perf-empty"'), 'empty selection shows a hint, not a blank section');
    assert.ok(!body.includes('PerfGroups.orderPerfGroups('), 'group iteration replaced by the selection');
  });

  it('a metric change redraws only the perf section, with its own staleness generation', () => {
    assert.ok(html.includes('renderPerfCharts(primaryWorkload.platform, renderGeneration)'));
    assert.ok(html.includes('perfGen !== perfRenderGeneration'));
  });

  it('perf badge uses the perf scope and the help text names the header button, the default set and the Efficiency preset', () => {
    assert.ok(html.includes("note: 'perfScopeNote',    scope: 'perf'"));
    assert.ok(cfg.includes('Perf metrics ▼') && cfg.includes('in the page header') && cfg.includes('<code>metrics=</code>'));
    assert.ok(cfg.includes('Default set (main thread)') && cfg.includes('layout-immune') && cfg.includes('<strong>Efficiency</strong> preset'));
  });

  it('panel closes on outside click and Escape like the workload selector', () => {
    assert.ok(html.includes("e.target.closest('#metricPanel') || e.target.closest('#metricToggle')"));
    assert.ok(html.includes("if (e.key === 'Escape' && isMetricPanelOpen()) setMetricPanel(false)"));
  });
});
