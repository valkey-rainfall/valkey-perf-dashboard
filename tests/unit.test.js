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

  it('orders perf groups via the helper rather than inline', () => {
    assert.ok(html.includes('PerfGroups.orderPerfGroups'), 'must call PerfGroups.orderPerfGroups');
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
  it('selector items and engine chips iterate historyEngines()', () => {
    assert.ok(!/for \(const eng of ENGINES\)/.test(html));
    assert.ok(!/key: 'engine', values: ENGINES\.map/.test(html));
    assert.ok((html.match(/historyEngines\(\)/g) || []).length >= 3);
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
    assert.ok(checks >= 12, `expected staleness checks after every await, found ${checks}`);
    for (const fn of ['renderMemory(platform, data, gen)', 'renderPerfCharts(platform, gen)', 'renderLatency(platform, gen)']) {
      assert.ok(html.includes(fn), `${fn} must receive the generation`);
    }
  });
});
