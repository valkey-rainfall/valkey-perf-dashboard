/**
 * Per-metric help for the Performance Counters charts (the "?" on each card).
 *
 * The section-level help explains the counters as a family; this answers the
 * question a reader has in front of ONE chart: what is this number, which way
 * is good, what moves it, and when should I distrust it. Text is keyed by base
 * metric ("ipc", "icache-mpki") so the main-thread and IO-thread variants share
 * it, with a thread line appended. CPU-profile and TMA panels keep their
 * section help (HELP_TEXT.cpu / HELP_TEXT.tma): they are breakdowns, not one
 * number.
 *
 * The recurring theme is binary-layout noise. Function placement and alignment
 * change with nearly every commit and move the cache/branch counters without
 * any change to the work done. Each entry says whether it is immune to that,
 * exposed to it, or is one of the "tells" that identify it.
 *
 * Pure module: no DOM, no fetch. Loaded as a browser global (MetricHelp) and as
 * a CommonJS module for tests.
 */
(function (exports) {
  'use strict';

  var LAYOUT = {
    immune:  'Immune to binary layout: the count does not depend on where the code sits.',
    exposed: 'Exposed to binary layout: function placement and alignment move this without any change to the work done.',
    tell:    'A layout tell: when this jumps while instructions/request stays flat, the cause is usually placement and alignment, not the change itself.',
  };

  /**
   * id -> { name, formula, direction, moves, read, layout }
   *   direction: 'lower' | 'higher' (which way is good)
   *   moves:     what changes it (mechanisms, not a list of commits)
   *   read:      how to interpret a move, in the context of the other counters
   *   layout:    'immune' | 'exposed' | 'tell'
   */
  var HELP = {
    'instructions-per-req': {
      name: 'Instructions / request',
      formula: 'retired instructions ÷ requests completed',
      direction: 'lower',
      moves: 'the code path: inlining decisions, added checks, prefetch instructions, allocator calls, compiler and flag changes.',
      read: 'This is the arbiter. If it moved, the executed code changed. If it is flat, a cycles/request move came from stalls (data or layout), not from more work.',
      layout: 'immune',
    },
    'cycles-per-req': {
      name: 'Cycles / request',
      formula: 'CPU cycles ÷ requests completed, equal to instructions/request ÷ IPC',
      direction: 'lower',
      moves: 'both the amount of work (instructions) and how fast it retires (stalls on cache, memory, branches, frontend).',
      read: 'The counter that maps to throughput: per-core requests/s ≈ clock ÷ cycles/request. To split a move, check instructions/request (work) against IPC and the MPKI charts (stalls).',
      layout: 'exposed',
    },
    'ipc': {
      name: 'IPC',
      formula: 'retired instructions ÷ CPU cycles',
      direction: 'higher',
      moves: 'microarchitectural efficiency: cache misses, branch mispredicts, frontend and backend stalls, memory latency. Valkey runs around 2.4 to 3.4 depending on platform.',
      read: 'Derived from instructions/request and cycles/request, so it adds no independent signal: a higher IPC with flat instructions/request means stalls fell, and a lower IPC with higher instructions/request can still be faster if the added instructions are cheap (prefetches, for example).',
      layout: 'exposed',
    },
    'icache-mpki': {
      name: 'Icache MPKI',
      formula: 'L1 instruction-cache misses per 1,000 retired instructions',
      direction: 'lower',
      moves: 'code layout (function placement, alignment, hot-path fragmentation) and code size. Values above about 5 suggest the hot path no longer fits.',
      read: 'The primary tell for layout noise. A real code-size change shows up in instructions/request too; a layout shuffle does not.',
      layout: 'tell',
    },
    'branch-mpki': {
      name: 'Branch MPKI',
      formula: 'branch mispredictions per 1,000 retired instructions',
      direction: 'lower',
      moves: 'new data-dependent branches, changed branch patterns, and alignment shifts that alias in the branch predictor tables. Usually stable for Valkey, around 2 to 4.',
      read: 'The second layout tell. With flat instructions/request a move here is predictor aliasing from alignment; with rising instructions/request it is probably genuinely new branches.',
      layout: 'tell',
    },
    'llc-mpki': {
      name: 'LLC MPKI',
      formula: 'last-level cache misses per 1,000 retired instructions',
      direction: 'lower',
      moves: 'data footprint and access pattern: hash table size and bucket layout, object sizes, pointer chasing, software prefetching.',
      read: 'The data-side counter. If cycles/request rose while instructions/request, icache MPKI and branch MPKI are all flat, look here: the change moved or grew data, not code.',
      layout: 'immune',
    },
    'frontend-stall-pct': {
      name: 'Frontend stall %',
      formula: 'share of cycles in which the frontend delivered no instructions to execute',
      direction: 'lower',
      moves: 'instruction-cache and iTLB misses, branch mispredict recovery, large or fragmented code.',
      read: 'Confirms what icache and branch MPKI suggest. Platforms define the stall events differently, so compare within one platform.',
      layout: 'exposed',
    },
    'backend-stall-pct': {
      name: 'Backend stall %',
      formula: 'share of cycles in which execution was blocked waiting on data or execution resources',
      direction: 'lower',
      moves: 'cache misses and memory latency (random hash lookups dominate for Valkey), long dependency chains, port contention.',
      read: 'The main thread is backend-bound by design. A fall here with flat instructions/request means a data-layout or prefetching win. Platforms define the stall events differently, so compare within one platform.',
      layout: 'immune',
    },
    'syscalls-per-req': {
      name: 'Syscalls / request',
      formula: 'system calls ÷ requests completed',
      direction: 'lower',
      moves: 'IO batching: pipeline depth, how many commands a read or write carries, epoll and io_uring usage.',
      read: 'Mostly fixed by the workload definition. A move from a code commit means the IO batching changed; the kernel share of cycles/request follows it.',
      layout: 'immune',
    },
    'context-switches-per-sec': {
      name: 'Context switches / s',
      formula: 'context switches per second on this thread',
      direction: 'lower',
      moves: 'blocking and wakeups: sleep-versus-spin choices in the IO threads, main-to-IO handoffs, scheduler interference.',
      read: 'A jump means threads are parking and waking more often. That is not a regression on its own; judge it against throughput and cycles/request, since a thread that sleeps instead of spinning switches more and burns less.',
      layout: 'immune',
    },
  };

  var THREAD = {
    main: 'Main thread: the serial command-execution loop. At saturation it bounds throughput, so per-request numbers here map most directly to requests/s.',
    io: 'IO threads: socket read and write plus RESP parsing, summed across the io-threads workers. They busy-wait between events, so spin instructions and cycles are included; per-thread figures are an upper bound on useful work.',
  };

  var SCOPE_NOTE = 'Counters include kernel time in the cachecannon-v3 epoch and user time only before it. Runs with different scope are drawn as separate lines and never compared.';

  var DIRECTION_TEXT = { lower: 'Lower is better.', higher: 'Higher is better.' };

  function splitThread(id) {
    var m = /^(.*)-(main|io)$/.exec(String(id || ''));
    return m ? { base: m[1], thread: m[2] } : { base: String(id || ''), thread: null };
  }

  /** True when a per-chart "?" should be offered for this metric id. */
  function hasHelp(metricId) {
    return Object.prototype.hasOwnProperty.call(HELP, splitThread(metricId).base);
  }

  /**
   * Structured help for a metric id, or null for ids this module does not
   * know (panel metrics, unknown manifest additions).
   */
  function helpFor(metricId) {
    var s = splitThread(metricId);
    var h = HELP[s.base];
    if (!h) return null;
    return {
      id: String(metricId),
      base: s.base,
      thread: s.thread,
      title: h.name + (s.thread ? ' — ' + (s.thread === 'main' ? 'Main thread' : 'IO threads') : ''),
      formula: h.formula,
      direction: h.direction,
      directionText: DIRECTION_TEXT[h.direction],
      moves: h.moves,
      read: h.read,
      layout: h.layout,
      layoutText: LAYOUT[h.layout],
      threadText: s.thread ? THREAD[s.thread] : null,
      scopeNote: SCOPE_NOTE,
    };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** HTML body for the help modal; null when helpFor() is null. */
  function renderHelp(metricId) {
    var h = helpFor(metricId);
    if (!h) return null;
    var parts = [
      '<p><strong>What it is:</strong> ' + esc(h.formula) + '. ' + esc(h.directionText) + '</p>',
      '<p><strong>What moves it:</strong> ' + esc(h.moves) + '</p>',
      '<p><strong>How to read a change:</strong> ' + esc(h.read) + '</p>',
      '<p><strong>Layout noise:</strong> ' + esc(h.layoutText) + '</p>',
    ];
    if (h.threadText) parts.push('<p><strong>Thread:</strong> ' + esc(h.threadText) + '</p>');
    parts.push('<p class="help-note">' + esc(h.scopeNote) + '</p>');
    return parts.join('\n');
  }

  exports.HELP = HELP;
  exports.THREAD = THREAD;
  exports.LAYOUT = LAYOUT;
  exports.SCOPE_NOTE = SCOPE_NOTE;
  exports.splitThread = splitThread;
  exports.hasHelp = hasHelp;
  exports.helpFor = helpFor;
  exports.renderHelp = renderHelp;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.MetricHelp = {}));
