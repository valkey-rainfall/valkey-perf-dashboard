/**
 * Pure helpers for the "which workload are these charts about?" badge on the
 * Performance History page.
 *
 * The throughput chart overlays every selected workload, but the detail
 * sections below it are driven by ONE selection: the primary (★) workload.
 * Performance Counters and Request Latency follow the primary workload itself;
 * Memory Overhead follows only the primary's platform (its series are keyed by
 * platform, not by throughput workload). Without a label, a reader with three
 * workloads selected has no way to tell which one the IPC chart belongs to
 * short of reopening the selector and hunting for the star.
 *
 * `scopeBadge` turns the current selection into a badge (swatch colour + text)
 * and, when there is anything to be confused about, a one-line note.
 *
 * Kept free of DOM so it is unit-testable under `node --test`.
 */
(function (exports) {
  'use strict';

  var NOTE_WORKLOAD = 'Showing the ★ primary only. Click ★ in the workload selector to switch.';
  var NOTE_PLATFORM = "Showing the ★ primary's platform only. Star a workload on another platform to switch.";

  function distinctPlatforms(selections) {
    var seen = {}; var n = 0;
    (selections || []).forEach(function (s) { if (!seen[s.platform]) { seen[s.platform] = true; n++; } });
    return n;
  }

  function sameSelection(a, b) {
    return !!a && !!b && a.engine === b.engine && a.platform === b.platform && a.workloadId === b.workloadId;
  }

  /**
   * Build the badge for one detail section.
   *
   * @param {Object|null} primary     {engine, platform, workloadId} or null
   * @param {Array}       selections  every selected series, in display order
   *                                  (index == throughput-chart colour index)
   * @param {Object}      names       {workload(id) -> label, platform(id) -> label}
   * @param {Array}       colors      the multi-series palette the throughput
   *                                  chart uses, indexed by selection position
   * @param {string}      scope       'workload' (perf counters, latency) or
   *                                  'platform' (memory)
   * @returns {{text:string, color:string, note:string|null}|null}
   *          null when there is no primary (nothing is selected)
   */
  function scopeBadge(primary, selections, names, colors, scope) {
    if (!primary) return null;
    var sels = selections || [];
    var idx = -1;
    for (var i = 0; i < sels.length; i++) { if (sameSelection(sels[i], primary)) { idx = i; break; } }
    var palette = colors && colors.length ? colors : ['currentColor'];
    var color = idx >= 0 ? palette[idx % palette.length] : palette[0];
    var platformLabel = names.platform(primary.platform);

    if (scope === 'platform') {
      return {
        text: platformLabel,
        color: color,
        note: distinctPlatforms(sels) > 1 ? NOTE_PLATFORM : null,
      };
    }
    return {
      text: names.workload(primary.workloadId) + ' · ' + platformLabel,
      color: color,
      note: sels.length > 1 ? NOTE_WORKLOAD : null,
    };
  }

  exports.scopeBadge = scopeBadge;
  exports.NOTE_WORKLOAD = NOTE_WORKLOAD;
  exports.NOTE_PLATFORM = NOTE_PLATFORM;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.ScopeBadge = {}));
