/**
 * Pure helpers for a multi-series selection that may span platforms (and, in
 * principle, engines) on the Performance History page.
 *
 * Every history-scope engine shares one commit timeline, and every platform
 * sweeps the same commit list, so any combination of series can share the
 * x axis. What has to change when a selection crosses platforms is the
 * labelling (which platform is which line) and the shareable URL hash (which
 * platform each entry belongs to).
 *
 * Kept free of DOM so it is unit-testable under `node --test`.
 */
(function (exports) {
  'use strict';

  function distinct(values) {
    var seen = {}; var out = [];
    values.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
    return out;
  }

  /**
   * Chart/legend label for one selected series. The workload label is always
   * present; the platform label is prepended when the selection spans more
   * than one platform, and the engine label when it spans more than one
   * engine, so single-context selections read exactly as before.
   *
   * @param {Object} sel          {engine, platform, workloadId}
   * @param {Array}  selections   the whole selection
   * @param {Object} names        {workload(id) -> label, platform(id) -> label, engine(id) -> label}
   */
  function seriesLabel(sel, selections, names) {
    var all = selections || [sel];
    var parts = [];
    if (distinct(all.map(function (s) { return s.engine; })).length > 1) parts.push(names.engine(sel.engine));
    if (distinct(all.map(function (s) { return s.platform; })).length > 1) parts.push(names.platform(sel.platform));
    parts.push(names.workload(sel.workloadId));
    return parts.join(' · ');
  }

  /**
   * Encode the `workloads=` hash parameter. Entries are `platform:workloadId`
   * when any selection is on a platform other than `primaryPlatform` (the one
   * the `platform=` parameter already names); otherwise bare ids, which is the
   * form older bookmarks carry.
   */
  function encodeWorkloads(selections, primaryPlatform) {
    var sels = selections || [];
    var mixed = sels.some(function (s) { return s.platform !== primaryPlatform; });
    return sels.map(function (s) { return mixed ? s.platform + ':' + s.workloadId : s.workloadId; }).join(',');
  }

  /**
   * Decode the `workloads=` hash parameter into selections. A `platform:id`
   * entry names its own platform; a bare id (older bookmarks) inherits
   * `fallbackPlatform`. Empty entries are dropped.
   */
  function decodeWorkloads(param, fallbackPlatform, engine) {
    if (!param) return [];
    return String(param).split(',').map(function (e) { return e.trim(); }).filter(Boolean).map(function (entry) {
      var i = entry.indexOf(':');
      var platform = i > 0 ? entry.slice(0, i) : fallbackPlatform;
      var workloadId = i > 0 ? entry.slice(i + 1) : entry;
      return { engine: engine, platform: platform, workloadId: workloadId };
    });
  }

  exports.seriesLabel = seriesLabel;
  exports.encodeWorkloads = encodeWorkloads;
  exports.decodeWorkloads = decodeWorkloads;
})(typeof module !== 'undefined' && module.exports ? module.exports : (this.SelectionHelpers = {}));
