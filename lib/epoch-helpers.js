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
   * The optional `archived` flag on a manifest epoch entry marks a retired
   * measurement generation. It is carried through as a strict boolean so the
   * selector can label and de-prioritize archived epochs. Entries that omit
   * the key (older manifests) resolve to `archived: false`.
   *
   * @param {Object|null} manifest — a single platform manifest
   * @returns {Array<{id:string, label:string, generator:string, archived:boolean}>}
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
        archived: e.archived === true,
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
   * An id is reported archived when ANY epoch-aware manifest marks it
   * archived, so a partially deployed fleet cannot un-archive an epoch.
   *
   * @param {Object<string, Object>} platformManifests — keyed by platform id
   * @returns {Array<{id:string, label:string, generator:string, archived:boolean}>}
   */
  function availableEpochs(platformManifests) {
    if (!platformManifests) return [];
    var keys = Object.keys(platformManifests);
    if (keys.length === 0) return [];

    // Collect per-platform epoch id sets
    var order = null; // first platform's full epoch list — defines label/order
    var idSets = [];
    var archivedById = {}; // id -> true if any manifest marks it archived
    for (var i = 0; i < keys.length; i++) {
      var epochs = resolveEpochs(platformManifests[keys[i]]);
      if (epochs.length === 0) continue; // v2 manifest — no epochs
      if (!order) order = epochs;
      var idSet = {};
      epochs.forEach(function (e) {
        idSet[e.id] = true;
        if (e.archived === true) archivedById[e.id] = true;
      });
      idSets.push(idSet);
    }
    if (!order || idSets.length === 0) return [];

    // Intersection: keep only ids present in ALL epoch-aware manifests.
    // Archived flag is the OR across manifests (any archived -> archived).
    return order
      .filter(function (e) {
        return idSets.every(function (s) { return s[e.id]; });
      })
      .map(function (e) {
        return {
          id: e.id,
          label: e.label,
          generator: e.generator,
          archived: archivedById[e.id] === true,
        };
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

  /**
   * Choose the epoch to open on when no hash state selects one.
   * Returns the id of the first non-archived entry; when every entry is
   * archived (or the list is empty) falls back to the first entry's id,
   * and null when there is nothing to select. Manifests that predate the
   * archived flag carry no archived entries, so this reduces to the first
   * listed epoch for them.
   *
   * @param {Array<{id:string, archived?:boolean}>} epochList
   * @returns {string|null}
   */
  function defaultEpochId(epochList) {
    if (!Array.isArray(epochList) || epochList.length === 0) return null;
    var live = epochList.find(function (e) { return e && e.archived !== true; });
    if (live) return live.id;
    return epochList[0] ? (epochList[0].id != null ? epochList[0].id : null) : null;
  }

  /**
   * Selector option text for an epoch: the label, suffixed with
   * " (archived)" when the epoch is archived.
   *
   * @param {{label:string, archived?:boolean}} epoch
   * @returns {string}
   */
  function epochOptionLabel(epoch) {
    if (!epoch) return '';
    var label = epoch.label != null ? epoch.label : '';
    return epoch.archived === true ? label + ' (archived)' : label;
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
  exports.defaultEpochId = defaultEpochId;
  exports.epochOptionLabel = epochOptionLabel;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.EpochHelpers = {}));
