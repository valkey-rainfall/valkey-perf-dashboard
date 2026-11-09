/**
 * period-helpers.js -- series generations and canary state.
 *
 * Pure functions shared by index.html (generation selector, canary link) and
 * status.html (canary row on a runner card). The data comes from the
 * exporter (platform manifest "generations") and from the control service's
 * static canary files (canary/<runner>.json, canary/findings.json).
 *
 * A generation is a read-only slice of a platform's series before an
 * operator cut the series at an environment change (close-generation).
 * The main charts draw no environment markers; a separate canary page
 * shows environment events.
 *
 * Browser: loaded via <script src="lib/period-helpers.js">.
 * Node:    const P = require('./lib/period-helpers.js');
 */
'use strict';

(function (exports) {

  // ---------------------------------------------------------------- generations

  /**
   * Selector options for a platform manifest's closed generations: the live
   * series first, then each generation (newest first). `label` is short so
   * the select stays narrow; `title` carries the long text for a tooltip.
   *
   * @returns {Array<{id:string|null,label:string,title:string}>}
   */
  function generationOptions(manifest) {
    var gens = manifest && Array.isArray(manifest.generations) ? manifest.generations.slice() : [];
    gens.sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
    var options = [{ id: null, label: 'Live series', title: 'Live series' }];
    gens.forEach(function (g) {
      if (!g || g.id == null) return;
      var until = g.until ? String(g.until).slice(0, 10) : String(g.id);
      var label = 'Before ' + until;
      options.push({ id: String(g.id), label: label,
        title: 'Archived history before ' + until + (g.label ? ' (' + g.label + ')' : '') });
    });
    return options;
  }

  /** `series-x.epoch-v3.json` -> `series-x.epoch-v3.gen-<id>.json`; null id: unchanged. */
  function generationFilename(filename, generationId) {
    if (!generationId) return filename;
    return filename.replace(/\.json$/, '.gen-' + generationId + '.json');
  }

  /** The manifest's generation entry with this id, or null. */
  function findGeneration(manifest, generationId) {
    if (!generationId || !manifest || !Array.isArray(manifest.generations)) return null;
    return manifest.generations.find(function (g) { return g && String(g.id) === String(generationId); }) || null;
  }

  /**
   * Whether a series file exists for this metric and workload.
   * Without a generation every series is fetched as before. With one, only
   * throughput and latency series of the workloads the generation lists
   * exist; memory and perf-counter series are not archived. A generation the
   * manifest does not list has no files.
   *
   * @param {Object|null} manifest   platform manifest (with `generations`)
   * @param {string|null} generationId
   * @param {string} fileId          workload file id, e.g. "get-k16-v16-t7-p10"
   * @param {string} metric          "throughput", "latency", "memory" or a perf metric id
   * @returns {boolean}
   */
  function generationHasSeries(manifest, generationId, fileId, metric) {
    if (!generationId) return true;
    if (metric !== 'throughput' && metric !== 'latency') return false;
    var g = findGeneration(manifest, generationId);
    if (!g || !Array.isArray(g.workloads)) return false;
    return g.workloads.indexOf(fileId) !== -1;
  }

  // ---------------------------------------------------------------- canary

  // Keys whose old and new values are private or long; each change is shown
  // as a plain phrase instead.
  var ENV_KEY_PHRASES = {
    conductress_revision: 'harness revision changed',
    cachecannon_commit: 'load generator changed',
    boot_id: 'reboot',
    instance_id: 'host replaced',
    host_fingerprint: 'host replaced',
  };
  var MAX_VALUE_CHARS = 24;

  function cutValue(v) {
    v = String(v).trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
    return v.length > MAX_VALUE_CHARS ? v.slice(0, MAX_VALUE_CHARS - 3) + '...' : v;
  }

  /**
   * A short, safe label for an env_change_annotation
   * ("key: old -> new; key: old -> new"). Known keys become phrases; other
   * keys keep "key: old -> new" with each value cut to 24 characters.
   * Repeated phrases are shown once. Returns null for an empty annotation.
   */
  function envChangeLabel(annotation) {
    if (!annotation) return null;
    var out = [];
    String(annotation).split(';').forEach(function (item) {
      item = item.trim();
      if (!item) return;
      var m = item.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*->\s*(.*)$/);
      var text;
      if (!m) text = cutValue(item);
      else if (ENV_KEY_PHRASES[m[1]]) text = ENV_KEY_PHRASES[m[1]];
      else text = m[1] + ': ' + cutValue(m[2]) + ' -> ' + cutValue(m[3]);
      if (out.indexOf(text) === -1) out.push(text);
    });
    return out.length ? out.join('; ') : null;
  }

  /**
   * The state a dashboard shows for one runner's canary file
   * ({runner: <canary status entry>}), or null when there is nothing to show.
   * Only a warning or alarm signal sets a severity other than 'info' and a
   * banner; an environment change alone (for example a harness deploy) is
   * named in the text but never raises a banner.
   *
   * @returns {null|{severity:'alarm'|'warning'|'info', signal:string, delta:number|null,
   *   date:string, phase:string, envChange:string|null, text:string, banner:boolean}}
   */
  function canaryState(entry, now, recentDays) {
    var runner = entry && entry.runner ? entry.runner : entry;
    if (!runner || !runner.latest_observation) return null;
    var latest = runner.latest_observation;
    var signal = latest.candidate_signal || 'insufficient-data';
    var delta = typeof latest.delta_pct === 'number' ? latest.delta_pct : null;
    var envChange = envChangeLabel(latest.env_change_annotation);
    var date = latest.utc_date || '';
    var phase = (runner.series && runner.series.phase) || latest.phase || '';
    var recent = isRecent(date, now, recentDays == null ? 7 : recentDays);
    var severity = signal === 'alarm' ? 'alarm' : signal === 'warning' ? 'warning' : 'info';
    var parts = [];
    if (delta != null) parts.push((delta > 0 ? '+' : '') + delta.toFixed(1) + '% vs the 28-day median');
    if (signal !== 'within' && signal !== 'insufficient-data') parts.push(signal);
    if (phase && phase !== 'ready') parts.push(phase + ' phase');
    var text = 'Canary ' + date + ': ' + (parts.length ? parts.join(', ') : signal);
    if (envChange && recent) text += '. Environment changed: ' + envChange;
    return { severity: severity, signal: signal, delta: delta, date: date, phase: phase, envChange: envChange, text: text,
      banner: severity !== 'info' };
  }

  function isRecent(utcDate, now, days) {
    if (!utcDate) return false;
    var then = Date.parse(utcDate + 'T00:00:00Z');
    if (isNaN(then)) return false;
    var at = nowMs(now);
    return at - then <= days * 86400000;
  }

  function nowMs(now) {
    return now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  }

  var FINDINGS_MAX_AGE_MS = 26 * 3600000;

  /**
   * Text for the header link to the canary page, from canary/findings.json.
   * Fresh findings (generated_at within 26 h) give the open count; a missing,
   * stale or unreadable file gives a plain muted 'Canary'. The link never
 * takes an alarm colour.
   *
   * @param {Object|null} findings  parsed findings.json, or null
   * @param {Date|number} [now]
   * @returns {{text:string, muted:boolean}}
   */
  function canaryLinkState(findings, now) {
    var plain = { text: 'Canary', muted: true };
    if (!findings || typeof findings !== 'object') return plain;
    var at = Date.parse(findings.generated_at);
    if (isNaN(at)) return plain;
    var age = nowMs(now) - at;
    if (age > FINDINGS_MAX_AGE_MS) return plain;
    var n = findings.open_count;
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return plain;
    n = Math.floor(n);
    if (n === 0) return { text: 'Canary: no open findings', muted: false };
    return { text: 'Canary: ' + n + ' open finding' + (n === 1 ? '' : 's'), muted: false };
  }

  /** `canary.html#runner=<id>` for a runner id, or plain `canary.html`. */
  function canaryPageHref(runnerId) {
    return runnerId ? 'canary.html#runner=' + encodeURIComponent(runnerId) : 'canary.html';
  }

  exports.generationOptions = generationOptions;
  exports.generationFilename = generationFilename;
  exports.findGeneration = findGeneration;
  exports.generationHasSeries = generationHasSeries;
  exports.envChangeLabel = envChangeLabel;
  exports.canaryState = canaryState;
  exports.canaryLinkState = canaryLinkState;
  exports.canaryPageHref = canaryPageHref;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.PeriodHelpers = {}));
