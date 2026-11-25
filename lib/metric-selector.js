/**
 * Pure model for the Performance Counters metric selector.
 *
 * The section used to render one fixed panel per manifest *group* (IPC +
 * insn/req + cycles/req on one chart) for the ★ primary workload only. With
 * several workloads selected you could not see, say, IPC for all of them at
 * once. The selector turns that around: the user picks an ordered list of
 * metrics, and the page draws one chart per metric with one line per selected
 * workload (colours = throughput-chart colours).
 *
 * This module owns everything about that selection that does not touch the
 * DOM or the network:
 *   - the metric catalog derived from a platform manifest (`buildCatalog`),
 *   - the ordered selection and its operations (add/remove/move/toggle),
 *   - built-in and user presets,
 *   - localStorage and URL-hash persistence (encode/decode + restore rules).
 *
 * CPU-profile (flamegraph) and TMA groups cannot overlay several workloads
 * (they are stacked breakdowns), so each appears in the catalog as a single
 * "panel" metric whose id is the group id; the renderer draws those for the
 * primary workload only.
 *
 * Kept free of DOM so it is unit-testable under `node --test`.
 */
(function (exports) {
  'use strict';

  // Node: require the sibling module. Browser: lib/perf-groups.js is loaded
  // first and publishes the global `PerfGroups`.
  var Groups = (typeof module !== 'undefined' && module.exports) ? require('./perf-groups.js') : PerfGroups;

  // Human names for the per-thread metric ids the manifest publishes. The id
  // minus its "-main"/"-io" suffix is the key. `axis` is the y-axis title for
  // a single-metric chart; the manifest's shared group axis ("per request")
  // is too vague once each metric has its own chart.
  var METRIC_NAMES = {
    'ipc':                      { name: 'IPC',                   axis: 'instructions per cycle' },
    'instructions-per-req':     { name: 'Instructions / request', axis: 'instructions per request' },
    'cycles-per-req':           { name: 'Cycles / request',       axis: 'cycles per request' },
    'icache-mpki':              { name: 'Icache MPKI',            axis: 'misses per 1K instructions' },
    'llc-mpki':                 { name: 'LLC MPKI',               axis: 'misses per 1K instructions' },
    'branch-mpki':              { name: 'Branch MPKI',            axis: 'mispredicts per 1K instructions' },
    'frontend-stall-pct':       { name: 'Frontend stall %',       axis: '% of cycles stalled' },
    'backend-stall-pct':        { name: 'Backend stall %',        axis: '% of cycles stalled' },
    'syscalls-per-req':         { name: 'Syscalls / request',     axis: 'syscalls per request' },
    'context-switches-per-sec': { name: 'Context switches / s',   axis: 'context switches per second' },
  };

  var THREAD_LABELS = { main: 'Main thread', io: 'IO threads' };

  // Shown when nothing is stored and the URL carries no `metrics=`. Chosen to
  // separate a real change from binary-layout noise on the thread that bounds
  // throughput:
  //   instructions/req  retired-instruction count is layout-immune; if it
  //                     moves, the code path changed (the arbiter)
  //   cycles/req        what a request costs (inverse per-core throughput);
  //                     layout-exposed, but it is the number a regression is about
  //   frontend stall %  the layout-lottery tell: the share of cycles the
  //                     frontend delivered nothing, which is where fetch
  //                     alignment and uop-cache effects land. Calibrated
  //                     2026-10-22 as the strongest tell: clears on about
  //                     half of insn-flat/cycles-moved pairs, 85% in the
  //                     same direction as cycles, ~5x its quiet-pair rate
  //                     (branch and icache MPKI manage ~2x). Not published
  //                     on intel, where the TMA frontend-bound panel carries
  //                     the same signal; the chart is simply absent there.
  //   branch MPKI       a weaker tell (predictor aliasing), and catches
  //                     genuinely new branches
  // icache MPKI was the tell before the calibration: Valkey's hot path fits
  // in L1i (0.1 MPKI on arm64), so the counter is quantisation-dominated and
  // its floor is 30-65%. It stays in the Cache preset. IPC is derived from
  // the first two and layout-exposed, so it cannot tell real from noise on
  // its own; it lives in the "Efficiency" preset.
  var DEFAULT_METRICS = ['instructions-per-req-main', 'cycles-per-req-main', 'frontend-stall-pct-main', 'branch-mpki-main'];
  // The previous default, kept as a built-in preset.
  var EFFICIENCY_METRICS = ['ipc-main', 'instructions-per-req-main', 'cycles-per-req-main'];

  var STORAGE_SELECTION = 'perfMetrics';
  var STORAGE_PRESETS = 'perfMetricPresets';
  var MAX_PRESET_NAME = 40;

  function isCpuGroup(id) { return id === 'cpu-main' || id === 'cpu-io'; }
  function isTmaGroup(id) { return id === 'tma' || id === 'tma-main' || id === 'tma-io'; }

  /** Split "ipc-main" into {base:"ipc", thread:"main"}; thread is null when there is no suffix. */
  function splitThread(id) {
    var m = /^(.*)-(main|io)$/.exec(String(id || ''));
    return m ? { base: m[1], thread: m[2] } : { base: String(id || ''), thread: null };
  }

  function humanize(base) {
    return String(base).replace(/-/g, ' ').replace(/\bpct\b/g, '%').replace(/\bper\b/g, '/');
  }

  /** Short metric name without the thread, e.g. "IPC" or "Icache MPKI". */
  function metricName(id) {
    var s = splitThread(id);
    var known = METRIC_NAMES[s.base];
    return known ? known.name : humanize(s.base);
  }

  /** Chart title: "IPC — Main thread". Group panels keep the manifest title. */
  function metricTitle(entry) {
    if (entry.kind !== 'line') return entry.groupTitle || entry.label;
    return entry.thread ? entry.label + ' — ' + THREAD_LABELS[entry.thread] : entry.label;
  }

  /**
   * Build the selectable catalog from a platform manifest's groups, in the
   * dashboard's decision-first display order (lib/perf-groups.js).
   *
   * @param {Array} groups manifest groups ({id, title, series, y_axes})
   * @returns {Array<{id, label, title, group, groupTitle, thread, kind:'line'|'cpu'|'tma', axisLabel}>}
   */
  function buildCatalog(groups) {
    var out = [];
    Groups.orderPerfGroups(groups).forEach(function (g) {
      var thread = splitThread(g.id).thread;
      if (isCpuGroup(g.id) || isTmaGroup(g.id)) {
        var kind = isCpuGroup(g.id) ? 'cpu' : 'tma';
        var axis = (g.y_axes && g.y_axes[0] && g.y_axes[0].label) || (kind === 'cpu' ? '% of samples' : '%');
        out.push({ id: g.id, label: g.title || g.id, title: g.title || g.id, group: g.id, groupTitle: g.title || g.id, thread: thread, kind: kind, axisLabel: axis });
        return;
      }
      (g.series || []).forEach(function (metricId) {
        var s = splitThread(metricId);
        var known = METRIC_NAMES[s.base];
        var manifestAxis = null;
        (g.y_axes || []).forEach(function (a) { if (a.series && a.series.indexOf(metricId) >= 0) manifestAxis = a.label; });
        var entry = {
          id: metricId, label: metricName(metricId), group: g.id, groupTitle: g.title || g.id,
          thread: s.thread, kind: 'line', axisLabel: (known && known.axis) || manifestAxis || '',
        };
        entry.title = metricTitle(entry);
        out.push(entry);
      });
    });
    return out;
  }

  function catalogIds(catalog) { return (catalog || []).map(function (e) { return e.id; }); }

  /** Keep only ids the catalog knows, preserving order and dropping duplicates. */
  function sanitize(ids, catalog) {
    var known = {}; catalogIds(catalog).forEach(function (id) { known[id] = true; });
    var seen = {}; var out = [];
    (ids || []).forEach(function (id) {
      if (known[id] && !seen[id]) { seen[id] = true; out.push(id); }
    });
    return out;
  }

  function addMetric(selection, id) {
    var sel = (selection || []).slice();
    if (sel.indexOf(id) < 0) sel.push(id);
    return sel;
  }

  function removeMetric(selection, id) {
    return (selection || []).filter(function (m) { return m !== id; });
  }

  function toggleMetric(selection, id) {
    return (selection || []).indexOf(id) >= 0 ? removeMetric(selection, id) : addMetric(selection, id);
  }

  /** Move `id` by `delta` positions (negative = up). Clamped; unknown id is a no-op. */
  function moveMetric(selection, id, delta) {
    var sel = (selection || []).slice();
    var i = sel.indexOf(id);
    if (i < 0 || !delta) return sel;
    var j = Math.max(0, Math.min(sel.length - 1, i + delta));
    if (j === i) return sel;
    sel.splice(i, 1);
    sel.splice(j, 0, id);
    return sel;
  }

  /** Add every catalog metric of one group that is not yet selected, in catalog order. */
  function addGroup(selection, catalog, groupId) {
    var sel = (selection || []).slice();
    (catalog || []).forEach(function (e) {
      if (e.group === groupId && sel.indexOf(e.id) < 0) sel.push(e.id);
    });
    return sel;
  }

  /** Catalog entries grouped for the "Available" list: [{group, groupTitle, entries}] in catalog order. */
  function groupedCatalog(catalog) {
    var out = []; var byGroup = {};
    (catalog || []).forEach(function (e) {
      if (!byGroup[e.group]) { byGroup[e.group] = { group: e.group, groupTitle: e.groupTitle, entries: [] }; out.push(byGroup[e.group]); }
      byGroup[e.group].entries.push(e);
    });
    return out;
  }

  function sameSelection(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------

  /**
   * Built-in presets, resolved against the catalog so each only lists metrics
   * this platform publishes. Empty presets are dropped (e.g. "Kernel" on a
   * manifest without syscall counters).
   */
  function builtinPresets(catalog) {
    var cat = catalog || [];
    function pick(pred) { return cat.filter(pred).map(function (e) { return e.id; }); }
    var defs = [
      { id: 'default',    name: 'Default',      metrics: sanitize(DEFAULT_METRICS, cat) },
      { id: 'efficiency', name: 'Efficiency',   metrics: sanitize(EFFICIENCY_METRICS, cat) },
      { id: 'main',       name: 'Main thread',  metrics: pick(function (e) { return e.kind === 'line' && e.thread === 'main'; }) },
      { id: 'io',      name: 'IO threads',   metrics: pick(function (e) { return e.kind === 'line' && e.thread === 'io'; }) },
      { id: 'cache',   name: 'Cache',        metrics: pick(function (e) { return /^(cache|branching)/.test(e.group); }) },
      { id: 'kernel',  name: 'Kernel',       metrics: pick(function (e) { return /^(syscalls|context-switches|kernel)/.test(e.group); }) },
      { id: 'profile', name: 'Profiles',     metrics: pick(function (e) { return e.kind !== 'line'; }) },
      { id: 'all',     name: 'All',          metrics: catalogIds(cat) },
    ];
    return defs.filter(function (p) { return p.metrics.length > 0; })
      .map(function (p) { p.builtin = true; return p; });
  }

  function normalizePresetName(name) {
    return String(name == null ? '' : name).trim().slice(0, MAX_PRESET_NAME);
  }

  /** Add or replace (by name, case-insensitive) a user preset. Returns the new list; empty name/metrics are a no-op. */
  function savePreset(presets, name, metrics) {
    var n = normalizePresetName(name);
    var list = (presets || []).slice();
    if (!n || !metrics || !metrics.length) return list;
    var idx = -1;
    list.forEach(function (p, i) { if (p.name.toLowerCase() === n.toLowerCase()) idx = i; });
    var entry = { name: n, metrics: metrics.slice() };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    return list;
  }

  function deletePreset(presets, name) {
    var n = normalizePresetName(name).toLowerCase();
    return (presets || []).filter(function (p) { return p.name.toLowerCase() !== n; });
  }

  /** Name of the preset (built-in or user) whose metrics equal the selection exactly, else null. */
  function matchingPreset(selection, presets) {
    var hit = null;
    (presets || []).forEach(function (p) { if (hit === null && sameSelection(p.metrics, selection)) hit = p.name; });
    return hit;
  }

  // ---------------------------------------------------------------------------
  // Persistence: localStorage
  // ---------------------------------------------------------------------------

  function readJson(store, key) {
    if (!store) return null;
    try { var raw = store.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  function writeJson(store, key, value) {
    if (!store) return false;
    try { store.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  /** Stored selection as an array of ids, or null when nothing valid is stored. */
  function readSelection(store) {
    var v = readJson(store, STORAGE_SELECTION);
    if (!Array.isArray(v)) return null;
    return v.filter(function (x) { return typeof x === 'string'; });
  }

  function writeSelection(store, ids) { return writeJson(store, STORAGE_SELECTION, ids || []); }

  /** Stored user presets ([{name, metrics}]), dropping malformed entries. */
  function readPresets(store) {
    var v = readJson(store, STORAGE_PRESETS);
    if (!Array.isArray(v)) return [];
    return v.filter(function (p) { return p && typeof p.name === 'string' && Array.isArray(p.metrics); })
      .map(function (p) { return { name: normalizePresetName(p.name), metrics: p.metrics.filter(function (x) { return typeof x === 'string'; }) }; })
      .filter(function (p) { return p.name && p.metrics.length; });
  }

  function writePresets(store, presets) { return writeJson(store, STORAGE_PRESETS, presets || []); }

  // ---------------------------------------------------------------------------
  // Persistence: URL hash
  // ---------------------------------------------------------------------------

  function encodeMetrics(ids) { return (ids || []).join(','); }

  function decodeMetrics(param) {
    if (!param) return [];
    return String(param).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /**
   * Choose the selection to show on load. Precedence:
   *   1. a `metrics=` hash parameter with at least one metric the catalog knows
   *      (a shared link must show what the sender saw),
   *   2. the stored selection, if it still names at least one known metric,
   *   3. DEFAULT_METRICS (restricted to the catalog).
   * Returns {selection, source} where source is 'hash' | 'storage' | 'default'.
   */
  function resolveInitialSelection(hashParam, stored, catalog) {
    var fromHash = sanitize(decodeMetrics(hashParam), catalog);
    if (fromHash.length) return { selection: fromHash, source: 'hash' };
    var fromStore = sanitize(stored, catalog);
    if (fromStore.length) return { selection: fromStore, source: 'storage' };
    return { selection: sanitize(DEFAULT_METRICS, catalog), source: 'default' };
  }

  /** `metrics=` value for the hash, or null when the selection is the default (keeps default URLs short). */
  function hashValue(selection, catalog) {
    if (sameSelection(selection, sanitize(DEFAULT_METRICS, catalog))) return null;
    return encodeMetrics(selection);
  }

  /**
   * Toggle-button text: "Perf metrics: Default" when a preset matches exactly,
   * else "3 perf metrics". The toggle sits in the page header, so the label
   * says which section it governs.
   */
  function summaryLabel(selection, presets) {
    var n = (selection || []).length;
    var preset = matchingPreset(selection, presets);
    if (preset) return 'Perf metrics: ' + preset;
    return n === 1 ? '1 perf metric' : n + ' perf metrics';
  }

  exports.METRIC_NAMES = METRIC_NAMES;
  exports.THREAD_LABELS = THREAD_LABELS;
  exports.DEFAULT_METRICS = DEFAULT_METRICS;
  exports.EFFICIENCY_METRICS = EFFICIENCY_METRICS;
  exports.STORAGE_SELECTION = STORAGE_SELECTION;
  exports.STORAGE_PRESETS = STORAGE_PRESETS;
  exports.splitThread = splitThread;
  exports.metricName = metricName;
  exports.metricTitle = metricTitle;
  exports.buildCatalog = buildCatalog;
  exports.groupedCatalog = groupedCatalog;
  exports.sanitize = sanitize;
  exports.addMetric = addMetric;
  exports.removeMetric = removeMetric;
  exports.toggleMetric = toggleMetric;
  exports.moveMetric = moveMetric;
  exports.addGroup = addGroup;
  exports.sameSelection = sameSelection;
  exports.builtinPresets = builtinPresets;
  exports.savePreset = savePreset;
  exports.deletePreset = deletePreset;
  exports.matchingPreset = matchingPreset;
  exports.readSelection = readSelection;
  exports.writeSelection = writeSelection;
  exports.readPresets = readPresets;
  exports.writePresets = writePresets;
  exports.encodeMetrics = encodeMetrics;
  exports.decodeMetrics = decodeMetrics;
  exports.resolveInitialSelection = resolveInitialSelection;
  exports.hashValue = hashValue;
  exports.summaryLabel = summaryLabel;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.MetricSelector = {}));
