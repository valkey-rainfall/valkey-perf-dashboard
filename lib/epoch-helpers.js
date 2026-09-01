/**
 * Epoch helpers for the Valkey perf dashboard.
 *
 * An "epoch" is a measurement generation — data collected with a specific
 * generator binary / methodology.  v1 (legacy, stock generator) and v2
 * (scalable, patched generator) are the initial two; more may be added.
 *
 * Manifest v3 adds an optional `epochs` array:
 *   { id: 'v1', label: 'Legacy v1 (stock generator)', generator: 'stock' }
 *   { id: 'v2', label: 'Scalable v2 (patched generator)', generator: 'patched' }
 *
 * Series filenames:
 *   v1 (default/absent epoch) — series-{platform}-{workload}-{metric}.json
 *   v2+                       — series-{platform}-{workload}-{metric}.epoch-{id}.json
 *
 * The epoch selector only shows epochs that are actually present in the
 * manifest for the current platform; when only one epoch exists it is
 * auto-selected and the selector is hidden.
 *
 * Browser: loaded via <script src="lib/epoch-helpers.js">.
 * Node tests: required via require().
 */

(function (exports) {
  'use strict';

  /** Well-known epoch definitions.  The manifest may extend these. */
  var BUILTIN_EPOCHS = [
    { id: 'v1', label: 'Legacy v1 (stock generator)', generator: 'stock' },
    { id: 'v2', label: 'Scalable v2 (patched generator)', generator: 'patched' },
  ];

  /**
   * Resolve epochs from a manifest (v2 or v3).
   *
   * @param {Object|null} manifest — a single platform manifest
   * @returns {Array<{id:string, label:string, generator:string}>}
   *          Empty array if the manifest has no epoch metadata (v1/v2 manifest).
   */
  function resolveEpochs(manifest) {
    if (!manifest || !Array.isArray(manifest.epochs) || manifest.epochs.length === 0) {
      return [];
    }
    return manifest.epochs.map(function (e) {
      // Allow manifests to provide just an id — fill from builtins.
      var builtin = BUILTIN_EPOCHS.find(function (b) { return b.id === e.id; });
      return {
        id: e.id,
        label: e.label || (builtin ? builtin.label : e.id),
        generator: e.generator || (builtin ? builtin.generator : 'unknown'),
      };
    });
  }

  /**
   * Determine available epochs across all platform manifests.
   * Returns the INTERSECTION of epoch ids present on all platforms
   * that report any epochs, preserving declaration order from the
   * first manifest that has them.
   *
   * If NO manifest declares epochs the result is an empty array,
   * meaning the dashboard should operate in legacy mode.
   *
   * @param {Object<string, Object>} platformManifests — keyed by platform id
   * @returns {Array<{id:string, label:string, generator:string}>}
   */
  function availableEpochs(platformManifests) {
    if (!platformManifests) return [];
    var keys = Object.keys(platformManifests);
    if (keys.length === 0) return [];

    // Collect per-platform epoch id sets
    var order = null; // first platform's full epoch list — defines label/order
    var idSets = [];
    for (var i = 0; i < keys.length; i++) {
      var epochs = resolveEpochs(platformManifests[keys[i]]);
      if (epochs.length === 0) continue; // v2 manifest — no epochs
      if (!order) order = epochs;
      var idSet = {};
      epochs.forEach(function (e) { idSet[e.id] = true; });
      idSets.push(idSet);
    }
    if (!order || idSets.length === 0) return [];

    // Intersection: keep only ids present in ALL epoch-aware manifests
    return order.filter(function (e) {
      return idSets.every(function (s) { return s[e.id]; });
    });
  }

  /**
   * Build the series filename for a given epoch + base key.
   *
   * @param {string} base  — e.g. "series-arm64-get-k16-v16-t7-p10-throughput"
   * @param {string|null} epochId — null or '' means legacy v1 (no epoch qualifier)
   * @returns {string} — "series-arm64-...-throughput.json" or "series-arm64-...-throughput.epoch-v2.json"
   */
  function seriesFilename(base, epochId) {
    if (!epochId || epochId === 'v1') {
      return base + '.json';
    }
    return base + '.epoch-' + epochId + '.json';
  }

  /**
   * Build the URL for fetching a series file from the data server.
   *
   * @param {string} dataUrl    — base data URL (no trailing slash)
   * @param {string} platform   — e.g. "arm64"
   * @param {string} fileId     — e.g. "get-k16-v16-t7-p10"
   * @param {string} metric     — e.g. "throughput", "memory", "latency"
   * @param {string|null} epochId
   * @returns {string}
   */
  function seriesUrl(dataUrl, platform, fileId, metric, epochId) {
    var base = 'series-' + platform + '-' + fileId + '-' + metric;
    return dataUrl + '/' + seriesFilename(base, epochId);
  }

  /**
   * Build the URL for fetching a notable-changes file.
   *
   * @param {string} dataUrl
   * @param {string} platform
   * @param {string|null} epochId
   * @returns {string}
   */
  function notableUrl(dataUrl, platform, epochId) {
    if (!epochId || epochId === 'v1') {
      return dataUrl + '/notable-' + platform + '.json';
    }
    return dataUrl + '/notable-' + platform + '.epoch-' + epochId + '.json';
  }

  /**
   * Build the URL for fetching a manifest file.
   *
   * @param {string} dataUrl
   * @param {string} platform
   * @param {string|null} epochId
   * @returns {string}
   */
  function manifestUrl(dataUrl, platform, epochId) {
    if (!epochId || epochId === 'v1') {
      return dataUrl + '/manifest-' + platform + '.json';
    }
    return dataUrl + '/manifest-' + platform + '.epoch-' + epochId + '.json';
  }

  /**
   * Parse epoch from URL hash params.
   * @param {URLSearchParams} params
   * @returns {string|null}
   */
  function parseEpochFromHash(params) {
    var val = params.get('epoch');
    if (!val) return null;
    return val;
  }

  /**
   * Write epoch to URL hash params.
   * Only writes when epoch is non-default (not v1, not null).
   *
   * @param {URLSearchParams} params
   * @param {string|null} epochId
   */
  function writeEpochToHash(params, epochId) {
    if (epochId && epochId !== 'v1') {
      params.set('epoch', epochId);
    } else {
      params.delete('epoch');
    }
  }

  /**
   * Produce a short display label for use in chips/dropdowns.
   * @param {{id:string, label:string}} epoch
   * @returns {string}
   */
  function shortLabel(epoch) {
    if (!epoch) return 'Legacy';
    // Extract parenthetical hint if present
    var m = epoch.label.match(/\(([^)]+)\)/);
    var hint = m ? ' (' + m[1] + ')' : '';
    return epoch.id.toUpperCase() + hint;
  }

  /**
   * For mixed-workload s20 series in v2, produce an appropriate label.
   * @param {string} epochId
   * @returns {string}
   */
  function epochWorkloadSuffix(epochId) {
    if (!epochId || epochId === 'v1') return '';
    return ' [' + epochId.toUpperCase() + ']';
  }

  exports.BUILTIN_EPOCHS = BUILTIN_EPOCHS;
  exports.resolveEpochs = resolveEpochs;
  exports.availableEpochs = availableEpochs;
  exports.seriesFilename = seriesFilename;
  exports.seriesUrl = seriesUrl;
  exports.notableUrl = notableUrl;
  exports.manifestUrl = manifestUrl;
  exports.parseEpochFromHash = parseEpochFromHash;
  exports.writeEpochToHash = writeEpochToHash;
  exports.shortLabel = shortLabel;
  exports.epochWorkloadSuffix = epochWorkloadSuffix;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.EpochHelpers = {}));
