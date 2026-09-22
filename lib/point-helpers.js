/**
 * Pure helpers for reading Conductress v3 per-result metadata.
 *
 * A v3 point's `results[workload]` object carries, beside `rps`/`cv`/`reps`:
 *   - score_min, score_max      (PR #238) — min/max of the per-rep scores
 *   - score_aggregate           ("mean" | "median")
 *   - client_cores_busy,
 *     client_allocated_cores,
 *     client_utilization (0..1),
 *     client_saturated (bool)   (PR #246)
 *
 * ALL of these keys are OMITTED when unknown (older points, v1 series).
 * The golden rule: absent must resolve to `known: false` — never to a
 * fabricated "not saturated" or "range = value".
 *
 * Browser: loaded via <script src="lib/point-helpers.js">.
 * Node tests: required via require().
 */

(function (exports) {
  'use strict';

  function isFiniteNumber(x) {
    return typeof x === 'number' && isFinite(x);
  }

  /**
   * Read the score range from a result object.
   *
   * @param {Object|null} result — a single `results[workload]` object
   * @returns {{known:boolean, min?:number, max?:number, aggregate?:string}}
   *          known=false when either bound is absent/non-numeric.
   */
  function scoreRange(result) {
    if (!result || !isFiniteNumber(result.score_min) || !isFiniteNumber(result.score_max)) {
      return { known: false };
    }
    // Guard against inverted bounds — normalize so min <= max.
    var lo = Math.min(result.score_min, result.score_max);
    var hi = Math.max(result.score_min, result.score_max);
    var out = { known: true, min: lo, max: hi };
    if (typeof result.score_aggregate === 'string' && result.score_aggregate) {
      out.aggregate = result.score_aggregate;
    }
    return out;
  }

  /**
   * Read the client (load generator) saturation state from a result object.
   *
   * @param {Object|null} result — a single `results[workload]` object
   * @returns {{known:boolean, saturated?:boolean, utilization?:number,
   *            cores?:number, allocated?:number}}
   *          known=false when no client_* signal is present.
   *          `saturated` is only true when client_saturated === true; a
   *          present-but-false flag yields saturated=false with known=true.
   */
  function clientState(result) {
    if (!result) return { known: false };
    var hasUtil = isFiniteNumber(result.client_utilization);
    var hasSat = typeof result.client_saturated === 'boolean';
    var hasCores = isFiniteNumber(result.client_cores_busy);
    var hasAlloc = isFiniteNumber(result.client_allocated_cores);
    if (!hasUtil && !hasSat && !hasCores && !hasAlloc) {
      return { known: false };
    }
    var out = { known: true, saturated: hasSat ? result.client_saturated === true : false };
    if (hasUtil) out.utilization = result.client_utilization;
    if (hasCores) out.cores = result.client_cores_busy;
    if (hasAlloc) out.allocated = result.client_allocated_cores;
    return out;
  }

  /**
   * Format a client state into a short tooltip line, or '' when unknown.
   *
   * Saturated:  "client saturated: util 0.94 (7.5/8 cores)"
   * Known util: "client util 0.66"
   * Unknown:    "" (caller omits the line entirely)
   *
   * @param {{known:boolean, saturated?:boolean, utilization?:number,
   *          cores?:number, allocated?:number}} state
   * @returns {string}
   */
  function clientTooltipLine(state) {
    if (!state || !state.known) return '';
    var utilStr = isFiniteNumber(state.utilization) ? state.utilization.toFixed(2) : '?';
    var coresStr = '';
    if (isFiniteNumber(state.cores) && isFiniteNumber(state.allocated)) {
      // Trim a trailing ".0" so 8.0 reads as 8.
      var c = state.cores % 1 === 0 ? String(state.cores) : state.cores.toFixed(1);
      var a = state.allocated % 1 === 0 ? String(state.allocated) : state.allocated.toFixed(1);
      coresStr = ' (' + c + '/' + a + ' cores)';
    }
    if (state.saturated) {
      return 'client saturated: util ' + utilStr + coresStr;
    }
    if (isFiniteNumber(state.utilization)) {
      return 'client util ' + utilStr + coresStr;
    }
    return '';
  }

  exports.scoreRange = scoreRange;
  exports.clientState = clientState;
  exports.clientTooltipLine = clientTooltipLine;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.PointHelpers = {}));
