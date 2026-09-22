/**
 * Pure helpers for ordering the perf / CPU-counter chart groups on the
 * dashboard.
 *
 * The manifest (produced by Conductress) lists groups in production order, but
 * that order leads with process-wide and kernel-interaction groups. For reading
 * a sweep — spotting a real gain/regression and understanding WHY it moved — the
 * most decision-useful groups should come first, and every per-thread metric
 * should sit next to its main/io twin so the pair reads side by side.
 *
 * This module owns two concerns:
 *   - which groups are hidden (the process-wide base groups; the dashboard shows
 *     the per-thread -main/-io variants instead), and
 *   - the explicit display order, most decision-useful first.
 *
 * Kept as a pure function (no DOM, no fetch) so it is unit-testable under
 * `node --test`, like the other lib/*.js helpers.
 */
(function (exports) {
  'use strict';

  // Process-wide base groups the dashboard does not render directly — it shows
  // their per-thread (-main/-io) variants instead. 'kernel' is the legacy
  // combined syscalls+context-switches group from pre-split manifests;
  // 'syscalls' and 'context-switches' are its single-metric replacements.
  const HIDE_GROUPS = [
    'throughput', 'memory',
    'efficiency', 'cache', 'pipeline', 'tma', 'branching',
    'kernel', 'syscalls', 'context-switches',
  ];

  // Explicit display order, most decision-useful first. Each -main is
  // immediately followed by its -io twin (and the two CPU-profile flamegraphs
  // form their own pair), so a metric's two threads render side by side.
  //
  //   1. Execution Efficiency — did work-per-request change? (IPC, insn/req, cycles/req)
  //   2. CPU Profile          — where did the time go? (flamegraph drill-down)
  //   3. Cache Pressure       — why: memory-hierarchy misses (icache/LLC MPKI)
  //   4. Pipeline Stalls      — why: frontend/backend stall cycles
  //   5. Pipeline Breakdown (TMA)
  //   6. Branch Prediction
  //   7. Syscalls             — kernel interaction, rarely the story on GET/SET
  //   8. Context Switches     — scheduler pressure, last
  //
  // 'kernel-main'/'kernel-io' are the legacy combined group from pre-split
  // manifests; they sort just before unknown groups so an old cached manifest
  // still renders sensibly.
  const GROUP_ORDER = [
    'efficiency-main', 'efficiency-io',
    'cpu-main', 'cpu-io',
    'cache-main', 'cache-io',
    'pipeline-main', 'pipeline-io',
    'tma-main', 'tma-io',
    'branching-main', 'branching-io',
    'syscalls-main', 'syscalls-io',
    'context-switches-main', 'context-switches-io',
    'kernel-main', 'kernel-io',
  ];

  function orderIndex(id) {
    const i = GROUP_ORDER.indexOf(id);
    // Unknown ids (a new manifest group the dashboard has not been taught to
    // rank yet) sort to the end, preserving their relative manifest order via a
    // stable sort, rather than vanishing.
    return i === -1 ? GROUP_ORDER.length : i;
  }

  /**
   * Filter out the hidden process-wide base groups and return the remaining
   * groups in decision-first display order (main/io pairs adjacent).
   *
   * @param {Array<{id:string}>} groups - manifest groups (any order)
   * @returns {Array<{id:string}>} visible groups, ordered for display
   */
  function orderPerfGroups(groups) {
    if (!Array.isArray(groups)) return [];
    return groups
      .filter(g => g && !HIDE_GROUPS.includes(g.id))
      .slice() // don't mutate the caller's array
      .sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
  }

  exports.HIDE_GROUPS = HIDE_GROUPS;
  exports.GROUP_ORDER = GROUP_ORDER;
  exports.orderPerfGroups = orderPerfGroups;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.PerfGroups = {}));
