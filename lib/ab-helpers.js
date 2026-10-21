/**
 * Pure helpers for the commit A/B attribution page (ab.html).
 *
 * The page answers one question: between two commits, did the work a request
 * does change, or did only the time it takes change? Throughput alone cannot
 * tell those apart, because binary layout (function placement, alignment)
 * moves cache and branch counters with nearly every commit. The helpers here
 * turn published series into per-cell verdicts and a per-row attribution
 * sentence following the reading rule in lib/metric-help.js.
 *
 * Data shape, as published by the Conductress exporter:
 *   - throughput series: points[].results[workload].{rps, cv, reps}
 *   - perf-counter series: points[].value, points[].scope
 *   - every series on a platform shares one commit_index space, so "nearest
 *     measured point" is well defined across series.
 *
 * Perf-counter points have no cv/reps (the exporter sums counters across
 * reps), so their noise floor is estimated from the series itself: the
 * robust spread of adjacent-point ratios over a trailing window of the same
 * scope run. Throughput points keep the Welch test on cv/reps.
 *
 * No DOM, no fetch. Loaded as a browser global (AbHelpers) and as a CommonJS
 * module for tests. Statistics come from lib/compare-helpers.js, scope rules
 * from lib/scope-helpers.js; both are injected so this file has no imports.
 */
(function (exports) {
  'use strict';

  var LEGACY_SCOPE = 'user';
  var DEFAULT_WINDOW = 30;       // adjacent pairs used for the series noise floor
  var MIN_WINDOW = 5;            // fewer pairs than this: no floor, verdict is "unknown"
  var DEFAULT_MULTIPLIER = 2;    // |delta| must exceed this many floors to clear
  var THROUGHPUT_MIN_DELTA = 0.01;
  var THROUGHPUT_ALPHA = 0.05;

  function pointScope(p) { return (p && p.scope) || LEGACY_SCOPE; }

  /* ------------------------------------------------------------------ */
  /* Direction                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Which way is good for a metric id. Higher is better for throughput, IPC
   * and the retiring share of pipeline slots; lower for everything else the
   * manifests publish (per-request counts, MPKI, stall and bound shares,
   * syscalls, context switches).
   */
  function direction(metricId) {
    if (metricId === 'throughput') return 'higher';
    if (/^ipc(-|$)/.test(metricId)) return 'higher';
    if (/^tma-retiring-pct/.test(metricId)) return 'higher';
    return 'lower';
  }

  /* ------------------------------------------------------------------ */
  /* Point normalisation and commit resolution                           */
  /* ------------------------------------------------------------------ */

  /**
   * Flatten a published series into one shape regardless of metric.
   * Throughput needs the workload id to pick its results entry.
   *
   * @returns {Array<{commit:string, commit_index:number, date:string, value:number,
   *                  cv:number|null, reps:number|null, scope:string, pr:number|undefined,
   *                  pr_title:string|undefined}>} sorted by commit_index
   */
  function normalizePoints(series, metricId, workloadId) {
    if (!series || !Array.isArray(series.points)) return [];
    var out = [];
    series.points.forEach(function (p) {
      var value = null, cv = null, reps = null;
      if (metricId === 'throughput') {
        var r = p.results && p.results[workloadId];
        if (!r || typeof r.rps !== 'number') return;
        value = r.rps; cv = r.cv == null ? null : r.cv; reps = r.reps == null ? null : r.reps;
      } else {
        if (typeof p.value !== 'number') return;
        value = p.value;
      }
      out.push({
        commit: p.commit, commit_index: p.commit_index, date: p.date,
        value: value, cv: cv, reps: reps, scope: pointScope(p),
        pr: p.pr, pr_title: p.pr_title,
      });
    });
    out.sort(function (a, b) { return a.commit_index - b.commit_index; });
    return out;
  }

  /**
   * Build a commit index from every normalised point list on a platform:
   * commit sha -> commit_index, and pr -> commit_index. Later lists only add
   * commits the earlier ones lacked; a conflicting index for the same sha is
   * a data error and is reported rather than overwritten.
   */
  function buildCommitIndex(pointLists) {
    var bySha = {}, byPr = {}, byIndex = {}, conflicts = [];
    (pointLists || []).forEach(function (pts) {
      (pts || []).forEach(function (p) {
        if (!p.commit) return;
        if (bySha[p.commit] != null && bySha[p.commit] !== p.commit_index) {
          conflicts.push({ commit: p.commit, indices: [bySha[p.commit], p.commit_index] });
          return;
        }
        bySha[p.commit] = p.commit_index;
        byIndex[p.commit_index] = { commit: p.commit, date: p.date, pr: p.pr, pr_title: p.pr_title };
        if (p.pr != null && byPr[p.pr] == null) byPr[p.pr] = p.commit_index;
      });
    });
    return { bySha: bySha, byPr: byPr, byIndex: byIndex, conflicts: conflicts };
  }

  /**
   * Resolve a sha prefix against the commit index.
   *
   * @returns {{ok:true, commit:string, commit_index:number}
   *          |{ok:false, reason:'not-found'|'ambiguous'|'empty', matches?:string[]}}
   */
  function resolveSha(index, prefix) {
    var q = String(prefix || '').trim().toLowerCase();
    if (!q) return { ok: false, reason: 'empty' };
    var matches = Object.keys(index.bySha).filter(function (sha) { return sha.indexOf(q) === 0; });
    // Several points may share a sha; dedupe by sha already done via object keys.
    if (matches.length === 0) return { ok: false, reason: 'not-found' };
    if (matches.length > 1) return { ok: false, reason: 'ambiguous', matches: matches.sort() };
    return { ok: true, commit: matches[0], commit_index: index.bySha[matches[0]] };
  }

  /**
   * Resolve a PR number to its commit (B side) and the parent commit index
   * (A side). Conductress sweeps a squash-merge branch, so one PR is one
   * commit and its parent is commit_index - 1 whether or not that parent was
   * measured; nearestMeasured handles the gap per series.
   */
  function resolvePr(index, pr) {
    var n = parseInt(pr, 10);
    if (!isFinite(n)) return { ok: false, reason: 'empty' };
    var bi = index.byPr[n];
    if (bi == null) return { ok: false, reason: 'not-found' };
    var entry = index.byIndex[bi];
    return { ok: true, pr: n, commit: entry.commit, commit_index: bi, a_index: bi - 1 };
  }

  /**
   * Nearest measured point to a commit index.
   *   side 'at-or-before': largest commit_index <= target
   *   side 'at-or-after' : smallest commit_index >= target
   * Returns null when nothing lies on that side.
   */
  function nearestMeasured(points, target, side) {
    var best = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (side === 'at-or-before') {
        if (p.commit_index <= target) best = p; else break;
      } else {
        if (p.commit_index >= target) { best = p; break; }
      }
    }
    return best;
  }

  /**
   * Pick the A and B points for one series.
   *
   * A is the nearest measured point at or before aIndex: the state of the code
   * at A. B is the nearest measured point at or before bIndex that is newer
   * than the chosen A, so the cell covers (A, B] and nothing later; only when
   * no measurement exists in that range does B fall forward to the nearest
   * point after bIndex. Drift (how many commits each side moved) is reported
   * so the page can mark a cell whose endpoints are not the requested commits.
   */
  function pickEndpoints(points, aIndex, bIndex) {
    var a = nearestMeasured(points, aIndex, 'at-or-before');
    if (!a) return { a: null, b: null, reason: 'no-a' };
    var b = nearestMeasured(points, bIndex, 'at-or-before');
    if (!b || b.commit_index <= a.commit_index) b = nearestMeasured(points, bIndex, 'at-or-after');
    if (!b || b.commit_index <= a.commit_index) return { a: a, b: null, reason: 'no-b' };
    return {
      a: a, b: b,
      aDrift: aIndex - a.commit_index,       // >= 0, commits A moved back
      bDrift: b.commit_index - bIndex,       // <0 moved back, >0 moved forward
    };
  }

  /* ------------------------------------------------------------------ */
  /* Noise floor                                                         */
  /* ------------------------------------------------------------------ */

  function median(xs) {
    if (!xs.length) return NaN;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Series-derived noise floor for a metric without per-point cv.
   *
   * Takes the trailing `window` adjacent pairs of the same scope run ending at
   * `endIndex`, computes log(value[i]/value[i-1]) for each, and returns
   * 1.4826 * MAD of those ratios as a fraction. Adjacent commits mostly do not
   * change the measured quantity, so the robust spread of their ratios is the
   * typical commit-to-commit wobble: a delta inside it is indistinguishable
   * from noise. MAD rather than stdev so the real steps in the window do not
   * inflate the floor they are being judged against.
   *
   * @returns {{floor:number, n:number}|null} null when fewer than MIN_WINDOW pairs exist
   */
  function noiseFloor(points, endIndex, window) {
    window = window || DEFAULT_WINDOW;
    var end = -1;
    for (var i = 0; i < points.length; i++) if (points[i].commit_index <= endIndex) end = i;
    if (end < 1) return null;
    var scope = points[end].scope;
    var ratios = [];
    for (var j = end; j >= 1 && ratios.length < window; j--) {
      var cur = points[j], prev = points[j - 1];
      if (cur.scope !== scope || prev.scope !== scope) break;
      if (!(cur.value > 0) || !(prev.value > 0)) continue;
      ratios.push(Math.log(cur.value / prev.value));
    }
    if (ratios.length < MIN_WINDOW) return null;
    var med = median(ratios);
    var dev = ratios.map(function (r) { return Math.abs(r - med); });
    var sigma = 1.4826 * median(dev);
    return { floor: Math.exp(sigma) - 1, n: ratios.length };
  }

  /* ------------------------------------------------------------------ */
  /* Verdicts                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Verdict for one (workload, platform, metric) cell.
   *
   * @param {object} args
   *   points   normalised series points
   *   metricId
   *   aIndex, bIndex   requested commit indices
   *   stats    { welchPValue(v1,cv1,n1,v2,cv2,n2) } from compare-helpers
   *   window, multiplier   floor tuning (optional)
   * @returns {{status:'missing'|'scope'|'unknown'|'noise'|'clears', ...}}
   *   missing: no endpoint on one side (reason 'no-a'|'no-b')
   *   scope:   endpoints in different counter scopes (from, to); no delta
   *   unknown: delta computed but no noise estimate possible
   *   noise:   |delta| within the floor
   *   clears:  |delta| beyond the floor; `good` says whether it moved the right way
   */
  function cellVerdict(args) {
    var pts = args.points || [];
    var ends = pickEndpoints(pts, args.aIndex, args.bIndex);
    if (!ends.a || !ends.b) return { status: 'missing', reason: ends.reason, a: ends.a, b: ends.b };
    var a = ends.a, b = ends.b;
    var base = { a: a, b: b, aDrift: ends.aDrift, bDrift: ends.bDrift, direction: direction(args.metricId) };
    if (a.scope !== b.scope) {
      return Object.assign(base, { status: 'scope', from: a.scope, to: b.scope });
    }
    if (!(a.value > 0)) return Object.assign(base, { status: 'unknown', delta: null });
    var delta = (b.value - a.value) / a.value;
    var good = base.direction === 'higher' ? delta > 0 : delta < 0;
    var out = Object.assign(base, { delta: delta, good: good });

    if (args.metricId === 'throughput' && a.cv != null && b.cv != null && args.stats && args.stats.welchPValue) {
      var p = args.stats.welchPValue(a.value, a.cv, a.reps, b.value, b.cv, b.reps);
      out.test = 'welch';
      out.pValue = p;
      if (p == null) return Object.assign(out, { status: 'unknown' });
      out.status = (p < THROUGHPUT_ALPHA && Math.abs(delta) >= THROUGHPUT_MIN_DELTA) ? 'clears' : 'noise';
      return out;
    }

    var nf = noiseFloor(pts, a.commit_index, args.window);
    out.test = 'floor';
    if (!nf) return Object.assign(out, { status: 'unknown', floor: null });
    var mult = args.multiplier || DEFAULT_MULTIPLIER;
    out.floor = nf.floor;
    out.floorN = nf.n;
    out.status = Math.abs(delta) > mult * nf.floor ? 'clears' : 'noise';
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Row attribution                                                     */
  /* ------------------------------------------------------------------ */

  function moved(c) { return !!c && c.status === 'clears'; }
  function flat(c) { return !!c && (c.status === 'noise'); }
  function pct(d) { return (d > 0 ? '+' : '') + (d * 100).toFixed(1) + '%'; }

  /**
   * One sentence for a row, from the main-thread cells, following the reading
   * rule in the metric help:
   *   instructions/req moved            -> the code path changed
   *   insn flat, cycles moved, a layout tell (icache or branch MPKI) moved
   *                                     -> suspect binary layout
   *   insn flat, tells flat, cycles moved -> data side (LLC / backend)
   *   nothing clears                    -> within noise
   * A missing instructions/req cell degrades to a cycles-only statement.
   *
   * @param {Object<string,object>} cells  metricId -> cellVerdict result
   * @param {string} thread  'main' | 'io' (default 'main')
   * @returns {{kind:'code'|'layout'|'data'|'noise'|'scope'|'insufficient', text:string}}
   */
  function rowAttribution(cells, thread) {
    thread = thread || 'main';
    var insn = cells['instructions-per-req-' + thread];
    var cyc = cells['cycles-per-req-' + thread];
    var ic = cells['icache-mpki-' + thread];
    var br = cells['branch-mpki-' + thread];
    var llc = cells['llc-mpki-' + thread];
    var tp = cells.throughput;

    var any = [insn, cyc, ic, br, llc, tp].filter(Boolean);
    if (!any.length) return { kind: 'insufficient', text: 'no cells' };
    if (any.some(function (c) { return c.status === 'scope'; })) {
      return { kind: 'scope', text: 'counter scope changed between A and B; perf counters not comparable' };
    }
    var judged = any.filter(function (c) { return c.status === 'clears' || c.status === 'noise'; });
    if (!judged.length) {
      var missing = any.every(function (c) { return c.status === 'missing'; });
      return { kind: 'insufficient', text: missing ? 'not measured for this range' : 'no noise estimate; deltas shown without a verdict' };
    }

    if (moved(insn)) {
      var dir = insn.delta > 0 ? 'more' : 'less';
      var text = 'code path changed: ' + pct(insn.delta) + ' instructions/request (' + dir + ' work per request)';
      // When cycles moved far more than instructions, most of the effect is
      // stalls (cache, branches, memory), not the amount of work.
      if (moved(cyc) && Math.sign(cyc.delta) === Math.sign(insn.delta) && Math.abs(cyc.delta) > 3 * Math.abs(insn.delta)) {
        var tells = [];
        if (moved(ic)) tells.push('icache MPKI ' + pct(ic.delta));
        if (moved(br)) tells.push('branch MPKI ' + pct(br.delta));
        if (moved(llc)) tells.push('LLC MPKI ' + pct(llc.delta));
        text += '; cycles/request ' + pct(cyc.delta) + ', so most of the effect is ' + (cyc.delta < 0 ? 'fewer' : 'more') + ' stalls' + (tells.length ? ' (' + tells.join(', ') + ')' : '');
      }
      return { kind: 'code', text: text };
    }
    if (flat(insn) && moved(cyc)) {
      var tells = [];
      if (moved(ic)) tells.push('icache MPKI ' + pct(ic.delta));
      if (moved(br)) tells.push('branch MPKI ' + pct(br.delta));
      if (tells.length) {
        return { kind: 'layout', text: 'suspect binary layout: instructions/request flat, cycles/request ' + pct(cyc.delta) + ', ' + tells.join(', ') };
      }
      var data = moved(llc) ? ' (LLC MPKI ' + pct(llc.delta) + ')' : '';
      return { kind: 'data', text: 'data side: instructions/request flat, cycles/request ' + pct(cyc.delta) + ', no layout tell' + data };
    }
    if (!insn && moved(cyc)) {
      return { kind: 'data', text: 'cycles/request ' + pct(cyc.delta) + '; instructions/request not measured, cannot split work from stalls' };
    }
    if (moved(tp) && (!cyc || flat(cyc))) {
      return { kind: 'noise', text: 'throughput ' + pct(tp.delta) + ' but main-thread counters flat; check IO threads or the client' };
    }
    if (any.some(moved)) {
      var names = Object.keys(cells).filter(function (k) { return moved(cells[k]); });
      return { kind: 'noise', text: 'only ' + names.join(', ') + ' cleared the floor; the arbiter counters are flat' };
    }
    return { kind: 'noise', text: 'within noise on every counter' };
  }

  /**
   * Summarise platform sub-rows for one workload: agreement strengthens a
   * verdict, a split is named rather than averaged.
   */
  function platformAgreement(attributions) {
    var kinds = {};
    attributions.forEach(function (a) { if (a && a.kind !== 'insufficient') kinds[a.kind] = (kinds[a.kind] || 0) + 1; });
    var keys = Object.keys(kinds);
    if (!keys.length) return { agree: false, text: '' };
    if (keys.length === 1) return { agree: true, kind: keys[0], text: 'all platforms agree: ' + keys[0] };
    return { agree: false, text: 'platforms split: ' + keys.map(function (k) { return k + ' x' + kinds[k]; }).join(', ') };
  }

  /* ------------------------------------------------------------------ */
  /* Hash state                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * #a=<sha>&b=<sha>  or  #pr=<n>, plus optional epoch=, platforms=, metrics=.
   */
  function parseHash(hash) {
    var out = { a: null, b: null, pr: null, epoch: null, platforms: null, metrics: null };
    var h = String(hash || '').replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i)), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'a' || k === 'b' || k === 'epoch') out[k] = v || null;
      else if (k === 'pr') out.pr = /^\d+$/.test(v) ? parseInt(v, 10) : null;
      else if (k === 'platforms' || k === 'metrics') out[k] = v ? v.split(',').filter(Boolean) : null;
    });
    return out;
  }

  function buildHash(state) {
    var parts = [];
    if (state.pr != null) parts.push('pr=' + encodeURIComponent(state.pr));
    else {
      if (state.a) parts.push('a=' + encodeURIComponent(state.a));
      if (state.b) parts.push('b=' + encodeURIComponent(state.b));
    }
    if (state.epoch) parts.push('epoch=' + encodeURIComponent(state.epoch));
    if (state.platforms && state.platforms.length) parts.push('platforms=' + state.platforms.map(encodeURIComponent).join(','));
    if (state.metrics && state.metrics.length) parts.push('metrics=' + state.metrics.map(encodeURIComponent).join(','));
    return parts.length ? '#' + parts.join('&') : '';
  }

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */

  function formatDelta(d, digits) {
    if (d == null || !isFinite(d)) return '–';
    var n = digits == null ? 1 : digits;
    return (d > 0 ? '+' : '') + (d * 100).toFixed(n) + '%';
  }

  function formatValue(metricId, v) {
    if (v == null || !isFinite(v)) return '–';
    if (metricId === 'throughput') return Math.round(v).toLocaleString('en-US');
    if (/per-req|per-sec/.test(metricId)) return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2);
    if (/pct/.test(metricId)) return v.toFixed(1) + '%';
    return v.toFixed(2);
  }

  exports.DEFAULT_WINDOW = DEFAULT_WINDOW;
  exports.MIN_WINDOW = MIN_WINDOW;
  exports.DEFAULT_MULTIPLIER = DEFAULT_MULTIPLIER;
  exports.direction = direction;
  exports.normalizePoints = normalizePoints;
  exports.buildCommitIndex = buildCommitIndex;
  exports.resolveSha = resolveSha;
  exports.resolvePr = resolvePr;
  exports.nearestMeasured = nearestMeasured;
  exports.pickEndpoints = pickEndpoints;
  exports.noiseFloor = noiseFloor;
  exports.cellVerdict = cellVerdict;
  exports.rowAttribution = rowAttribution;
  exports.platformAgreement = platformAgreement;
  exports.parseHash = parseHash;
  exports.buildHash = buildHash;
  exports.formatDelta = formatDelta;
  exports.formatValue = formatValue;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.AbHelpers = {}));
