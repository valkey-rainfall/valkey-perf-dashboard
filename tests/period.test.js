/**
 * Unit tests for period-helpers.js -- environment period markers, generation
 * options and canary state.
 *
 * Run: node --test tests/period.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const P = require('../lib/period-helpers.js');
const epoch = require('../lib/epoch-helpers.js');

const PERIODS = [
  { id: 0, start_commit_index: 0, end_commit_index: 40, label: '', boot_only: false },
  { id: 1, start_commit_index: 41, end_commit_index: 60, label: 'reboot', boot_only: true },
  { id: 2, start_commit_index: 61, end_commit_index: 90, label: 'kernel_release: 6.1.170-213 -> 6.1.189-236; cpu_microcode: 0x2b000603 -> 0x2b000685', boot_only: false },
];

describe('periodMarkers', () => {
  it('draws one line per boundary, none for the first period', () => {
    const marks = P.periodMarkers(PERIODS);
    assert.deepEqual(Object.keys(marks), ['period1', 'period2']);
    assert.equal(marks.period2.xMin, 60.5);
    assert.equal(marks.period2.label.content, 'kernel_release: 6.1.170-213 -> 6.1.189-236');
    assert.equal(marks.period1.label.content, 'reboot');
    assert.notEqual(marks.period1.borderColor, marks.period2.borderColor);
  });

  it('hides boot-only boundaries when asked', () => {
    assert.deepEqual(Object.keys(P.periodMarkers(PERIODS, { showReboots: false })), ['period2']);
  });

  it('tolerates missing data', () => {
    assert.deepEqual(P.periodMarkers(null), {});
    assert.deepEqual(P.periodMarkers([{ id: 1 }]), {});
  });
});

describe('periodWarning', () => {
  it('warns when two points sit in different periods', () => {
    const text = P.periodWarning({ period: 2 }, { period: 0 }, PERIODS);
    assert.match(text, /Environment changed between these points: kernel_release/);
  });
  it('is silent within one period or without period data', () => {
    assert.equal(P.periodWarning({ period: 1 }, { period: 1 }, PERIODS), null);
    assert.equal(P.periodWarning({}, { period: 1 }, PERIODS), null);
    assert.equal(P.periodWarning({ period: 1 }, null, PERIODS), null);
  });
  it('counts periods with and without reboots', () => {
    assert.equal(P.periodCount(PERIODS, true), 3);
    assert.equal(P.periodCount(PERIODS, false), 2);
  });
});

describe('generations', () => {
  it('lists the live series first, then generations newest first', () => {
    const manifest = { generations: [
      { id: '2026-09-01', until: '2026-09-01T00:00:00Z', label: 'old' },
      { id: '2026-11-06', until: '2026-11-06T16:14:23Z', label: 'kernel 6.1.170 -> 6.1.189, glibc, microcode' },
    ] };
    const options = P.generationOptions(manifest);
    assert.deepEqual(options.map(o => o.id), [null, '2026-11-06', '2026-09-01']);
    assert.match(options[1].label, /^History before 2026-11-06 \(kernel 6\.1\.170/);
  });
  it('is only the live series without generations', () => {
    assert.deepEqual(P.generationOptions({}), [{ id: null, label: 'Live series' }]);
    assert.deepEqual(P.generationOptions(null), [{ id: null, label: 'Live series' }]);
  });
  it('suffixes the exporter file names and the epoch URL helpers accept a generation', () => {
    assert.equal(P.generationFilename('series-intel-get-throughput.epoch-v3.json', '2026-11-06'),
      'series-intel-get-throughput.epoch-v3.gen-2026-11-06.json');
    assert.equal(P.generationFilename('x.json', null), 'x.json');
    assert.equal(epoch.seriesUrl('https://d', 'intel', 'get', 'throughput', 'v3', '2026-11-06'),
      'https://d/series-intel-get-throughput.epoch-v3.gen-2026-11-06.json');
    assert.equal(epoch.seriesUrl('https://d', 'intel', 'get', 'throughput', 'v3'),
      'https://d/series-intel-get-throughput.epoch-v3.json');
    assert.equal(epoch.notableUrl('https://d', 'intel', 'v3', '2026-11-06'), 'https://d/notable-intel.epoch-v3.gen-2026-11-06.json');
    assert.equal(epoch.manifestUrl('https://d', 'intel', 'v3', '2026-11-06'), 'https://d/manifest-intel.epoch-v3.gen-2026-11-06.json');
    assert.equal(epoch.manifestUrl('https://d', 'intel', 'v1', '2026-11-06'), 'https://d/manifest-intel.gen-2026-11-06.json');
  });
});

describe('canaryState', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const entry = (latest, phase) => ({ runner: { runner_id: 'intelbench', series: { phase: phase || 'ready' }, latest_observation: latest } });

  it('reads an alarm with its delta and the environment change', () => {
    const state = P.canaryState(entry({
      utc_date: '2026-11-07', candidate_signal: 'alarm', delta_pct: 12.3,
      env_change_annotation: "kernel_release: '6.1.170' -> '6.1.189'; cpu_microcode: '0x2b000603' -> '0x2b000685'",
    }), now);
    assert.equal(state.severity, 'alarm');
    assert.equal(state.banner, true);
    assert.match(state.text, /^Canary 2026-11-07: \+12\.3% vs the 28-day median, alarm\. Environment changed: kernel_release/);
  });

  it('a within observation is informational and shows no banner', () => {
    const state = P.canaryState(entry({ utc_date: '2026-11-08', candidate_signal: 'within', delta_pct: 0.4 }), now);
    assert.equal(state.severity, 'info');
    assert.equal(state.banner, false);
    assert.equal(state.text, 'Canary 2026-11-08: +0.4% vs the 28-day median');
  });

  it('an old environment change raises no banner; a fresh one does', () => {
    const old = P.canaryState(entry({ utc_date: '2026-10-01', candidate_signal: 'within', delta_pct: 0.1, env_change_annotation: 'x' }), now);
    assert.equal(old.banner, false);
    const fresh = P.canaryState(entry({ utc_date: '2026-11-06', candidate_signal: 'within', delta_pct: 0.1, env_change_annotation: 'x' }), now);
    assert.equal(fresh.banner, true);
  });

  it('names an uncalibrated phase and handles empty files', () => {
    const state = P.canaryState(entry({ utc_date: '2026-11-08', candidate_signal: 'insufficient-data' }, 'observation'), now);
    assert.equal(state.text, 'Canary 2026-11-08: observation phase');
    assert.equal(P.canaryState(null, now), null);
    assert.equal(P.canaryState({ runner: { runner_id: 'x', latest_observation: null } }, now), null);
  });
});
