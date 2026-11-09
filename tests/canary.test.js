/**
 * Tests for lib/canary-helpers.js and a render smoke test of canary.html.
 * Run: node --test tests/canary.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const C = require('../lib/canary-helpers.js');

// Small made-up documents in the published shape.
function ev(over) {
  return Object.assign({
    event_id: 'runner-x:2026-11-07:0', runner_id: 'runner-x', display_name: 'Runner X',
    date: '2026-11-07', kind: 'kernel or firmware', state: 'cleared', severity: 0,
    effect_pct: 0.1, ci_pct: [-0.2, 0.3], q: 0.5, confidence: 0.5, floor_pct: 0.78,
    fields: [], tests: [], cross_runner: [], alternative_dates: [],
  }, over || {});
}

function fleetEv(over) {
  return Object.assign({
    event_id: 'fleet:2026-11-06:0', runner_id: null, display_name: 'Fleet', date: '2026-11-06',
    kind: 'harness revision', state: 'suspected-fleet', severity: 0,
    fleet: { z: 3.26, same_direction: '4/4', runners: [
      { runner_id: 'runner-x', event_id: 'runner-x:2026-11-06:0', effect_pct: 0.49, z: 2.0, n_after: 1 },
      { runner_id: 'runner-y', event_id: 'runner-y:2026-11-06:0', effect_pct: 0.24, z: 0.9, n_after: 1 },
    ] },
  }, over || {});
}

describe('stateInfo', () => {
  it('uses plain words for every state', () => {
    assert.equal(C.stateInfo('confirmed').word, 'confirmed');
    assert.equal(C.stateInfo('suspected').word, 'suspected');
    assert.equal(C.stateInfo('insufficient-data').word, 'not enough data');
    assert.equal(C.stateInfo('suspected-fleet').word, 'suspected (fleet-wide)');
    assert.equal(C.stateInfo('explained').word, 'explained');
    assert.equal(C.stateInfo('cleared').word, 'no evidence of change');
  });
  it('keeps cleared and not enough data apart in word and class', () => {
    const a = C.stateInfo('cleared'), b = C.stateInfo('insufficient-data');
    assert.notEqual(a.word, b.word);
    assert.notEqual(a.cls, b.cls);
  });
  it('names a small shift below the floor', () => {
    assert.equal(C.stateInfo('cleared', true).word, 'small shift below the floor');
    assert.equal(C.stateInfo('confirmed', true).word, 'confirmed');
  });
  it('marks only confirmed and suspected as open', () => {
    assert.equal(C.stateInfo('confirmed').open, true);
    assert.equal(C.stateInfo('suspected').open, true);
    for (const s of ['insufficient-data', 'suspected-fleet', 'explained', 'cleared']) {
      assert.equal(C.stateInfo(s).open, false, s);
    }
  });
  it('never styles the fleet state as an alarm', () => {
    const f = C.stateInfo('suspected-fleet');
    assert.notEqual(f.cls, C.stateInfo('confirmed').cls);
    assert.notEqual(f.cls, C.stateInfo('suspected').cls);
  });
  it('handles an unknown state', () => {
    assert.deepEqual(C.stateInfo('bogus'), { word: 'unknown state', cls: 'unknown', open: false });
  });
  it('isOpen and isFleet', () => {
    assert.equal(C.isOpen(ev({ state: 'confirmed' })), true);
    assert.equal(C.isOpen(ev({ state: 'explained' })), false);
    assert.equal(C.isOpen(null), false);
    assert.equal(C.isFleet(fleetEv()), true);
    assert.equal(C.isFleet(ev()), false);
  });
});

describe('sortEvents', () => {
  it('orders by state, then severity, then newest date', () => {
    const list = [
      ev({ event_id: 'a', state: 'cleared' }),
      ev({ event_id: 'b', state: 'explained' }),
      fleetEv({ event_id: 'c' }),
      ev({ event_id: 'd', state: 'insufficient-data', severity: 0, date: '2026-09-01' }),
      ev({ event_id: 'e', state: 'insufficient-data', severity: 0, date: '2026-11-01' }),
      ev({ event_id: 'f', state: 'insufficient-data', severity: 0.05, date: '2026-08-01' }),
      ev({ event_id: 'g', state: 'suspected' }),
      ev({ event_id: 'h', state: 'confirmed', severity: 1 }),
      ev({ event_id: 'i', state: 'confirmed', severity: 11 }),
      ev({ event_id: 'j', state: 'new-thing' }),
    ];
    assert.deepEqual(C.sortEvents(list).map(e => e.event_id),
      ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a', 'j']);
  });
  it('does not mutate and drops non-objects', () => {
    const list = [ev({ event_id: 'b', state: 'cleared' }), null, ev({ event_id: 'a', state: 'confirmed' })];
    const out = C.sortEvents(list);
    assert.equal(out.length, 2);
    assert.equal(list[0].event_id, 'b');
    assert.deepEqual(C.sortEvents(null), []);
  });
});

describe('filterEvents and runnerOptions', () => {
  const list = [
    ev({ event_id: 'a', state: 'confirmed' }),
    ev({ event_id: 'b', state: 'cleared' }),
    ev({ event_id: 'c', state: 'insufficient-data', runner_id: 'runner-z', display_name: 'Runner Z' }),
    ev({ event_id: 'd', state: 'explained' }),
    fleetEv({ event_id: 'e' }),
  ];
  const NOW = Date.parse('2026-11-09T18:00:00Z');
  it('open scope keeps open findings and recent events still collecting data', () => {
    assert.deepEqual(C.filterEvents(list, { scope: 'open', now: NOW }).map(e => e.event_id), ['a', 'c', 'e']);
    assert.deepEqual(C.filterEvents(list, { now: NOW }).map(e => e.event_id), ['a', 'c', 'e']);
  });
  it('open scope drops old not-enough-data and old fleet rows, never an open finding', () => {
    const old = [
      ev({ event_id: 'old-open', state: 'suspected', date: '2026-09-01' }),
      ev({ event_id: 'old-short', state: 'insufficient-data', date: '2026-09-25' }),
      fleetEv({ event_id: 'old-fleet', date: '2026-09-19' }),
      ev({ event_id: 'edge', state: 'insufficient-data', date: '2026-10-27' }),
      ev({ event_id: 'undated', state: 'insufficient-data', date: '' }),
    ];
    assert.deepEqual(C.filterEvents(old, { scope: 'open', now: NOW }).map(e => e.event_id), ['old-open', 'edge']);
    assert.equal(C.filterEvents(old, { scope: 'all', now: NOW }).length, 5);
  });
  it('isRecent counts RECENT_DAYS back from now', () => {
    assert.equal(C.RECENT_DAYS, 14);
    assert.equal(C.isRecent(ev({ date: '2026-10-27' }), NOW), true);
    assert.equal(C.isRecent(ev({ date: '2026-10-26' }), NOW), false);
    assert.equal(C.isRecent(ev({ date: 'not a date' }), NOW), false);
  });
  it('all scope keeps every event', () => {
    assert.equal(C.filterEvents(list, { scope: 'all' }).length, 5);
  });
  it('runner filter keeps that runner and fleet rows it is part of', () => {
    assert.deepEqual(C.filterEvents(list, { scope: 'all', runner: 'runner-x' }).map(e => e.event_id), ['a', 'b', 'd', 'e']);
    assert.deepEqual(C.filterEvents(list, { scope: 'all', runner: 'runner-z' }).map(e => e.event_id), ['c']);
  });
  it('runnerOptions comes from both files, sorted by name, without the fleet', () => {
    const cons = { runners: [{ runner_id: 'runner-w', display_name: 'Runner W' }] };
    assert.deepEqual(C.runnerOptions(list, cons), [
      { id: 'runner-w', name: 'Runner W' },
      { id: 'runner-x', name: 'Runner X' },
      { id: 'runner-z', name: 'Runner Z' },
    ]);
  });
});

describe('isStale and formatUtc', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  it('is fresh up to 26 h and stale after', () => {
    assert.equal(C.isStale('2026-11-08T10:00:00Z', now), false);
    assert.equal(C.isStale('2026-11-08T09:59:59Z', now), true);
  });
  it('treats missing and bad times as stale', () => {
    assert.equal(C.isStale(undefined, now), true);
    assert.equal(C.isStale('not a date', now), true);
  });
  it('accepts a Date', () => {
    assert.equal(C.isStale('2026-11-09T11:00:00Z', new Date(now)), false);
  });
  it('formats UTC', () => {
    assert.equal(C.formatUtc('2026-11-09T12:00:00Z'), '2026-11-09 12:00 UTC');
    assert.equal(C.formatUtc('x'), 'unknown time');
  });
});

describe('number formats', () => {
  it('formatPct', () => {
    assert.equal(C.formatPct(12.292), '+12.29%');
    assert.equal(C.formatPct(-0.366), '-0.37%');
    assert.equal(C.formatPct(0), '0.00%');
    assert.equal(C.formatPct(-0.001), '0.00%');
    assert.equal(C.formatPct(null), 'n/a');
    assert.equal(C.formatPct(NaN), 'n/a');
  });
  it('formatCi', () => {
    assert.equal(C.formatCi([11.714, 12.563]), '+11.71..+12.56%');
    assert.equal(C.formatCi([-0.559, -0.082]), '-0.56..-0.08%');
    assert.equal(C.formatCi([null, null]), 'no interval');
    assert.equal(C.formatCi(undefined), 'no interval');
  });
  it('formatConfidence, formatQ, formatShare, formatZ, formatScore', () => {
    assert.equal(C.formatConfidence(0.9976), '0.998');
    assert.equal(C.formatConfidence(null), 'n/a');
    assert.equal(C.formatQ(0.000633), '< 0.001');
    assert.equal(C.formatQ(0.002375), '0.0024');
    assert.equal(C.formatQ(1), '1');
    assert.equal(C.formatQ(undefined), 'n/a');
    assert.equal(C.formatShare(1), '100%');
    assert.equal(C.formatShare(0.5), '50%');
    assert.equal(C.formatShare(null), 'n/a');
    assert.equal(C.formatZ(-0.55), '-0.55');
    assert.equal(C.formatZ(3.26), '+3.26');
    assert.equal(C.formatZ(0), '0.00');
    assert.equal(C.formatScore(615706.2), '615.7k');
    assert.equal(C.formatScore(1234567), '1.23M');
    assert.equal(C.formatScore(950.4), '950');
    assert.equal(C.formatScore(null), 'n/a');
  });
});

describe('evidence, fields, tests', () => {
  const tests = [
    { kind: 'canary', series: 'canary', n_before: 28, n_after: 3, n_after_strict: 2, effect_pct: 12.29, effect_strict_pct: 12.396, ci_pct: [11.7, 12.6], q: 0.0024, state: 'confirmed' },
    { kind: 'paired', series: 'GET P1', n_before: 31, n_after: 31, effect_pct: 12.2, ci_pct: [11.3, 12.8], q: 0.0006, same_direction: 1, state: 'confirmed' },
    { kind: 'paired', series: 'GET P10', n_before: 66, n_after: 66, effect_pct: 17.5, ci_pct: [16.9, 18.3], q: 0.0006, same_direction: 0.97, state: 'confirmed' },
    { kind: 'paired', series: 'one pair', n_before: 1, n_after: 1, effect_pct: 18.2, ci_pct: [null, null], q: 1, same_direction: 1, state: 'insufficient-data' },
  ];
  it('evidenceText counts canary days after and pairs with an interval', () => {
    assert.equal(C.evidenceText(ev({ tests })), '3 days after, 97 pairs');
    assert.equal(C.evidenceText(ev({ tests: [tests[0]] })), '3 days after');
    assert.equal(C.evidenceText(ev({ tests: [Object.assign({}, tests[0], { n_after: 1 })] })), '1 day after');
    assert.equal(C.evidenceText(ev({ tests: [] })), 'no tests');
    assert.equal(C.evidenceText(fleetEv()), '2 runners');
  });
  it('fieldsSummary lists every field on one line and cuts with +N more', () => {
    const e = ev({ fields: [
      { label: 'kernel', old: '6.1.170-213.321', new: '6.1.189-236.400' },
      { label: 'glibc' }, { label: 'microcode_ctl' }, { label: 'reboot' },
    ] });
    assert.equal(C.fieldsSummary(e), 'kernel: 6.1.170-213.321 -> 6.1.189-236.400; glibc; microcode_ctl; reboot');
    assert.equal(C.fieldsSummary(e, 50), 'kernel: 6.1.170-213.321 -> 6.1.189-236.400; glibc (+2 more)');
    assert.equal(C.fieldsSummary(ev()), '');
    assert.equal(C.fieldsSummary(null), '');
  });
  it('fieldText shows old -> new only when given', () => {
    assert.equal(C.fieldText({ label: 'kernel', old: 'k-3', new: 'k-2' }), 'kernel: k-3 -> k-2');
    assert.equal(C.fieldText({ label: 'reboot', old: null, new: null }), 'reboot');
    assert.equal(C.fieldText({ label: 'glibc', old: null, new: '2.34' }), 'glibc: none -> 2.34');
    assert.equal(C.fieldText(null), '');
  });
  it('testRows maps every test', () => {
    const rows = C.testRows(ev({ tests }));
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[0], { series: 'canary', n: '28 before, 3 after', effect: '+12.29%', ci: '+11.70..+12.60%', q: '0.0024', state: 'confirmed', stateCls: 'confirmed', sameDirection: 'n/a' });
    assert.equal(rows[1].n, '31 pairs');
    assert.equal(rows[2].sameDirection, '97%');
    assert.equal(rows[3].n, '1 pair');
    assert.equal(rows[3].ci, 'no interval');
    assert.equal(rows[3].state, 'not enough data');
  });
  it('strictText', () => {
    assert.equal(C.strictText(ev({ tests })), '+12.40% (2 days after)');
    assert.equal(C.strictText(ev({ tests: [] })), null);
    assert.equal(C.canaryTest(ev({ tests })).series, 'canary');
  });
});

describe('ciScale and ciBar geometry', () => {
  it('scale is the largest bound, kept between 1% and 1.5%', () => {
    assert.equal(C.ciScale([ev({ effect_pct: 0.1, ci_pct: [-0.2, 0.3] })]), 1);
    assert.equal(C.ciScale([ev({ effect_pct: -1.2, ci_pct: [-1.3, -1.0] })]), 1.3);
    assert.equal(C.ciScale([ev({ effect_pct: 12.3, ci_pct: [11.7, 12.6] })]), 1.5);
    assert.equal(C.ciScale([]), 1);
  });
  it('maps the interval, effect, zero and floor into the width', () => {
    const g = C.ciBar([-0.5, 1], 0.25, 0.5, 2, 100);
    assert.equal(g.zero, 50);
    assert.equal(g.x0, 37.5);
    assert.equal(g.x1, 75);
    assert.equal(g.dot, 56.25);
    assert.equal(g.floor0, 37.5);
    assert.equal(g.floor1, 62.5);
    assert.equal(g.clipLeft, false);
    assert.equal(g.clipRight, false);
  });
  it('clips outside the scale and marks the side', () => {
    const g = C.ciBar([11.7, 12.6], 12.3, 0.78, 3, 120);
    assert.equal(g.x0, 120);
    assert.equal(g.x1, 120);
    assert.equal(g.dot, 120);
    assert.equal(g.clipRight, true);
    assert.equal(g.clipLeft, false);
  });
  it('a floor wider than the scale does not mark a clip', () => {
    const g = C.ciBar([0.1, 0.2], 0.15, 5, 1, 100);
    assert.equal(g.floor0, 0);
    assert.equal(g.floor1, 100);
    assert.equal(g.clipLeft, false);
    assert.equal(g.clipRight, false);
  });
  it('orders a reversed interval and handles missing parts', () => {
    const g = C.ciBar([1, -1], null, null, 1, 100);
    assert.equal(g.x0, 0);
    assert.equal(g.x1, 100);
    assert.equal(g.dot, null);
    assert.equal(g.floor0, null);
    const h = C.ciBar([null, null], -0.35, 0.5, 1, 100);
    assert.equal(h.x0, null);
    assert.equal(h.dot, 32.5);
    assert.equal(C.ciBar(null, null, 0.5, 1, 100), null);
  });
});

describe('plotGeometry', () => {
  const pad = { left: 0, right: 0, top: 0, bottom: 0 };
  const plot = { dates: ['d0', 'd1', 'd2', 'd3', 'd4'], scores: [100, 102, 98, 110, 112], event_index: 3, cut_dates: ['d3'] };
  it('splits before/after at event_index and takes the medians', () => {
    const g = C.plotGeometry(plot, null, 400, 100, pad);
    assert.equal(g.points.length, 5);
    assert.deepEqual(g.points.map(p => p.side), ['before', 'before', 'before', 'after', 'after']);
    assert.equal(g.before.value, 100);
    assert.equal(g.after.value, 111);
    assert.equal(g.band, null);
  });
  it('scales x over the width and y over the range with an 8% margin', () => {
    const g = C.plotGeometry(plot, null, 400, 100, pad);
    assert.deepEqual(g.points.map(p => p.x), [0, 100, 200, 300, 400]);
    assert.ok(Math.abs(g.yMin - (98 - 14 * 0.08)) < 1e-9);
    assert.ok(Math.abs(g.yMax - (112 + 14 * 0.08)) < 1e-9);
    const top = g.points[4].y, bottom = g.points[2].y;
    assert.ok(top < bottom, 'higher score is drawn higher');
    assert.ok(top > 0 && bottom < 100);
    assert.equal(g.before.x1, 250);
    assert.equal(g.after.x0, 250);
  });
  it('places cuts between the two days and adds the CI band', () => {
    const g = C.plotGeometry(plot, [5, 15], 400, 100, pad);
    assert.deepEqual(g.cuts, [{ date: 'd3', x: 250 }]);
    assert.equal(g.band.lo, 105);
    assert.ok(Math.abs(g.band.hi - 115) < 1e-9);
    assert.ok(g.yMax > 115, 'band is inside the range');
    assert.ok(g.band.y0 < g.band.y1);
  });
  it('skips missing scores and unknown cut dates, returns null without data', () => {
    const g = C.plotGeometry({ dates: ['a', 'b', 'c'], scores: [1, null, 3], event_index: 1, cut_dates: ['zz'] }, null, 200, 100, pad);
    assert.equal(g.points.length, 2);
    assert.deepEqual(g.cuts, []);
    assert.equal(C.plotGeometry({ dates: ['a'], scores: [null] }, null, 200, 100, pad), null);
    assert.equal(C.plotGeometry(null, null, 200, 100, pad), null);
  });
  it('a flat series still gets a range', () => {
    const g = C.plotGeometry({ dates: ['a', 'b'], scores: [5, 5], event_index: 1 }, null, 200, 100, pad);
    assert.ok(g.yMax > g.yMin);
  });
  it('median', () => {
    assert.equal(C.median([3, 1, 2]), 2);
    assert.equal(C.median([4, 1, 3, 2]), 2.5);
    assert.equal(C.median([]), null);
  });
});

describe('parseHash and buildHash', () => {
  it('parses runner and event', () => {
    assert.deepEqual(C.parseHash('#runner=runner-b&event=runner-b%3A2026-11-07%3A0'), { runner: 'runner-b', event: 'runner-b:2026-11-07:0' });
    assert.deepEqual(C.parseHash('#event=fleet:2026-11-06:0'), { runner: null, event: 'fleet:2026-11-06:0' });
  });
  it('ignores empty, unknown and broken parts', () => {
    assert.deepEqual(C.parseHash(''), { runner: null, event: null });
    assert.deepEqual(C.parseHash('#runner=&x=1&event=%E0%A4%A'), { runner: null, event: null });
    assert.deepEqual(C.parseHash(undefined), { runner: null, event: null });
  });
  it('round-trips', () => {
    const s = { runner: 'runner-b', event: 'runner-b:2026-11-07:0' };
    assert.deepEqual(C.parseHash(C.buildHash(s)), s);
    assert.equal(C.buildHash({}), '');
    assert.equal(C.buildHash({ runner: 'r' }), '#runner=r');
  });
});

describe('header text', () => {
  it('openCountText', () => {
    assert.equal(C.openCountText({ open_count: 1 }), '1 open finding');
    assert.equal(C.openCountText({ open_count: 3 }), '3 open findings');
    assert.equal(C.openCountText({ open_count: 0 }), 'no open findings');
    assert.equal(C.openCountText({}), null);
    assert.equal(C.openCountText(null), null);
  });
  it('stateCountsText in page order', () => {
    assert.equal(C.stateCountsText({ cleared: 47, confirmed: 1, explained: 2, 'insufficient-data': 22, 'suspected-fleet': 1 }),
      '1 confirmed, 22 not enough data, 1 suspected (fleet-wide), 2 explained, 47 no evidence of change');
    assert.equal(C.stateCountsText(null), '');
  });
});

describe('consistency text', () => {
  it('streak: days, reasons, and not enough data', () => {
    assert.deepEqual(C.streakText({ streak_days: 21, streak_end_reason: 'out-of-band day' }),
      { text: 'Within band for 21 days (ended by an out-of-band day)', cls: 'cleared' });
    assert.equal(C.streakText({ streak_days: 62, streak_end_reason: 'start of history' }).text,
      'Within band for 62 days (since the start of the history)');
    const n = C.streakText({ streak_days: 0, streak_end_reason: 'not enough data since the last step' });
    assert.equal(n.cls, 'insufficient');
    assert.equal(n.text, 'Within-band streak: not enough data (since the last step)');
    assert.equal(C.streakText({}).cls, 'insufficient');
    assert.equal(C.streakText({ streak_days: 1, streak_end_reason: 'something new' }).text, 'Within band for 1 day (something new)');
  });
  it('sd, events, missing days, confirmation', () => {
    assert.equal(C.sdText({ sd_recent_pct: 0.277, sd_first_pct: 0.548 }), 'Spread 0.28% in the last 28 days (first 28 days: 0.55%)');
    assert.equal(C.sdText({}), 'Spread: not enough data');
    assert.equal(C.eventsText({ events_tested_90d: 15, events_cleared_90d: 7, events_insufficient_90d: 7 }),
      '15 events tested in the last 90 days: 7 no evidence of change, 7 not enough data');
    assert.equal(C.eventsText({}), 'Events in the last 90 days: n/a');
    assert.equal(C.missingText({ missing_days_90d: 3, missing_days_30d: ['2026-10-31', '2026-11-01', '2026-11-02'] }),
      '3 missing days in the last 90 days (last 30 days: 2026-10-31, 2026-11-01, 2026-11-02)');
    assert.equal(C.missingText({ missing_days_90d: 0, missing_days_30d: [] }), 'No missing days in the last 90 days');
    assert.equal(C.missingText({}), 'Missing days: n/a');
    assert.equal(C.confirmationText({ last_confirmation_run: null }), 'Last confirmation run: none yet');
    assert.equal(C.confirmationText({ last_confirmation_run: { date: '2026-11-10', verdict: 'confirmed', pairs: 8 } }),
      'Last confirmation run: 2026-11-10, confirmed, 8 pairs');
  });
  it('fleet line', () => {
    assert.deepEqual(C.fleetText({ latest_deploy_date: '2026-11-09', same_direction: '2/4', state: 'insufficient-data', z: -0.55 }),
      { text: 'Latest fleet harness deploy 2026-11-09, 2/4 runners moved the same way, pooled Z -0.55: not enough data', cls: 'insufficient' });
    assert.equal(C.fleetText(null).cls, 'neutral');
  });
});

// ===========================================================================
// canary.html render smoke test (VM, small fake DOM; no jsdom)
// ===========================================================================

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this._text = '';
    this.open = false;
    this.checked = false;
    this.value = '';
    this.innerHTMLWrites = 0;
  }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t) { (this.listeners[t] || []).forEach(fn => fn({ target: this })); }
  scrollIntoView() {}
  get textContent() { return this._text + this.children.map(c => c.textContent).join(' '); }
  set textContent(v) { this._text = String(v); this.children = []; }
  set innerHTML(v) { this.innerHTMLWrites++; }
  all(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.all(pred, out)); return out; }
}

function loadPage() {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'canary.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 1);
  const ids = {};
  const document = {
    createElement: t => new FakeNode(t),
    createElementNS: (ns, t) => new FakeNode(t),
    getElementById: id => (ids[id] = ids[id] || new FakeNode('div')),
    querySelectorAll: () => [],
  };
  const context = { console, Date, Promise, document, location: { hash: '', pathname: '/canary.html', search: '' } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'lib', 'canary-helpers.js'), 'utf8'), context);
  vm.runInContext(scripts[0], context);
  return { context, ids };
}

describe('canary.html render (via VM)', () => {
  const findings = {
    generated_at: '2026-11-09T12:00:00Z', open_count: 1,
    state_counts: { confirmed: 1, 'insufficient-data': 1, 'suspected-fleet': 1, cleared: 1 },
    events: [
      ev({ event_id: 'runner-x:2026-11-01:0', state: 'cleared', below_floor_shift: true }),
      fleetEv(),
      ev({ event_id: 'runner-y:2026-11-09:0', runner_id: 'runner-y', display_name: 'Runner Y', state: 'insufficient-data', ci_pct: [null, null] }),
      ev({
        event_id: 'runner-x:2026-11-07:0', state: 'confirmed', severity: 11.7, effect_pct: 12.29, ci_pct: [11.71, 12.56],
        q: 0.0024, confidence: 0.9976,
        attribution_note: '2 fields changed together. The effect is attributed to the event as a whole; this data cannot tell which field caused it.',
        fields: [{ label: 'kernel', old: 'k-3', new: 'k-2' }, { label: 'reboot', old: null, new: null }],
        tests: [{ kind: 'canary', series: 'canary', n_before: 28, n_after: 3, n_after_strict: 2, effect_pct: 12.29, effect_strict_pct: 12.4, ci_pct: [11.71, 12.56], q: 0.0024, state: 'confirmed' }],
        cross_runner: [{ runner_id: 'runner-y', effect_pct: 0.14, z: 0.55, n_days: 3 }],
        plot: { dates: ['d0', 'd1', 'd2', 'd3'], scores: [100, 101, 113, 112], event_index: 2, cut_dates: ['d2'] },
        explanation: null,
        proposal: 'A person may close the sweep generation. Nothing does this automatically.',
      }),
    ],
  };
  const consistency = {
    generated_at: '2026-11-09T12:00:00Z',
    fleet: { latest_deploy_date: '2026-11-09', same_direction: '2/4', state: 'insufficient-data', z: -0.55 },
    runners: [
      { runner_id: 'runner-x', display_name: 'Runner X', streak_days: 21, streak_end_reason: 'out-of-band day', sd_recent_pct: 0.28, sd_first_pct: 0.55, events_tested_90d: 15, events_cleared_90d: 7, events_insufficient_90d: 7, missing_days_90d: 3, missing_days_30d: ['2026-10-31'], last_confirmation_run: null },
      { runner_id: 'runner-y', display_name: 'Runner Y', streak_days: 0, streak_end_reason: 'not enough data since the last step' },
    ],
  };

  it('renders header, ranked list and consistency panel', () => {
    const { context, ids } = loadPage();
    const rows = context.renderPage(findings, consistency, Date.parse('2026-11-09T13:00:00Z'));
    assert.deepEqual(rows.map(e => e.event_id), ['runner-x:2026-11-07:0', 'runner-y:2026-11-09:0', 'fleet:2026-11-06:0']);
    const sum = ids.summary.textContent;
    assert.ok(sum.includes('1 open finding'));
    assert.ok(sum.includes('analysis 2026-11-09 12:00 UTC'));
    assert.ok(!sum.includes('not current'));
    const list = ids.events.textContent;
    assert.ok(list.includes('confirmed'));
    assert.ok(list.includes('not enough data'));
    assert.ok(list.includes('suspected (fleet-wide)'));
    assert.ok(list.includes('+12.29%') && list.includes('+11.71..+12.56%'));
    assert.ok(list.includes('2 fields changed together'));
    assert.ok(list.includes('Runner X') && list.includes('Fleet'));
    assert.ok(!list.includes('runner-x:2026-11-07:0'), 'event id only in the detail footer');
    assert.ok(ids.shownCount.textContent.includes('Showing 3 of 4 events'));
    const cons = ids.consistency.textContent;
    assert.ok(cons.includes('Within band for 21 days'));
    assert.ok(cons.includes('Within-band streak: not enough data'));
    assert.ok(cons.includes('7 no evidence of change, 7 not enough data'));
    assert.ok(ids.fleetLine.textContent.includes('pooled Z -0.55: not enough data'));
    const nodes = [ids.summary, ids.events, ids.consistency].flatMap(n => n.all(() => true));
    assert.equal(nodes.reduce((a, n) => a + n.innerHTMLWrites, 0), 0, 'no innerHTML writes');
  });

  it('opening a row builds the detail with plot, tests and footer id', () => {
    const { context, ids } = loadPage();
    context.history = { replaceState: (a, b, h) => { context.location.hash = h; } };
    context.renderPage(findings, consistency, Date.parse('2026-11-09T13:00:00Z'));
    const det = ids.events.all(n => n.tagName === 'DETAILS');
    det[0].open = true;
    det[0].dispatch('toggle');
    const t = det[0].textContent;
    assert.ok(t.includes('kernel: k-3 -> k-2'));
    assert.ok(t.includes('Strict window'));
    assert.ok(t.includes('Other runners over the same dates'));
    assert.ok(t.includes('Proposed action'));
    assert.ok(t.includes('Event id: runner-x:2026-11-07:0'));
    assert.equal(det[0].all(n => n.tagName === 'CIRCLE').length >= 4, true, 'plot dots');
    assert.equal(context.location.hash, '#event=runner-x%3A2026-11-07%3A0');
    det[2].open = true;
    det[2].dispatch('toggle');
    assert.ok(det[2].textContent.includes('Pooled Z +3.26'));
    assert.ok(det[2].textContent.includes('never an alarm'));
  });

  it('marks a stale analysis as not current, and shows missing files in words', () => {
    const { context, ids } = loadPage();
    context.renderPage(findings, consistency, Date.parse('2026-11-11T00:00:00Z'));
    assert.ok(ids.summary.textContent.includes('(not current)'));
    context.renderPage(null, null, Date.now());
    assert.ok(ids.summary.textContent.includes('not published yet'));
    assert.ok(ids.consistency.textContent.includes('not published yet'));
    assert.ok(ids.events.textContent.includes('No findings to show'));
  });

  it('page text is ASCII only', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'canary.html'), 'utf8');
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'canary-helpers.js'), 'utf8');
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html), 'canary.html');
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(lib), 'canary-helpers.js');
  });
});
