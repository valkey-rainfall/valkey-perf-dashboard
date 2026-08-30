/**
 * Pure statistical and formatting helpers extracted from compare.html.
 * Browser: loaded via <script src="lib/compare-helpers.js">.
 * Node tests: required via require().
 */

(function (exports) {
  'use strict';

  /**
   * Abramowitz & Stegun normal CDF approximation.
   * @param {number} x — standard normal variate
   * @returns {number} P(Z ≤ x)
   */
  function normalCDF(x) {
    if (x < 0) return 1 - normalCDF(-x);
    var t = 1 / (1 + 0.2316419 * x);
    var d = 0.3989422804014327; // 1/sqrt(2*pi)
    var p = d * Math.exp(-x * x / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return 1 - p;
  }

  /**
   * Two-tailed p-value approximation from t-statistic and degrees of freedom.
   */
  function tDistPValue(t, df) {
    if (df > 100) {
      return 2 * (1 - normalCDF(t));
    }
    var adj = t * (1 - 1 / (4 * df));
    return 2 * (1 - normalCDF(adj));
  }

  /**
   * CI95 half-width from value, CV%, and sample count.
   */
  function ci95(value, cv, reps) {
    if (!cv || !reps || reps < 2) return 0;
    var se = (cv / 100) * value / Math.sqrt(reps);
    return 1.96 * se;
  }

  /**
   * Approximate Welch's t-test two-tailed p-value.
   */
  function welchPValue(v1, cv1, n1, v2, cv2, n2) {
    if (!cv1 || !cv2 || n1 < 2 || n2 < 2) return null;
    var s1 = (cv1 / 100) * v1;
    var s2 = (cv2 / 100) * v2;
    var se = Math.sqrt((s1 * s1) / n1 + (s2 * s2) / n2);
    if (se === 0) return 0;
    var tStat = Math.abs(v1 - v2) / se;
    var a = (s1 * s1) / n1, b = (s2 * s2) / n2;
    var df = ((a + b) * (a + b)) / (a * a / (n1 - 1) + b * b / (n2 - 1));
    return tDistPValue(tStat, df);
  }

  /**
   * Format a workload ID into a human-readable label.
   * Handles both throughput IDs (get-k16-v128-t7-p10) and memory IDs (memory-set-k16-v64).
   */
  function workloadLabel(id) {
    var raw = id.replace(/^memory-/, '');
    var parts = raw.split('-');
    var cmd = parts[0].toUpperCase();
    var specs = parts.slice(1).map(function (p) {
      if (p.startsWith('k')) return 'K=' + p.slice(1) + 'B';
      if (p.startsWith('v')) return 'V=' + p.slice(1) + 'B';
      if (p.startsWith('t')) return 'T=' + p.slice(1);
      if (p.startsWith('p')) return 'P=' + p.slice(1);
      if (p.startsWith('m')) return 'M=' + p.slice(1) + 'B';
      if (p.startsWith('f')) return 'F=' + p.slice(1);
      if (p === 'expire') return '+expire';
      return p;
    });
    return cmd + ' ' + specs.join(' ');
  }

  exports.normalCDF = normalCDF;
  exports.tDistPValue = tDistPValue;
  exports.ci95 = ci95;
  exports.welchPValue = welchPValue;
  exports.workloadLabel = workloadLabel;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.CompareHelpers = {}));
