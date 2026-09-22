/**
 * Manifest-driven engine and workload discovery for the comparison page.
 *
 * The comparison page compares engines (Valkey against the other engines a
 * manifest carries) across the workloads a measurement epoch actually
 * declares. These pure helpers turn a set of per-platform manifests into the
 * engine list and the throughput / memory / latency workload lists the page
 * renders, so the page never hardcodes an engine pair or a workload set.
 *
 * A manifest declares:
 *   throughput_workloads — ids like "get-k16-v16-t7-p10"; another engine's
 *                          series carry an "<engine>-" prefix (e.g. "redis-get-...").
 *   memory_workloads      — ids like "memory-set-k16-v64"; another engine's
 *                          carry a "memory-<engine>-" prefix.
 *   latency_workloads     — throughput-shaped ids measured for latency; absent
 *                          on legacy (v1) manifests.
 *
 * Valkey is unprefixed. An engine other than Valkey is "present" when any
 * manifest carries a workload under its prefix.
 *
 * Browser: loaded via <script src="lib/compare-manifest.js">, exposing the
 * CompareManifest global. Node tests: required via require().
 *
 * These helpers depend only on the ENGINES / PLATFORMS shapes and on the
 * `isValidWorkloadId` / `workloadIdToLabel` predicates config.js exports; the
 * caller passes those in so this module stays free of a hard config.js import.
 */

(function (exports) {
  'use strict';

  function manifestValues(manifest, key) {
    if (!manifest || !Array.isArray(manifest[key])) return [];
    return manifest[key];
  }

  /**
   * The engines actually present across the manifests, in ENGINES order.
   *
   * Valkey is included when any manifest carries an unprefixed throughput or
   * memory workload. Every other ENGINES entry is included when some manifest
   * carries a throughput workload prefixed "<id>-" or a memory workload
   * prefixed "memory-<id>-".
   *
   * @param {Array<Object|null>} manifests — per-platform manifests (nulls skipped)
   * @param {Array<{id:string, label:string}>} ENGINES
   * @returns {Array<{id:string, label:string}>}
   */
  function engineIdsFromManifests(manifests, ENGINES) {
    var list = Array.isArray(manifests) ? manifests : [];
    var engines = Array.isArray(ENGINES) ? ENGINES : [];

    var throughputIds = [];
    var memoryIds = [];
    list.forEach(function (m) {
      throughputIds = throughputIds.concat(manifestValues(m, 'throughput_workloads'));
      memoryIds = memoryIds.concat(manifestValues(m, 'memory_workloads'));
    });

    return engines.filter(function (engine) {
      if (engine.id === 'valkey') {
        var hasUnprefixedThroughput = throughputIds.some(function (id) {
          return !isPrefixedByAnyEngine(id, engines, 'throughput');
        });
        var hasUnprefixedMemory = memoryIds.some(function (id) {
          return id.indexOf('memory-') === 0 &&
            !isPrefixedByAnyEngine(id, engines, 'memory');
        });
        return hasUnprefixedThroughput || hasUnprefixedMemory;
      }
      var tp = engine.id + '-';
      var mp = 'memory-' + engine.id + '-';
      var inThroughput = throughputIds.some(function (id) { return id.indexOf(tp) === 0; });
      var inMemory = memoryIds.some(function (id) { return id.indexOf(mp) === 0; });
      return inThroughput || inMemory;
    });
  }

  // True when a workload id belongs to any non-Valkey engine's namespace.
  function isPrefixedByAnyEngine(id, engines, kind) {
    return engines.some(function (engine) {
      if (engine.id === 'valkey') return false;
      var prefix = kind === 'memory' ? 'memory-' + engine.id + '-' : engine.id + '-';
      return id.indexOf(prefix) === 0;
    });
  }

  /**
   * Cross-platform throughput workloads to compare: unprefixed, valid ids
   * present on ALL platforms that have a manifest, in the first manifest's
   * declaration order, labelled via workloadIdToLabel.
   *
   * A platform whose workload set is missing an id excludes that id, matching
   * the page's existing cross-platform-only behaviour.
   *
   * @param {Array<Object|null>} manifests — per-platform, index-aligned with PLATFORMS
   * @param {Array<string>} PLATFORMS
   * @param {{isValidWorkloadId:Function, workloadIdToLabel:Function}} config
   * @returns {Array<{id:string, label:string}>}
   */
  function compareThroughputWorkloads(manifests, PLATFORMS, config) {
    var list = Array.isArray(manifests) ? manifests : [];
    var isValid = config && config.isValidWorkloadId;
    var toLabel = config && config.workloadIdToLabel;

    // Manifests that are actually present.
    var present = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && Array.isArray(list[i].throughput_workloads)) present.push(list[i]);
    }
    if (present.length === 0) return [];

    // Candidate ids: unprefixed + valid, in first present manifest's order.
    var seen = {};
    var ordered = [];
    manifestValues(present[0], 'throughput_workloads').forEach(function (id) {
      if (isValid && !isValid(id)) return;
      if (seen[id]) return;
      seen[id] = true;
      ordered.push(id);
    });

    // Keep only ids present on every present manifest.
    return ordered
      .filter(function (id) {
        return present.every(function (m) {
          return manifestValues(m, 'throughput_workloads').indexOf(id) !== -1;
        });
      })
      .map(function (id) {
        return { id: id, label: toLabel ? toLabel(id) : id };
      });
  }

  /**
   * Unprefixed memory workload ids present on every manifest that declares any
   * memory_workloads, in the first such manifest's order. When NO manifest
   * declares memory_workloads (legacy v1), falls back to the supplied
   * MEMORY_WORKLOADS list unchanged.
   *
   * @param {Array<Object|null>} manifests
   * @param {Array<string>} MEMORY_WORKLOADS — legacy fallback
   * @param {Array<{id:string}>} ENGINES
   * @returns {Array<string>}
   */
  function compareMemoryWorkloads(manifests, MEMORY_WORKLOADS, ENGINES) {
    var list = Array.isArray(manifests) ? manifests : [];
    var engines = Array.isArray(ENGINES) ? ENGINES : [];

    var declaring = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && Array.isArray(list[i].memory_workloads)) declaring.push(list[i]);
    }
    if (declaring.length === 0) {
      return Array.isArray(MEMORY_WORKLOADS) ? MEMORY_WORKLOADS.slice() : [];
    }

    var seen = {};
    var ordered = [];
    manifestValues(declaring[0], 'memory_workloads').forEach(function (id) {
      if (id.indexOf('memory-') !== 0) return;
      if (isPrefixedByAnyEngine(id, engines, 'memory')) return;
      if (seen[id]) return;
      seen[id] = true;
      ordered.push(id);
    });

    return ordered.filter(function (id) {
      return declaring.every(function (m) {
        return manifestValues(m, 'memory_workloads').indexOf(id) !== -1;
      });
    });
  }

  /**
   * Unprefixed, valid latency workload ids present on every manifest that
   * declares any latency_workloads, in the first such manifest's order,
   * labelled via config.workloadIdToLabel. Empty when no manifest declares
   * latency (e.g. legacy v1).
   *
   * Latency ids carry a held-rate suffix ("get-k16-v16-t7-p1-r100k"), which
   * the throughput validator rejects on purpose, so the caller passes the
   * LATENCY predicates here (isValidLatencyWorkloadId / latencyWorkloadIdToLabel
   * from config.js), not the throughput ones.
   *
   * @param {Array<Object|null>} manifests
   * @param {{isValidWorkloadId:Function, workloadIdToLabel:Function}} config — latency-shaped predicates
   * @param {Array<{id:string}>} ENGINES
   * @returns {Array<{id:string, label:string}>}
   */
  function compareLatencyWorkloads(manifests, config, ENGINES) {
    var list = Array.isArray(manifests) ? manifests : [];
    var engines = Array.isArray(ENGINES) ? ENGINES : [];
    var isValid = config && config.isValidWorkloadId;
    var toLabel = config && config.workloadIdToLabel;

    var declaring = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && Array.isArray(list[i].latency_workloads)) declaring.push(list[i]);
    }
    if (declaring.length === 0) return [];

    var seen = {};
    var ordered = [];
    manifestValues(declaring[0], 'latency_workloads').forEach(function (id) {
      if (isPrefixedByAnyEngine(id, engines, 'throughput')) return;
      if (isValid && !isValid(id)) return;
      if (seen[id]) return;
      seen[id] = true;
      ordered.push(id);
    });

    return ordered
      .filter(function (id) {
        return declaring.every(function (m) {
          return manifestValues(m, 'latency_workloads').indexOf(id) !== -1;
        });
      })
      .map(function (id) {
        return { id: id, label: toLabel ? toLabel(id) : id };
      });
  }

  exports.engineIdsFromManifests = engineIdsFromManifests;
  exports.compareThroughputWorkloads = compareThroughputWorkloads;
  exports.compareMemoryWorkloads = compareMemoryWorkloads;
  exports.compareLatencyWorkloads = compareLatencyWorkloads;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.CompareManifest = {}));
