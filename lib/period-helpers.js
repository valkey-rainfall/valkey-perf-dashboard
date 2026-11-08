/**
 * period-helpers.js -- environment periods, series generations and canary state.
 *
 * Pure functions shared by index.html (markers, generation selector, banner)
 * and status.html (canary row on a runner card). The data comes from the
 * exporter (series.json "periods", manifest "generations") and from the
 * control service's static canary files (canary/<runner>.json).
 *
 * A period is a MARKER: a run of points measured under one recorded
 * environment (kernel, glibc, microcode, revisions, boot id). The series is
 * never split here; that is the operator's manual close-generation step, which
 * produces the read-only generations a platform manifest lists.
 *
 * Browser: loaded via <script src="lib/period-helpers.js">.
 * Node:    const P = require('./lib/period-helpers.js');
 */
'use strict';

(function (exports) {

  var ENV_COLOR = 'rgba(234,88,12,0.75)';   // package / kernel / microcode change
  var BOOT_COLOR = 'rgba(100,116,139,0.45)'; // reboot only: a possible change, drawn lighter

  /**
   * chartjs-plugin-annotation line configs for the boundaries between periods.
   * The first period has no boundary. Boot-only boundaries are omitted when
   * showReboots is false.
   *
   * @param {Array<{id:number,start_commit_index:number,label:string,boot_only:boolean}>} periods
   * @param {{showReboots?: boolean}} [opts]
   * @returns {Object<string, Object>} keyed `period<id>`
   */
  function periodMarkers(periods, opts) {
    var showReboots = !opts || opts.showReboots !== false;
    var out = {};
    (periods || []).forEach(function (p) {
      if (!p || p.id === 0 || p.start_commit_index == null) return;
      if (p.boot_only && !showReboots) return;
      var x = p.start_commit_index - 0.5;
      out['period' + p.id] = {
        type: 'line', xMin: x, xMax: x,
        borderColor: p.boot_only ? BOOT_COLOR : ENV_COLOR,
        borderWidth: p.boot_only ? 1 : 1.5,
        borderDash: p.boot_only ? [2, 3] : [6, 3],
        label: {
          display: true,
          content: p.boot_only ? 'reboot' : shortLabel(p.label),
          position: 'end',
          font: { size: 10 },
          color: p.boot_only ? '#64748b' : '#ea580c',
          backgroundColor: 'rgba(0,0,0,0)',
        },
      };
    });
    return out;
  }

  /** A boundary label cut to one line: first change only, values shortened. */
  function shortLabel(label, maxChars) {
    maxChars = maxChars || 48;
    if (!label) return 'environment change';
    var first = String(label).split(';')[0].trim();
    return first.length > maxChars ? first.slice(0, maxChars - 3) + '...' : first;
  }

  /**
   * Text for a delta that spans two environment periods, or null when both
   * points sit in the same period (or either has no period).
   */
  function periodWarning(point, prevPoint, periods) {
    if (!point || !prevPoint || point.period == null || prevPoint.period == null) return null;
    if (point.period === prevPoint.period) return null;
    var later = (periods || []).find(function (p) { return p && p.id === Math.max(point.period, prevPoint.period); });
    var what = later && later.label ? later.label : 'the recorded environment differs';
    return 'Environment changed between these points: ' + what + '. The delta may be the host, not the commit.';
  }

  /** Count of periods, excluding boot-only ones when asked. */
  function periodCount(periods, includeReboots) {
    return (periods || []).filter(function (p) { return p && (includeReboots || !p.boot_only); }).length;
  }

  // ---------------------------------------------------------------- generations

  /**
   * Selector options for a platform manifest's closed generations: the live
   * series first, then each generation (newest first).
   *
   * @returns {Array<{id:string|null,label:string}>}
   */
  function generationOptions(manifest) {
    var gens = manifest && Array.isArray(manifest.generations) ? manifest.generations.slice() : [];
    gens.sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
    var options = [{ id: null, label: 'Live series' }];
    gens.forEach(function (g) {
      if (!g || g.id == null) return;
      var until = g.until ? String(g.until).slice(0, 10) : String(g.id);
      options.push({ id: String(g.id), label: 'History before ' + until + (g.label ? ' (' + shortLabel(g.label, 40) + ')' : '') });
    });
    return options;
  }

  /** `series-x.epoch-v3.json` -> `series-x.epoch-v3.gen-<id>.json`; null id: unchanged. */
  function generationFilename(filename, generationId) {
    if (!generationId) return filename;
    return filename.replace(/\.json$/, '.gen-' + generationId + '.json');
  }

  // ---------------------------------------------------------------- canary

  /**
   * The state a dashboard shows for one runner's canary file
   * ({runner: <canary status entry>}), or null when there is nothing to show.
   *
   * @returns {null|{severity:'alarm'|'warning'|'info', signal:string, delta:number|null,
   *   date:string, phase:string, envChange:string|null, text:string}}
   */
  function canaryState(entry, now, recentDays) {
    var runner = entry && entry.runner ? entry.runner : entry;
    if (!runner || !runner.latest_observation) return null;
    var latest = runner.latest_observation;
    var signal = latest.candidate_signal || 'insufficient-data';
    var delta = typeof latest.delta_pct === 'number' ? latest.delta_pct : null;
    var envChange = latest.env_change_annotation || null;
    var date = latest.utc_date || '';
    var phase = (runner.series && runner.series.phase) || latest.phase || '';
    var recent = isRecent(date, now, recentDays == null ? 7 : recentDays);
    var severity = signal === 'alarm' ? 'alarm' : signal === 'warning' ? 'warning' : 'info';
    var parts = [];
    if (delta != null) parts.push((delta > 0 ? '+' : '') + delta.toFixed(1) + '% vs the 28-day median');
    if (signal !== 'within' && signal !== 'insufficient-data') parts.push(signal);
    if (phase && phase !== 'ready') parts.push(phase + ' phase');
    var text = 'Canary ' + date + ': ' + (parts.length ? parts.join(', ') : signal);
    if (envChange && recent) text += '. Environment changed: ' + shortLabel(envChange, 120);
    return { severity: severity, signal: signal, delta: delta, date: date, phase: phase, envChange: envChange, text: text,
      banner: severity !== 'info' || (envChange != null && recent) };
  }

  function isRecent(utcDate, now, days) {
    if (!utcDate) return false;
    var then = Date.parse(utcDate + 'T00:00:00Z');
    if (isNaN(then)) return false;
    var at = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
    return at - then <= days * 86400000;
  }

  exports.periodMarkers = periodMarkers;
  exports.periodWarning = periodWarning;
  exports.periodCount = periodCount;
  exports.shortLabel = shortLabel;
  exports.generationOptions = generationOptions;
  exports.generationFilename = generationFilename;
  exports.canaryState = canaryState;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.PeriodHelpers = {}));
