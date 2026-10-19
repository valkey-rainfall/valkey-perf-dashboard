/**
 * Pure helpers for perf-counter privilege scope (`points[].scope`).
 *
 * Conductress tags every perf-counter point with the scope its counters were
 * collected under: "user" (perf stat ran unprivileged, everything before
 * Conductress PR #196) or "user+kernel" (after). Counts from different scopes
 * are not comparable -- kernel work was ~20% of IO-thread cycles at P16 and
 * more at depth 1 -- so a series that changes scope mid-history has a step at
 * the deploy date that is not a code change. Drawn as one continuous line it
 * reads as a +171% cycles/req regression on the commit that happened to land
 * that day.
 *
 * The exporter's contract (conductress/sweep/exporter.py) is that the
 * dashboard draws scopes as separate runs. These helpers do the splitting;
 * index.html turns each run into its own Chart.js dataset.
 *
 * Kept free of DOM and Chart.js so it is unit-testable under `node --test`.
 */
(function (exports) {
  'use strict';

  // Scope assumed for points that predate the field. Mirrors
  // LEGACY_PERF_SCOPE in conductress/sweep/exporter.py: perf stat ran
  // unprivileged until PR #196, so every untagged point is user-space only.
  var LEGACY_SCOPE = 'user';

  // Dash patterns by order of first appearance in a series: the first scope is
  // solid, later scopes are dashed so the eye reads "different run" rather
  // than "the line jumped".
  var RUN_DASHES = [[], [5, 3], [2, 2], [8, 3, 2, 3]];

  function pointScope(p) {
    return (p && p.scope) || LEGACY_SCOPE;
  }

  /**
   * Split commit-ordered points into maximal runs of one scope.
   *
   * A new run starts every time the scope changes, so A,A,B,B,A yields three
   * runs (not two): the point is that no line segment is ever drawn between
   * two points of different scope.
   *
   * @param {Array} points  sorted by commit_index
   * @returns {Array<{scope:string, points:Array}>}
   */
  function splitByScope(points) {
    var runs = [];
    var cur = null;
    (points || []).forEach(function (p) {
      var s = pointScope(p);
      if (!cur || cur.scope !== s) { cur = { scope: s, points: [] }; runs.push(cur); }
      cur.points.push(p);
    });
    return runs;
  }

  /**
   * Distinct scopes in first-seen order. Matches the exporter's
   * `metadata.scopes`, but computed from the points so a series file without
   * the metadata field (or a stale one) still works.
   */
  function scopesOf(points) {
    var seen = [];
    (points || []).forEach(function (p) {
      var s = pointScope(p);
      if (seen.indexOf(s) < 0) seen.push(s);
    });
    return seen;
  }

  /**
   * Commit indices at which the scope changes, with the scope on each side.
   * Used for a vertical marker on the chart; empty for a single-scope series.
   *
   * @returns {Array<{commit_index:number, from:string, to:string}>}
   */
  function scopeBoundaries(points) {
    var out = [];
    var runs = splitByScope(points);
    for (var i = 1; i < runs.length; i++) {
      out.push({ commit_index: runs[i].points[0].commit_index, from: runs[i - 1].scope, to: runs[i].scope });
    }
    return out;
  }

  /**
   * Describe the datasets a metric needs: one per scope run.
   *
   * Labels carry the scope only when the series actually has more than one,
   * so the common single-scope case renders exactly as before. The dash
   * pattern is keyed by the scope's first-appearance order across the whole
   * series (not the run's position), so A,B,A draws both A runs solid and the
   * B run dashed.
   *
   * @param {string} metricId
   * @param {Array}  points    sorted by commit_index
   * @returns {Array<{label:string, scope:string, borderDash:number[], data:Array<{x:number,y:number}>, legend:boolean}>}
   *          `legend` is false for every run after the first of a given scope,
   *          so a scope that reappears does not get a duplicate legend entry.
   */
  function scopeDatasets(metricId, points) {
    var scopes = scopesOf(points);
    var multi = scopes.length > 1;
    var legendShown = {};
    return splitByScope(points).map(function (run) {
      var order = scopes.indexOf(run.scope);
      var first = !legendShown[run.scope];
      legendShown[run.scope] = true;
      return {
        label: multi ? metricId + ' (' + run.scope + ')' : metricId,
        scope: run.scope,
        borderDash: RUN_DASHES[order % RUN_DASHES.length],
        data: run.points.map(function (p) { return { x: p.commit_index, y: p.value }; }),
        legend: first,
      };
    });
  }

  /**
   * Delta between two points of the same metric, or null when their scopes
   * differ (the difference would be the scope step, not a code change).
   *
   * @returns {{delta:number, comparable:true}|{comparable:false, from:string, to:string}|null}
   *          null when either point is missing
   */
  function scopedDelta(cur, prev) {
    if (!cur || !prev) return null;
    var a = pointScope(prev), b = pointScope(cur);
    if (a !== b) return { comparable: false, from: a, to: b };
    return { comparable: true, delta: cur.value - prev.value };
  }

  exports.LEGACY_SCOPE = LEGACY_SCOPE;
  exports.pointScope = pointScope;
  exports.splitByScope = splitByScope;
  exports.scopesOf = scopesOf;
  exports.scopeBoundaries = scopeBoundaries;
  exports.scopeDatasets = scopeDatasets;
  exports.scopedDelta = scopedDelta;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.ScopeHelpers = {}));
