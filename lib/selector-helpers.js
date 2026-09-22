/**
 * Pure helpers for the workload selector panel on the Performance History page.
 *
 * The panel lists every (engine, platform, workload) the manifests offer. It
 * shows two sections: the series currently selected, in selection order (which
 * is also the colour and legend order of the chart), and the unselected series
 * that match the active filter chips. Filters never hide a selected row, so a
 * user can always deselect what is on the chart.
 *
 * Kept free of DOM so it is unit-testable under `node --test`.
 */
(function (exports) {
  'use strict';

  /** Stable key for one selectable series. */
  function selectionKey(s) { return s.engine + ':' + s.platform + ':' + s.workloadId; }

  /**
   * Parse the parameters encoded in a throughput workload id such as
   * "get-k16-v128-t7-p10" or "mixed-s20-k16-v16-t7-p1". Unknown shapes yield
   * nulls so the row still renders with whatever is known.
   */
  function parseWorkloadId(id) {
    var m = String(id || '').match(/^(get|set|mixed-s\d+)-k\d+-v(\d+)-t(\d+)-p(\d+)/);
    return {
      command: m ? m[1] : null,
      valsize: m ? m[2] : null,
      threads: m ? m[3] : null,
      pipelining: m ? m[4] : null,
    };
  }

  /** True when an item passes every active chip filter (null = no filter). */
  function matchesFilters(item, filters) {
    var f = filters || {};
    if (f.engine && item.engine !== f.engine) return false;
    if (f.platform && item.platform !== f.platform) return false;
    if (f.command && item.command !== f.command) return false;
    if (f.valsize && item.valsize !== f.valsize) return false;
    if (f.pipelining && item.pipelining !== f.pipelining) return false;
    return true;
  }

  /**
   * Split the selectable items into the two panel sections.
   *
   * @param {Array} items      every selectable item ({engine, platform, workloadId, ...})
   * @param {Array} selected   current selection, in selection order
   * @param {Object} filters   active chip filters
   * @param {Object} [sort]    {col, dir, columns} — `columns` is the column
   *                           table keyed by `key` with `val(item)` and `num`
   * @returns {{selected: Array, available: Array}}
   *   `selected` follows the selection order and ignores filters. A selected
   *   entry with no matching item (a bookmark naming a series the manifest no
   *   longer lists) is synthesized from its id so it can still be deselected.
   *   `available` is the filtered, unselected remainder, sorted when asked.
   */
  function partitionSelectorItems(items, selected, filters, sort) {
    var byKey = {};
    (items || []).forEach(function (it) { byKey[selectionKey(it)] = it; });
    var selectedKeys = {};
    var selectedRows = (selected || []).map(function (s) {
      var key = selectionKey(s);
      selectedKeys[key] = true;
      if (byKey[key]) return byKey[key];
      var parsed = parseWorkloadId(s.workloadId);
      return {
        engine: s.engine, platform: s.platform, workloadId: s.workloadId,
        label: s.workloadId, engineLabel: s.engine, platLabel: s.platform,
        command: parsed.command, valsize: parsed.valsize, threads: parsed.threads, pipelining: parsed.pipelining,
        missing: true,
      };
    });
    var available = (items || []).filter(function (it) {
      return !selectedKeys[selectionKey(it)] && matchesFilters(it, filters);
    });
    if (sort && sort.col && Array.isArray(sort.columns)) {
      var c = sort.columns.find(function (x) { return x.key === sort.col; });
      var dir = sort.dir < 0 ? -1 : 1;
      if (c) {
        available = available.slice().sort(function (a, b) {
          return c.num
            ? (c.val(a) - c.val(b)) * dir
            : String(c.val(a)).localeCompare(String(c.val(b))) * dir;
        });
      }
    }
    return { selected: selectedRows, available: available };
  }

  /**
   * Columns worth rendering: those whose text varies across the rows shown in
   * either section (so both sections share one aligned column set, and a
   * pinned filter collapses its column). Falls back to `fallback` when nothing
   * varies, e.g. a single row.
   */
  function visibleColumns(rows, columns, fallback) {
    var vary = (columns || []).filter(function (c) {
      var seen = {};
      var n = 0;
      (rows || []).forEach(function (r) { var t = c.text(r); if (!seen[t]) { seen[t] = true; n++; } });
      return n > 1;
    });
    return vary.length ? vary : (fallback || []);
  }

  exports.selectionKey = selectionKey;
  exports.parseWorkloadId = parseWorkloadId;
  exports.matchesFilters = matchesFilters;
  exports.partitionSelectorItems = partitionSelectorItems;
  exports.visibleColumns = visibleColumns;
})(typeof module !== 'undefined' && module.exports ? module.exports : (this.SelectorHelpers = {}));
