/**
 * Pure helpers for the shared commit-index x-axis.
 *
 * Every history chart plots against `commit_index` (position in the Valkey
 * commit history). A raw commit index means nothing to a reader, so the axis
 * is marked at release landmarks ("8.0", "9.1", ...) instead. Releases are
 * spaced unevenly (163, 645, 1093, 1425, 1837, 2261 as of 9.2), so a narrow
 * zoom may hold fewer than two releases; the axis then falls back to evenly
 * spaced commit-index ticks so it still carries scale, with any release that
 * IS in view labelled.
 *
 * Kept free of Chart.js and the DOM so it is unit-testable under `node --test`
 * like the other lib/*.js helpers. index.html wires `releaseTicks` into a
 * Chart.js `afterBuildTicks` hook.
 */
(function (exports) {
  'use strict';

  /** A release landmark is one whose label starts with a version number. */
  function isReleaseLabel(label) {
    return typeof label === 'string' && /^\d+\./.test(label);
  }

  /**
   * Release landmarks with a finite commit_index, de-duplicated by label and
   * sorted ascending. Non-release landmarks ("First benchmarkable") are dropped.
   */
  function releaseLandmarks(landmarks) {
    const byLabel = new Map();
    for (const lm of landmarks || []) {
      if (!lm || !isReleaseLabel(lm.label) || !Number.isFinite(lm.commit_index)) continue;
      if (!byLabel.has(lm.label)) byLabel.set(lm.label, lm);
    }
    return [...byLabel.values()].sort((a, b) => a.commit_index - b.commit_index);
  }

  /** Round `step` up to a 1/2/5 x 10^n "nice" step, never below 1. */
  function niceStep(rawStep) {
    if (!(rawStep > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return Math.max(1, nice * mag);
  }

  /** Evenly spaced integer ticks inside [min, max], at most `count` of them. */
  function indexTicks(min, max, count) {
    const span = max - min;
    if (!(span > 0) || count < 1) return [];
    const step = niceStep(span / count);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    return out;
  }

  /**
   * Ticks for the visible window [min, max].
   *
   * Returns { mode, ticks } where ticks is [{ value, label }] ascending and
   * mode is 'releases' (two or more releases in view; only those are marked)
   * or 'index' (fewer than two releases in view; evenly spaced commit-index
   * ticks, plus any release in view labelled by version).
   *
   * @param {Array<{label:string, commit_index:number}>} landmarks
   * @param {number} min   visible x min (inclusive)
   * @param {number} max   visible x max (inclusive)
   * @param {{minReleases?:number, fallbackCount?:number}} [opts]
   */
  function releaseTicks(landmarks, min, max, opts) {
    const minReleases = (opts && opts.minReleases) || 2;
    const fallbackCount = (opts && opts.fallbackCount) || 6;
    const lo = Math.min(min, max), hi = Math.max(min, max);
    const visible = releaseLandmarks(landmarks)
      .filter(l => l.commit_index >= lo && l.commit_index <= hi);

    if (visible.length >= minReleases) {
      return { mode: 'releases', ticks: visible.map(l => ({ value: l.commit_index, label: l.label })) };
    }

    // Numeric scale ticks, minus any that would print on top of a release
    // label (within half a step of it); releases win.
    const numeric = indexTicks(lo, hi, fallbackCount);
    const step = numeric.length > 1 ? numeric[1] - numeric[0] : 1;
    const byValue = new Map();
    for (const v of numeric) {
      if (visible.some(l => Math.abs(l.commit_index - v) < step / 2)) continue;
      byValue.set(v, { value: v, label: String(v) });
    }
    for (const l of visible) byValue.set(l.commit_index, { value: l.commit_index, label: l.label });
    const ticks = [...byValue.values()].sort((a, b) => a.value - b.value);
    return { mode: 'index', ticks };
  }

  /** "1425–2279" style text for the visible commit-index window. */
  function formatRange(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
    return `${Math.round(min)}\u2013${Math.round(max)}`;
  }

  // ---------------------------------------------------------------- y axis

  /** Numeric values of a Chart.js ticks array (or plain numbers), finite only. */
  function tickValues(ticks) {
    return (Array.isArray(ticks) ? ticks : [])
      .map(t => (t && typeof t === 'object' ? t.value : t))
      .filter(v => Number.isFinite(v));
  }

  /**
   * Fewest decimals (0..6) that write every tick exactly once the values are
   * divided by `divisor`, so the labels are distinct and evenly stepped: a
   * narrow range in 0.025M steps reads 1.400M, 1.425M, 1.450M; "1.5M" five
   * times on one axis says nothing. Ticks that no decimal count writes
   * exactly get the fewest decimals that still keep every label distinct.
   */
  function decimalsForTicks(ticks, divisor) {
    const d = divisor > 0 ? divisor : 1;
    const values = tickValues(ticks).map(v => v / d);
    for (let decimals = 0; decimals <= 6; decimals++) {
      const scale = Math.pow(10, decimals);
      if (values.every(v => Math.abs(v * scale - Math.round(v * scale)) < 1e-6)) {
        return decimals;
      }
    }
    for (let decimals = 0; decimals <= 6; decimals++) {
      const labels = values.map(v => v.toFixed(decimals));
      if (new Set(labels).size === labels.length) return decimals;
    }
    return 6;
  }

  /**
   * A y-axis tick label with a unit suffix, precise enough that the axis has
   * no repeated labels. `unit` 'M' or 'k' fixes the divisor (an axis titled
   * "M ops/sec" keeps M); 'auto' picks M, k or none from the largest tick.
   * Use as a Chart.js tick callback: `(v, i, ticks) => valueTickLabel(v, ticks, 'M')`.
   */
  function valueTickLabel(value, ticks, unit) {
    if (!Number.isFinite(value)) return '';
    let divisor = 1;
    let suffix = '';
    if (unit === 'M') { divisor = 1e6; suffix = 'M'; } else if (unit === 'k') { divisor = 1e3; suffix = 'k'; } else if (unit === 'auto') {
      const top = Math.max(Math.abs(value), ...tickValues(ticks).map(Math.abs));
      if (top >= 1e6) { divisor = 1e6; suffix = 'M'; } else if (top >= 1e3) { divisor = 1e3; suffix = 'k'; }
    }
    const values = tickValues(ticks);
    const decimals = values.length > 1 ? decimalsForTicks(values, divisor) : (divisor === 1 ? 2 : 1);
    return (value / divisor).toFixed(decimals) + suffix;
  }

  exports.decimalsForTicks = decimalsForTicks;
  exports.valueTickLabel = valueTickLabel;
  exports.isReleaseLabel = isReleaseLabel;
  exports.releaseLandmarks = releaseLandmarks;
  exports.niceStep = niceStep;
  exports.indexTicks = indexTicks;
  exports.releaseTicks = releaseTicks;
  exports.formatRange = formatRange;
})(typeof module !== 'undefined' && module.exports ? module.exports : (this.AxisTicks = {}));
