#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('status.html', 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const context = {
    console,
    Date,
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
vm.runInContext(script, context);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const pending = context.renderFleetControl({
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

const unreachable = context.renderFleetControl({
    fleet_control: {
        mode: 'shadow',
        control_reachable: false,
        claim_failures_consecutive: 3,
        pending_outcomes_count: 0,
    },
    measurement_isolation: {status_timer_migration_required: false},
});
assert(unreachable.severity === 'crit', 'three control failures should be critical');

const off = context.renderFleetControl({});
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
assert(context.shortSpecifier('1234567890abcdef') === '12345678…', 'truncated SHA needs an ellipsis');


const timelineTask = {id: 'timeline-task', expected_duration_sec: 300};
const timelineBoundary = {state: 'starting', task_id: 'timeline-task', timestamp: '2026-08-30T10:00:00Z'};
const startMs = new Date(timelineBoundary.timestamp).getTime();
const onTime = context.taskTimeline(timelineTask, timelineBoundary, startMs + 150000);
assert(onTime.includes('ETA 2m 30s'), 'remaining ETA missing');
assert(onTime.includes('Elapsed 2m 30s · expected 5m 0s'), 'elapsed-versus-expected label missing');
assert(onTime.includes('width:50.0%'), 'ETA fill should track elapsed fraction');
assert(onTime.includes('role="timer"'), 'ETA needs timer semantics');
assert(!onTime.includes('50%'), 'ETA must not claim percentage completion');

const late = context.taskTimeline(timelineTask, timelineBoundary, startMs + 375000);
assert(late.includes('Overdue 1m 15s'), 'overdue timer label missing');
assert(late.includes('timeline-state late'), 'late state styling missing');
assert(late.includes('width:100.0%'), 'overdue timer must remain fully filled');
assert(!late.includes('125%'), 'overdue timer must not show percentage progress');

const veryLate = context.taskTimeline(timelineTask, timelineBoundary, startMs + 480000);
assert(veryLate.includes('Overdue 3m 0s'), 'very-late timer label missing');
assert(veryLate.includes('very-late'), 'very-late styling missing');
assert(!veryLate.includes('160%'), 'very-late timer must not show percentage progress');
assert(context.taskTimeline(timelineTask, {...timelineBoundary, task_id: 'other'}, startMs + 1000) === '', 'non-current task must not get a timeline');

const unavailable = context.renderRemoteTasks(null);
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
assert(html.includes('ETA ${formatDuration(remaining)}'), 'explicit ETA timer rendering missing');
assert(!html.includes('percentText'), 'percentage progress semantics must remain absent');
assert(!html.includes('Current Task'), 'separate current-task progress section must be removed');

console.log('status monitoring tests passed');
