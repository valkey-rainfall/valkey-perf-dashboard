/**
 * Pure helpers for the latency section of the Performance History page.
 *
 * Latency series ids differ by measurement epoch. The legacy generation used a
 * bare command + key/value id ("get-k16-v16") held at a fraction of the
 * platform's throughput; later generations name the full workload shape and
 * the held request rate ("get-k16-v16-t7-p1-r100k"). The dashboard therefore
 * takes the id from the platform manifest's `latency_workloads` list instead
 * of hardcoding one, and derives the section header and load label from the
 * id and the point data instead of from string literals.
 *
 * Kept free of DOM and fetch so it is unit-testable under `node --test`.
 */
(function (exports) {
  'use strict';

  var VALKEY_HEAD = /^(get|set|mixed-s\d+)-/;
  var SHAPE = /^(?:[a-z0-9]+-)?(get|set|mixed-s\d+)-k(\d+)-v(\d+)(?:-t(\d+))?(?:-p(\d+))?(?:-r(\d+)(k?))?$/;

  /**
   * The command whose latency series accompanies a throughput selection.
   * Latency is measured for GET and SET only; a mixed workload falls back to
   * GET, as does anything unparseable.
   */
  function latencyCommand(workloadId) {
    var m = String(workloadId || '').match(/^(get|set)-/);
    return m ? m[1] : 'get';
  }

  /**
   * Pick the latency series file id for (command, engine) from a manifest's
   * `latency_workloads` list.
   *
   * - Valkey owns the un-prefixed ids; another engine owns ids headed by
   *   "<engine>-". A manifest that lists only Valkey ids (older layout) still
   *   yields "<engine>-<id>" for a non-default engine, matching the fetch-time
   *   prefixing the dashboard used before manifests carried engine ids.
   * - An empty or missing list yields the legacy "<command>-k16-v16" id so a
   *   dashboard whose manifest fetch failed behaves as it always did.
   * - A list with no series for the command yields null: the caller hides the
   *   section rather than requesting a file that does not exist.
   *
   * @param {Array<string>|undefined} latencyWorkloads
   * @param {string} command  'get' | 'set'
   * @param {string} engine   engine id; 'valkey' is the un-prefixed default
   * @returns {string|null}
   */
  function latencySeriesId(latencyWorkloads, command, engine) {
    var list = Array.isArray(latencyWorkloads) ? latencyWorkloads.filter(function (id) { return typeof id === 'string'; }) : [];
    var cmd = (command || 'get').toLowerCase();
    var prefix = engine && engine !== 'valkey' ? engine + '-' : '';
    if (list.length === 0) return prefix + cmd + '-k16-v16';

    var valkeyIds = list.filter(function (id) { return VALKEY_HEAD.test(id); });
    var ownIds = prefix
      ? list.filter(function (id) { return id.indexOf(prefix) === 0 && VALKEY_HEAD.test(id.slice(prefix.length)); })
      : valkeyIds;
    var byCommand = function (ids, head) {
      return ids.filter(function (id) { return id.slice(head.length).indexOf(cmd + '-') === 0; });
    };

    var own = byCommand(ownIds, prefix);
    if (own.length) return own[0];
    if (prefix && ownIds.length === 0) {
      // Older manifest layout: only Valkey ids listed; prefix at fetch time.
      var fallback = byCommand(valkeyIds, '');
      if (fallback.length) return prefix + fallback[0];
    }
    return null;
  }

  /**
   * Human-readable shape of a latency series id, without the command word
   * (the header already names it): "K=16B V=16B T=7 P=1 @ 100k req/s".
   * Missing parts (legacy ids carry no threads/pipeline/rate) are omitted.
   * Unparseable ids come back unchanged so the header still says something.
   */
  function latencyShapeLabel(id) {
    var m = String(id || '').match(SHAPE);
    if (!m) return String(id || '');
    var parts = ['K=' + m[2] + 'B', 'V=' + m[3] + 'B'];
    if (m[4]) parts.push('T=' + m[4]);
    if (m[5]) parts.push('P=' + m[5]);
    var label = parts.join(' ');
    if (m[6]) label += ' @ ' + m[6] + (m[7] || '') + ' req/s';
    return label;
  }

  /**
   * Load label for the info row from a point's `target_rps`: "100k req/s",
   * "1.50M req/s". Unknown or non-positive rates yield an em dash.
   */
  function latencyLoadLabel(targetRps) {
    var n = Number(targetRps);
    if (!isFinite(n) || n <= 0) return '\u2014';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M req/s';
    if (n >= 1e3) return Math.round(n / 1e3) + 'k req/s';
    return Math.round(n) + ' req/s';
  }

  /**
   * Percentile order of a full histogram: index i of `point.histogram` is
   * `[pct, microseconds]` for HISTOGRAM_PCTS[i].
   */
  var HISTOGRAM_PCTS = ['p1', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99', 'p99.5', 'p99.9', 'p100'];

  /** Named per-point fields carried when no histogram is published. */
  var NAMED_FIELDS = { p50: 'p50_us', p99: 'p99_us', 'p99.9': 'p99_9_us', p100: 'p100_us' };

  /**
   * Percentile values (microseconds) for one latency point, keyed by label.
   * A point with a full `histogram` yields every percentile; a point that only
   * carries the named `pNN_us` fields yields those four and null for the rest,
   * so the caller can draw a gap instead of a misleading zero.
   */
  function latencyPercentiles(point) {
    var out = {};
    HISTOGRAM_PCTS.forEach(function (label) { out[label] = null; });
    if (!point) return out;
    var h = Array.isArray(point.histogram) ? point.histogram : null;
    if (h && h.length) {
      HISTOGRAM_PCTS.forEach(function (label, i) {
        var v = h[i] && Number(h[i][1]);
        if (isFinite(v) && v > 0) out[label] = v;
      });
    }
    Object.keys(NAMED_FIELDS).forEach(function (label) {
      if (out[label] != null) return;
      var v = Number(point[NAMED_FIELDS[label]]);
      if (isFinite(v) && v > 0) out[label] = v;
    });
    return out;
  }

  exports.HISTOGRAM_PCTS = HISTOGRAM_PCTS;
  exports.latencyCommand = latencyCommand;
  exports.latencySeriesId = latencySeriesId;
  exports.latencyShapeLabel = latencyShapeLabel;
  exports.latencyLoadLabel = latencyLoadLabel;
  exports.latencyPercentiles = latencyPercentiles;
})(typeof module !== 'undefined' && module.exports ? module.exports : (this.LatencyHelpers = {}));
