/**
 * Engine-neutral memory helpers for compare.html.
 * Browser: loaded via <script src="lib/memory-helpers.js">.
 * Node tests: required via require().
 *
 * One definition for every engine:
 *   overhead = point.results[w].rps   (bytes per item, measured)
 *   total    = exported point.memory.total_bytes_per_item, else overhead + user data
 * The heap-profile `breakdown` is a split inside the total, never its source.
 */

(function (exports) {
  'use strict';

  // Redis points before this date on these series are known to be too high
  // (not settled). Applies only when `memory.settled` is unknown (null or absent).
  var UNSETTLED_BEFORE = '2026-10-20';
  var PRE_EXPORTER_SERIES = [
    'memory-set-k16-v64', 'memory-set-k16-v64-expire', 'memory-sadd-m20',
    'memory-hset-f64-v64', 'memory-zadd-m20',
  ];

  function finite(x) { return typeof x === 'number' && isFinite(x); }

  /**
   * User data bytes per item: series metadata first, then the fallback table.
   * metadata.user_data_bytes may be a number or a map keyed by workload id.
   * Returns null when unknown (never 0).
   */
  function userDataFor(series, workloadId, fallback) {
    var md = series && series.metadata ? series.metadata.user_data_bytes : undefined;
    if (finite(md) && md > 0) return md;
    if (md && typeof md === 'object' && finite(md[workloadId]) && md[workloadId] > 0) return md[workloadId];
    var fb = fallback && fallback[workloadId];
    return finite(fb) && fb > 0 ? fb : null;
  }

  /** The result object of a point for a workload (Redis keys may carry a prefix). */
  function resultFor(point, workloadId) {
    if (!point || !point.results) return null;
    return point.results[workloadId] || point.results['redis-' + workloadId] ||
      point.results[workloadId.replace('memory-', 'memory-redis-')] || null;
  }

  /**
   * Why a point is hidden by default, or null when it is shown.
   * Order: unsettled, empty date, known-too-high Redis point.
   */
  function hiddenReason(point, engine, workloadId) {
    if (!point) return 'no point';
    var settled = point.memory ? point.memory.settled : undefined;
    if (settled === false) return 'not settled';
    if (!point.date) return 'no date';
    if ((settled === null || settled === undefined) && engine === 'redis' &&
        PRE_EXPORTER_SERIES.indexOf(workloadId) >= 0 &&
        String(point.date).slice(0, 10) < UNSETTLED_BEFORE) {
      return 'measured before settling was exported';
    }
    return null;
  }

  /**
   * Overhead, total and percent inputs for one point.
   * Returns null when the point has no overhead for the workload.
   * total is null when neither an exported total nor user data is known.
   */
  function pointMemory(point, series, workloadId, fallback) {
    var r = resultFor(point, workloadId);
    if (!r || !finite(r.rps)) return null;
    var userData = userDataFor(series, workloadId, fallback);
    var total = null;
    var mem = point.memory || {};
    if (finite(mem.total_bytes_per_item)) total = mem.total_bytes_per_item;
    else if (userData !== null) total = r.rps + userData;
    return {
      overhead: r.rps, total: total, userData: userData,
      cv: r.cv, reps: r.reps, date: point.date || '', commit: point.commit,
      breakdown: point.breakdown || null,
      rss: finite(mem.rss_bytes_per_item) ? mem.rss_bytes_per_item : null,
      n: finite(mem.n) ? mem.n : null,
    };
  }

  /**
   * Point for a release: only a point exactly at the landmark (same commit or
   * same commit_index). status: 'ok' | 'hidden' | 'none'. A hidden point is
   * returned only when showHidden is true.
   */
  function releasePoint(series, landmark, engine, workloadId, showHidden) {
    if (!series || !series.points || !landmark) return { status: 'none' };
    var hit = null;
    for (var i = 0; i < series.points.length; i++) {
      var p = series.points[i];
      if ((landmark.commit && p.commit === landmark.commit) ||
          (finite(landmark.commit_index) && p.commit_index === landmark.commit_index)) {
        if (resultFor(p, workloadId)) { hit = p; break; }
      }
    }
    if (!hit) return { status: 'none' };
    var why = hiddenReason(hit, engine, workloadId);
    if (why && !showHidden) return { status: 'none', hiddenReason: why };
    return { status: why ? 'hidden' : 'ok', point: hit, hiddenReason: why };
  }

  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  /**
   * Latest value. pickTip(series) returns the tip point for a
   * release-and-tip series (FreshnessHelpers.headPoint wrapper). A history
   * series uses the median of the last five shown points.
   */
  function latestPoint(series, scope, engine, workloadId, showHidden, pickTip) {
    if (!series || !series.points || series.points.length === 0) return { status: 'none' };
    var shown = [], anyHidden = null;
    series.points.forEach(function (p) {
      if (!resultFor(p, workloadId)) return;
      var why = hiddenReason(p, engine, workloadId);
      if (why && !showHidden) { anyHidden = why; return; }
      shown.push({ p: p, why: why });
    });
    if (shown.length === 0) return { status: 'none', hiddenReason: anyHidden };
    if (scope === 'release-and-tip') {
      var tip = pickTip ? pickTip({ metadata: series.metadata, points: shown.map(function (x) { return x.p; }) }) : null;
      var pt = tip ? tip.point : null;
      if (!pt) return { status: 'none', hiddenReason: anyHidden };
      var why1 = hiddenReason(pt, engine, workloadId);
      return { status: why1 ? 'hidden' : 'ok', points: [pt], hiddenReason: why1 };
    }
    var recent = shown.slice(-5);
    return {
      status: recent.some(function (x) { return x.why; }) ? 'hidden' : 'ok',
      points: recent.map(function (x) { return x.p; }),
      hiddenReason: recent.reduce(function (a, x) { return a || x.why; }, null),
    };
  }

  /** Collapse one or more points into one memory value (median when several). */
  function summarize(points, series, workloadId, fallback) {
    var ms = points.map(function (p) { return pointMemory(p, series, workloadId, fallback); })
      .filter(function (m) { return m; });
    if (ms.length === 0) return null;
    var last = ms[ms.length - 1];
    var totals = ms.map(function (m) { return m.total; }).filter(finite);
    var rsss = ms.map(function (m) { return m.rss; }).filter(finite);
    var reps = ms.reduce(function (s, m) { return s + (finite(m.reps) ? m.reps : 0); }, 0);
    var cvs = ms.filter(function (m) { return finite(m.cv); });
    return {
      overhead: median(ms.map(function (m) { return m.overhead; })),
      total: totals.length === ms.length ? median(totals) : null,
      userData: last.userData,
      rss: rsss.length === ms.length ? median(rsss) : null,
      cv: cvs.length ? Math.sqrt(cvs.reduce(function (s, m) { return s + m.cv * m.cv; }, 0) / cvs.length) : 0,
      reps: reps, date: last.date, commit: last.commit, breakdown: last.breakdown, n: last.n,
      points: ms.length,
    };
  }

  /** Percent difference of overhead only: (a - b) / b * 100, or null. */
  function overheadPct(a, b) {
    if (!a || !b || !finite(a.overhead) || !finite(b.overhead) || b.overhead <= 0) return null;
    return (a.overhead - b.overhead) / b.overhead * 100;
  }

  exports.UNSETTLED_BEFORE = UNSETTLED_BEFORE;
  exports.PRE_EXPORTER_SERIES = PRE_EXPORTER_SERIES;
  exports.userDataFor = userDataFor;
  exports.resultFor = resultFor;
  exports.hiddenReason = hiddenReason;
  exports.pointMemory = pointMemory;
  exports.releasePoint = releasePoint;
  exports.latestPoint = latestPoint;
  exports.summarize = summarize;
  exports.overheadPct = overheadPct;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.MemoryHelpers = {}));
