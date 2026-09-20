#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('status.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const statusHelpers = fs.readFileSync('lib/status-helpers.js', 'utf8');
const context = {
    console,
    Date,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => ({ok: false}),
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

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const pending = context.StatusHelpers.renderFleetControl({
    fleet_control: {
        mode: 'live',
        control_reachable: false,
        claim_failures_consecutive: 3,
        pending_outcomes_count: 1,
    },
    measurement_isolation: {status_timer_migration_required: true},
});
assert(pending.severity === 'crit', 'critical control outage must outrank pending outcome');
assert(pending.banner.includes('pending') && pending.banner.includes('unreachable'), 'combined outage context missing');

const unreachable = context.StatusHelpers.renderFleetControl({
    fleet_control: {
        mode: 'shadow',
        control_reachable: false,
        claim_failures_consecutive: 3,
        pending_outcomes_count: 0,
    },
    measurement_isolation: {status_timer_migration_required: false},
});
assert(unreachable.severity === 'crit', 'three control failures should be critical');

const off = context.StatusHelpers.renderFleetControl({});
assert(off.severity === null, 'missing fleet data should not alarm');
assert(off.summary.includes('not enabled'), 'disabled message missing');

const host = {
    runnerId: 'armbench',
    title: 'AWS Graviton 3',
    subtitle: 'c7g.metal · 64 cores',
};
const now = new Date().toISOString();
const hostHtml = context.renderHost({
    timestamp: now,
    runner: {state: 'running'},
    queue: {
        depth: 1,
        expected_duration_sec: 420,
        tasks: [{id: 'task-1', type: '<queue>', note: '<script>local bad</script>', source: 'valkey', specifier: '<local-sha>', expected_duration_sec: 420}],
    },
    recent_results: [{
        commit: '<commit>', method: '<method>', note: '<img onerror=1>', score: 1, completed: now,
        observed_duration_sec: 375,
    }],
    disk: {},
    fleet_control: {mode: 'live', control_reachable: true, pending_outcomes_count: 0},
    measurement_isolation: {boundary_publisher_active: true, status_timer_migration_required: false},
    boundary: {state: 'starting', task_id: 'task-1', timestamp: now},
}, host, {
    expected_duration_sec: 300,
    remote_tasks: [{
        id: 'remote-1', type: '<remote>', note: '<script>remote bad</script>', source: 'valkey',
        specifier: '<remote-sha>', state: 'queued', priority: 100, expected_duration_sec: 300,
    }],
});
assert(hostHtml.includes('AWS Graviton 3'), 'hardware platform must be the primary title');
assert(hostHtml.includes('armbench · c7g.metal · 64 cores'), 'SSH alias must be secondary metadata');
assert(hostHtml.includes('Remote mailbox') && hostHtml.includes('Local queue') && hostHtml.includes('Recent completions'), 'three task sections missing');
assert(hostHtml.includes('section remote') && hostHtml.includes('section local') && hostHtml.includes('section results'), 'stacked section highlighting missing');
assert(hostHtml.indexOf('Remote mailbox') < hostHtml.indexOf('Local queue'), 'remote mailbox must precede local queue');
assert(hostHtml.indexOf('Local queue') < hostHtml.indexOf('Recent completions'), 'local queue must precede completions');
assert(!hostHtml.includes('<script>remote bad</script>'), 'remote task description must be escaped');
assert(!hostHtml.includes('<script>local bad</script>'), 'local task description must be escaped');
assert(!hostHtml.includes('<img onerror=1>'), 'result description must be escaped');
assert(!hostHtml.includes('<commit>') && !hostHtml.includes('<method>'), 'result metadata must be escaped');
assert(hostHtml.includes('&lt;script&gt;remote bad&lt;/script&gt;'), 'remote descriptive text must remain visible');
assert(hostHtml.includes('&lt;script&gt;local bad&lt;/script&gt;'), 'local descriptive text must remain visible');
assert(hostHtml.includes('&lt;img onerror=1&gt;'), 'completion descriptive text must remain visible');
assert(hostHtml.includes('expected 5m 0s'), 'remote expected duration missing');
assert(hostHtml.includes('expected 7m 0s'), 'local expected duration missing');
assert(hostHtml.includes('observed 6m 15s'), 'observed completion duration missing');
assert(hostHtml.includes('1 task · ~5m 0s total'), 'remote queue total missing');
assert(hostHtml.includes('1 task · ~7m 0s total'), 'local queue total missing');
assert(hostHtml.includes('aria-label="Status: running"'), 'status dot accessibility label missing');
assert(!hostHtml.includes('priority undefined'), 'missing priority must not render undefined');
assert(context.StatusHelpers.shortSpecifier('1234567890abcdef') === '12345678…', 'truncated SHA needs an ellipsis');

const timelineTask = {id: 'timeline-task', expected_duration_sec: 300};
const timelineBoundary = {state: 'starting', task_id: 'timeline-task', timestamp: '2026-08-30T10:00:00Z'};
const startMs = new Date(timelineBoundary.timestamp).getTime();
const onTime = context.StatusHelpers.taskTimeline(timelineTask, timelineBoundary, startMs + 150000);
assert(onTime.includes('ETA 2m 30s'), 'remaining ETA missing');
assert(onTime.includes('Elapsed 2m 30s · expected 5m 0s'), 'elapsed-versus-expected label missing');
assert(onTime.includes('width:50.0%'), 'ETA fill should track elapsed fraction');
assert(onTime.includes('role="timer"'), 'ETA needs timer semantics');
assert(!onTime.includes('50%'), 'ETA must not claim percentage completion');

const late = context.StatusHelpers.taskTimeline(timelineTask, timelineBoundary, startMs + 375000);
assert(late.includes('Overdue 1m 15s'), 'overdue timer label missing');
assert(late.includes('timeline-state late'), 'late state styling missing');
assert(late.includes('width:100.0%'), 'overdue timer must remain fully filled');
assert(!late.includes('125%'), 'overdue timer must not show percentage progress');

const veryLate = context.StatusHelpers.taskTimeline(timelineTask, timelineBoundary, startMs + 480000);
assert(veryLate.includes('Overdue 3m 0s'), 'very-late timer label missing');
assert(veryLate.includes('very-late'), 'very-late styling missing');
assert(!veryLate.includes('160%'), 'very-late timer must not show percentage progress');
assert(context.StatusHelpers.taskTimeline(timelineTask, {...timelineBoundary, task_id: 'other'}, startMs + 1000) === '', 'non-current task must not get a timeline');

const truncatedMailboxHtml = context.renderHost({
    timestamp: now,
    runner: {state: 'running'},
    queue: {depth: 0, expected_duration_sec: 0, tasks: []},
    recent_results: [],
    disk: {},
}, host, {
    total_count: 80,
    returned_count: 50,
    truncated: true,
    expected_duration_complete: false,
    expected_duration_sec: 5000,
    remote_tasks: [{id: 'visible', note: 'visible task'}],
});
assert(truncatedMailboxHtml.includes('80 tasks · 1 shown'), 'authoritative remote count missing');
assert(truncatedMailboxHtml.includes('79 additional tasks not included in the public detail feed'), 'truncation disclosure missing');
assert(!truncatedMailboxHtml.includes('~1h 23m total'), 'partial expected duration must not be presented as complete');

const fleetNow = new Date().toISOString();
const fleetMetrics = context.fleetMetricsSnapshot({
    arm: {timestamp: fleetNow, runner: {state: 'running'}, boundary: {state: 'starting'}, queue: {depth: 2}},
    graviton4: {timestamp: fleetNow, runner: {state: 'running'}, boundary: {state: 'idle'}, queue: {depth: 1}},
    x86: {timestamp: fleetNow, runner: {state: 'stopped'}, boundary: {state: 'idle'}, queue: {depth: 0}},
}, {
    armbench: {total_count: 7},
    g4bench: {total_count: 3},
    bench: {total_count: 0},
    intelbench: {total_count: 1},
});
assert(fleetMetrics.online === 2 && fleetMetrics.total === 4, 'fleet online metric incorrect');
assert(fleetMetrics.active === 1, 'fleet active metric incorrect');
assert(fleetMetrics.remote === 11, 'fleet remote queue metric must use authoritative counts');
assert(fleetMetrics.local === 3, 'fleet local queue metric incorrect');

const unavailable = context.StatusHelpers.renderRemoteTasks(null);
assert(unavailable.includes('feed unavailable'), 'remote feed failure must not look like an empty mailbox');

const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
const boundaryOnlyHtml = context.renderHost({
    timestamp: tenMinutesAgo,
    runner: {state: 'running'},
    queue: {depth: 0, tasks: []},
    recent_results: [],
    disk: {},
    fleet_control: {mode: 'live', control_reachable: true, pending_outcomes_count: 0},
    measurement_isolation: {boundary_publisher_active: true, status_timer_migration_required: false},
    boundary: {state: 'starting', task_id: 'long-task'},
}, host, []);
assert(!boundaryOnlyHtml.includes('No update for'), '10m boundary-only task must not look stale');

const periodicHtml = context.renderHost({
    timestamp: tenMinutesAgo,
    runner: {state: 'running'},
    queue: {depth: 0, tasks: []},
    recent_results: [],
    disk: {},
}, host, []);
assert(periodicHtml.includes('No update for'), '10m periodic publisher should still warn');

assert(html.includes('task-flow'), 'vertical task flow layout missing');
assert(html.includes('grid-template-columns: repeat(auto-fit'), 'vertical host-card grid missing');
assert(html.includes('@keyframes timeline-shimmer'), 'active ETA shimmer animation missing');
assert(html.includes('animation: timeline-shimmer'), 'ETA fill must continuously shimmer');
assert(html.includes('prefers-reduced-motion: reduce'), 'ETA animation must respect reduced-motion preference');
assert(script.includes('setInterval(renderCachedStatus, 1000)'), 'client-side timeline must update once per second');
assert(!html.includes('progress_pct'), 'host-reported progress percentage must not be rendered');
assert(!html.includes('Current Task'), 'separate current-task progress section must be removed');

// Terminal-boundary recheck integration checks
assert(script.includes('terminalRecheckQualifies'), 'terminal recheck qualification check must be wired in');
assert(script.includes('createRecheckScheduler'), 'recheck scheduler must be instantiated');
assert(script.includes('scheduleTerminalRechecks'), 'terminal rechecks must be scheduled after loadStatus');
assert(script.includes('refreshAndSchedule();'), 'initial refresh must use the combined refresh-and-schedule path');
assert(!script.includes('\nloadStatus();\n'), 'page load must not issue a duplicate bare status fetch');
assert(script.includes('if (!autoRefreshEnabled) return;'), 'a fired recheck must stop after auto-refresh is disabled');
assert(script.includes('recheckScheduler.reset()'), 'auto-refresh toggle off must reset pending rechecks');
assert(!script.includes('setInterval(loadStatus, 5'), 'must not create a 5-second global polling interval');
assert(html.includes('terminalRecheckQualifies, createRecheckScheduler'), 'recheck helpers must be destructured from StatusHelpers');

// ---------------------------------------------------------------------------
// Host liveness / status-dot classification (computeHostLiveness)
// ---------------------------------------------------------------------------
const liveness = context.StatusHelpers.computeHostLiveness;
const nowMs = Date.now();
const iso = (ts) => new Date(nowMs - ts * 1000).toISOString();
const boundaryOnlyIso = {boundary_publisher_active: true, status_timer_migration_required: false};

// No payload -> unreachable (grey).
assert(liveness(null, nowMs).dotClass === 'unreachable', 'missing payload must be unreachable');

// Live-fleet reality captured 2026-09-20: boundary-only publisher, runner
// service sampled as "stopped" at the boundary, but a task is actively starting
// with queued work and the snapshot is fresh. This MUST be green, not red.
const activeStopped = liveness({
    timestamp: iso(1116),
    runner: {state: 'stopped'},
    boundary: {state: 'starting'},
    queue: {depth: 1},
    measurement_isolation: boundaryOnlyIso,
}, nowMs);
assert(activeStopped.dotClass === 'running', 'active boundary-only host must be green despite stopped runner_state');
assert(activeStopped.stale === false, 'a 19m-old boundary-only snapshot must not be stale');
assert(activeStopped.working === true, 'boundary starting + queued work counts as working');

// Healthy idle: boundary completed, empty queue, fresh-ish (12m). The old
// narrow window would have painted this amber/red; boundary-only widens it.
const healthyIdle = liveness({
    timestamp: iso(699),
    runner: {state: 'stopped'},
    boundary: {state: 'completed'},
    queue: {depth: 0},
    measurement_isolation: boundaryOnlyIso,
}, nowMs);
assert(healthyIdle.dotClass === 'running', 'idle boundary-only host with a fresh terminal boundary must be green');
assert(healthyIdle.stale === false, 'a 12m-old idle boundary-only snapshot must not be stale');

// Boundary-only host that has genuinely gone dark: > 6h with no update -> red.
const trulyDark = liveness({
    timestamp: iso(7 * 3600),
    runner: {state: 'stopped'},
    boundary: {state: 'completed'},
    queue: {depth: 0},
    measurement_isolation: boundaryOnlyIso,
}, nowMs);
assert(trulyDark.dotClass === 'stopped', 'boundary-only host silent > 6h must go red');
assert(trulyDark.staleReason.includes('no boundary update'), 'dark boundary-only host needs a boundary-update reason');

// Boundary-only host stale in the 2h–6h window -> amber.
const dimming = liveness({
    timestamp: iso(3 * 3600),
    runner: {state: 'stopped'},
    boundary: {state: 'completed'},
    queue: {depth: 0},
    measurement_isolation: boundaryOnlyIso,
}, nowMs);
assert(dimming.dotClass === 'stale', 'boundary-only host silent 2h–6h must be amber');

// Legacy periodic publisher: narrow window, reported state trusted directly.
const periodicRunning = liveness({
    timestamp: iso(120),
    runner: {state: 'running'},
}, nowMs);
assert(periodicRunning.dotClass === 'running', 'fresh periodic running host must be green');

const periodicStale = liveness({
    timestamp: iso(600),
    runner: {state: 'running'},
}, nowMs);
assert(periodicStale.dotClass === 'stale', 'periodic host silent 10m must be amber under the narrow window');

const periodicStopped = liveness({
    timestamp: iso(60),
    runner: {state: 'stopped'},
}, nowMs);
assert(periodicStopped.dotClass === 'stopped', 'periodic publisher must trust a reported stopped state');

// A live-reality active-stopped host must NOT render the stale banner.
const activeHost = {runnerId: 'armbench', title: 'AWS Graviton 3', subtitle: 'c7g.metal · 64 cores'};
const activeStoppedHtml = context.renderHost({
    timestamp: iso(1116),
    runner: {state: 'stopped'},
    boundary: {state: 'starting', task_id: 't1'},
    queue: {depth: 1, tasks: []},
    recent_results: [],
    disk: {},
    measurement_isolation: boundaryOnlyIso,
}, activeHost, []);
assert(activeStoppedHtml.includes('status-dot running'), 'active boundary-only card must render a green dot');
assert(!activeStoppedHtml.includes('No update for'), 'active boundary-only card must not show a stale banner');

console.log('status monitoring tests passed');
