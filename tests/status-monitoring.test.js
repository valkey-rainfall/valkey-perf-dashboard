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
        accepted_task_id: 'task<&',
        active_stage: 'outcome_pending',
        imported_count_total: 2,
        last_error: 'bad <error>',
    },
    measurement_isolation: {status_timer_migration_required: true},
    boundary: {state: 'failed', task_id: 'task<&'},
});
assert(pending.severity === 'crit', 'critical control outage must outrank pending outcome');
assert(pending.banner.includes('pending') && pending.banner.includes('unreachable'), 'combined outage context missing');
assert(pending.html.includes('task&lt;&amp;'), 'task ID must be escaped');
assert(!pending.html.includes('bad <error>'), 'error text must be escaped');

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
assert(off.html.includes('Not enabled'), 'disabled message missing');

const hostHtml = context.renderHost({
    timestamp: new Date().toISOString(),
    runner: {state: 'running'},
    current_task: {type: '<img onerror=1>', state: '<bad>', steps: '<1/2>', elapsed_sec: 1, progress_pct: 50},
    queue: {depth: 1, tasks: [{type: '<queue>', note: '<script>bad</script>'}]},
    recent_results: [{commit: '<commit>', method: '<method>', score: 1, completed: new Date().toISOString()}],
    disk: {},
}, 'test', 'test');
assert(!hostHtml.includes('<img onerror=1>'), 'current task fields must be escaped');
assert(!hostHtml.includes('<script>bad</script>'), 'queue fields must be escaped');
assert(!hostHtml.includes('<commit>'), 'result fields must be escaped');

console.log('status monitoring tests passed');
