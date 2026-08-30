/**
 * Pure-logic helpers extracted from status.html for testability.
 * Browser: loaded via <script src="lib/status-helpers.js"> before the main <script>.
 * Node tests: required via require()/import.
 *
 * Every function here is side-effect-free and DOM-independent.
 */

(function (exports) {
  'use strict';

  function formatScore(score, method) {
    if (!score) return '—';
    if (method === 'latency') return score.toFixed(0) + 'µs';
    if (score > 1e6) return (score / 1e6).toFixed(2) + 'M';
    if (score > 1e3) return (score / 1e3).toFixed(1) + 'K';
    return score.toFixed(1);
  }

  function timeAgo(str) {
    if (!str) return '';
    // Handle Conductress format: "2026.05.24_02.28.19.311128"
    let d = new Date(str);
    if (isNaN(d)) {
      const m = str.match(/^(\d{4})\.(\d{2})\.(\d{2})_(\d{2})\.(\d{2})\.(\d{2})/);
      if (m) d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    }
    const diff = (Date.now() - d.getTime()) / 1000;
    if (isNaN(diff)) return '';
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch];
    });
  }

  function shortSpecifier(value) {
    const text = String(value || '');
    return text.length > 8 ? text.slice(0, 8) + '\u2026' : text;
  }

  function formatDuration(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return '\u2014';
    var total = Math.round(Number(seconds));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var remainder = total % 60;
    if (hours) return hours + 'h ' + minutes + 'm';
    if (minutes) return minutes + 'm ' + remainder + 's';
    return remainder + 's';
  }

  function queueSummary(count, expectedSeconds) {
    var countText = count + ' task' + (count === 1 ? '' : 's');
    return expectedSeconds > 0 ? countText + ' \u00b7 ~' + formatDuration(expectedSeconds) + ' total' : countText;
  }

  function taskDescription(task) {
    return escapeHtml(task.note || task.specifier || task.type || 'Unnamed task');
  }

  function fmtBytes(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
    return b + ' B';
  }

  function diskTier(freePct) {
    if (freePct == null) return null;
    if (freePct < 5) return 'crit';
    if (freePct < 15) return 'warn';
    return null;
  }

  function renderFleetControl(data) {
    var fc = data.fleet_control;
    var iso = data.measurement_isolation || {};
    if (!fc) {
      return { summary: '<span class="control-off">Control not enabled</span>', banner: '', severity: null };
    }

    var reachable = fc.control_reachable;
    var reachClass = reachable === true ? 'control-ok' : reachable === false ? 'control-error' : 'control-off';
    var reachText = reachable === true ? 'control healthy' : reachable === false ? 'control unreachable' : 'control not contacted';
    var pending = fc.pending_outcomes_count || 0;
    var timerMigration = iso.status_timer_migration_required;
    var boundaryOnly = iso.boundary_publisher_active && !timerMigration;

    var severity = null;
    var banner = '';
    if (fc.mode !== 'off' && reachable === false) {
      severity = (fc.claim_failures_consecutive || 0) >= 3 ? 'crit' : 'warn';
      var pendingDetail = pending ? ' \u00b7 ' + pending + ' pending outcome' + (pending === 1 ? '' : 's') : '';
      banner = '<div class="card-banner ' + severity + '">\u26a0 Fleet control unreachable (' + (fc.claim_failures_consecutive || 1) + ' consecutive boundary failure' + ((fc.claim_failures_consecutive || 1) === 1 ? '' : 's') + ')' + pendingDetail + '</div>';
    } else if (pending > 0) {
      severity = 'warn';
      banner = '<div class="card-banner warn">\u26a0 ' + pending + ' terminal outcome' + (pending === 1 ? '' : 's') + ' pending control-plane delivery</div>';
    } else if (timerMigration) {
      severity = 'warn';
      banner = '<div class="card-banner warn">\u26a0 Periodic status timer migration still required</div>';
    }

    var summary = '<span class="' + reachClass + '">' + escapeHtml(fc.mode || 'off') + ' \u00b7 ' + reachText + '</span>'
      + (boundaryOnly ? ' \u00b7 boundary-only' : '');
    return { summary: summary, banner: banner, severity: severity };
  }

  function renderRemoteTasks(tasks) {
    if (tasks === null) return '<p class="empty-list control-warn">Mailbox feed unavailable</p>';
    if (!tasks.length) return '<p class="empty-list">Empty</p>';
    function renderItem(task) {
      var source = task.source && task.specifier ? task.source + '@' + shortSpecifier(task.specifier) : task.source || shortSpecifier(task.specifier);
      var expected = task.expected_duration_sec != null ? 'expected ' + formatDuration(task.expected_duration_sec) : null;
      var priority = task.priority != null ? 'priority ' + task.priority : null;
      var meta = [task.state, task.type, source, priority, expected].filter(Boolean).map(escapeHtml).join(' \u00b7 ');
      return '<li><div class="item-description">' + taskDescription(task) + '</div><div class="item-meta">' + meta + '</div></li>';
    }
    var visible = '<ul class="item-list">' + tasks.slice(0, 5).map(renderItem).join('') + '</ul>';
    var overflow = tasks.slice(5);
    if (!overflow.length) return visible;
    return visible + '<details class="task-overflow"><summary>Show ' + overflow.length + ' more task' + (overflow.length === 1 ? '' : 's') + '</summary><ul class="item-list">' + overflow.map(renderItem).join('') + '</ul></details>';
  }

  function taskTimeline(task, boundary, nowMs) {
    if (!boundary || boundary.state !== 'starting' || boundary.task_id !== task.id || !task.expected_duration_sec) return '';
    var started = new Date(boundary.timestamp).getTime();
    if (!Number.isFinite(started)) return '';
    var current = nowMs == null ? Date.now() : nowMs;
    var elapsed = Math.max(0, (current - started) / 1000);
    var expected = Number(task.expected_duration_sec);
    if (!(expected > 0)) return '';
    var remaining = expected - elapsed;
    var severity = elapsed > expected * 1.5 ? 'very-late' : elapsed > expected ? 'late' : '';
    var fillWidth = Math.min(100, (elapsed / expected) * 100);
    var stateText = remaining >= 0 ? 'ETA ' + formatDuration(remaining) : 'Overdue ' + formatDuration(-remaining);
    return '<div class="timeline" role="timer" aria-live="polite" aria-label="' + escapeHtml(stateText) + '">'
      + '<div class="timeline-label"><span>Elapsed ' + escapeHtml(formatDuration(elapsed)) + ' \u00b7 expected ' + escapeHtml(formatDuration(expected)) + '</span><span class="timeline-state ' + severity + '">' + escapeHtml(stateText) + '</span></div>'
      + '<div class="timeline-track" aria-hidden="true"><div class="timeline-fill ' + severity + '" style="width:' + fillWidth.toFixed(1) + '%"></div></div>'
      + '</div>';
  }

  function renderLocalTasks(queue, boundary, nowMs) {
    var tasks = queue && queue.tasks ? queue.tasks : [];
    if (!tasks.length) return '<p class="empty-list">Empty</p>';
    function renderItem(task) {
      var source = task.source && task.specifier ? task.source + '@' + shortSpecifier(task.specifier) : task.source || shortSpecifier(task.specifier);
      var expected = task.expected_duration_sec != null ? 'expected ' + formatDuration(task.expected_duration_sec) : null;
      var meta = [task.type, source, expected].filter(Boolean).map(escapeHtml).join(' \u00b7 ');
      var timeline = taskTimeline(task, boundary, nowMs);
      var currentClass = timeline ? ' class="current-task"' : '';
      return '<li' + currentClass + '><div class="item-description">' + taskDescription(task) + '</div><div class="item-meta">' + meta + '</div>' + timeline + '</li>';
    }
    var visible = '<ul class="item-list">' + tasks.slice(0, 5).map(renderItem).join('') + '</ul>';
    var overflow = tasks.slice(5);
    var details = overflow.length
      ? '<details class="task-overflow"><summary>Show ' + overflow.length + ' more task' + (overflow.length === 1 ? '' : 's') + '</summary><ul class="item-list">' + overflow.map(renderItem).join('') + '</ul></details>'
      : '';
    var unpublished = Math.max(0, (queue.depth || tasks.length) - tasks.length);
    var missing = unpublished ? '<div class="item-meta task-snapshot-note">' + unpublished + ' additional task' + (unpublished === 1 ? '' : 's') + ' not included in this boundary snapshot</div>' : '';
    return visible + details + missing;
  }

  function renderRecentResults(results) {
    if (!results || !results.length) return '<p class="empty-list">None</p>';
    return '<ul class="item-list">' + results.slice(0, 5).map(function (result) {
      var score = '<span class="score">' + formatScore(result.score, result.method) + '</span>';
      var observed = result.observed_duration_sec != null
        ? 'observed ' + escapeHtml(formatDuration(result.observed_duration_sec))
        : 'duration unavailable';
      var meta = [escapeHtml(result.method || ''), escapeHtml(shortSpecifier(result.commit)), score, observed, escapeHtml(timeAgo(result.completed))].filter(Boolean).join(' \u00b7 ');
      return '<li><div class="item-description">' + taskDescription(result) + '</div><div class="item-meta">' + meta + '</div></li>';
    }).join('') + '</ul>';
  }

  // ---------------------------------------------------------------------------
  // Terminal-boundary recheck scheduler
  //
  // When a 60s status fetch observes a RUNNING host whose boundary is terminal
  // (completed or failed) and whose local queue is empty, we schedule exactly
  // one deduplicated short follow-up fetch (~5s) for that boundary identity.
  //
  // Design constraints:
  //   - No indefinite 5s polling for genuinely idle hosts.
  //   - Only existing public static/control endpoints are contacted.
  //   - Duplicate timers are prevented across per-second rerenders and
  //     overlapping refreshes by keying on boundaryKey (hostId + boundary
  //     task_id + boundary timestamp).
  //   - A new terminal boundary naturally schedules a new follow-up because
  //     the key differs.
  //   - Normal 60s refresh and cached rendering are untouched.
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a host snapshot qualifies for a terminal-boundary
   * recheck: runner is running, boundary state is terminal (completed or
   * failed), and local queue is empty.
   *
   * @param {object} data - Host status snapshot.
   * @returns {{qualify: boolean, boundaryKey: string|null}}
   */
  function terminalRecheckQualifies(data) {
    if (!data) return { qualify: false, boundaryKey: null };

    var runnerState = data.runner && data.runner.state;
    if (runnerState !== 'running') return { qualify: false, boundaryKey: null };

    var boundary = data.boundary;
    if (!boundary) return { qualify: false, boundaryKey: null };

    var isTerminal = boundary.state === 'completed' || boundary.state === 'failed';
    if (!isTerminal) return { qualify: false, boundaryKey: null };

    var localDepth = data.queue && data.queue.depth || 0;
    if (localDepth > 0) return { qualify: false, boundaryKey: null };

    // Build a unique key from the boundary identity: task_id + timestamp.
    // Both must be present to form a valid dedup key.
    var taskId = boundary.task_id || '';
    var ts = boundary.timestamp || '';
    if (!taskId && !ts) return { qualify: false, boundaryKey: null };

    return { qualify: true, boundaryKey: taskId + ':' + ts };
  }

  /**
   * Create a RecheckScheduler that manages deduplicated follow-up timers.
   *
   * @param {object} opts
   * @param {function} opts.onRecheck - Called with (hostId) when a follow-up fires.
   * @param {number}   [opts.delayMs=5000] - Follow-up delay in ms.
   * @param {function} [opts.setTimeoutFn] - Injectable setTimeout (for testing).
   * @param {function} [opts.clearTimeoutFn] - Injectable clearTimeout (for testing).
   * @returns {object} scheduler with schedule(), pendingCount(), reset() methods.
   */
  function createRecheckScheduler(opts) {
    var onRecheck = opts.onRecheck;
    var delayMs = opts.delayMs != null ? opts.delayMs : 5000;
    var _setTimeout = opts.setTimeoutFn || setTimeout;
    var _clearTimeout = opts.clearTimeoutFn || clearTimeout;

    // At most one pending timer and one handled boundary identity per host.
    // Remembering the handled key after the timer fires prevents the regular
    // 60-second refresh from scheduling the same terminal boundary forever.
    var pending = {};
    var handledByHost = {};

    function schedule(hostId, boundaryKey) {
      var compositeKey = hostId + '::' + boundaryKey;
      if (handledByHost[hostId] === boundaryKey || pending[compositeKey] != null) return false;

      // A newer terminal boundary supersedes any still-pending one for this host.
      var hostPrefix = hostId + '::';
      Object.keys(pending).forEach(function (key) {
        if (key.indexOf(hostPrefix) === 0) {
          _clearTimeout(pending[key]);
          delete pending[key];
        }
      });

      handledByHost[hostId] = boundaryKey;
      var timerId = _setTimeout(function () {
        delete pending[compositeKey];
        onRecheck(hostId);
      }, delayMs);

      pending[compositeKey] = timerId;
      return true;
    }

    function pendingCount() {
      return Object.keys(pending).length;
    }

    function pendingKeys() {
      return Object.keys(pending);
    }

    function reset() {
      Object.keys(pending).forEach(function (key) {
        _clearTimeout(pending[key]);
      });
      pending = {};
      handledByHost = {};
    }

    return {
      schedule: schedule,
      pendingCount: pendingCount,
      pendingKeys: pendingKeys,
      reset: reset,
    };
  }

  // Export for Node.js / CommonJS; expose globally for browser.
  exports.formatScore = formatScore;
  exports.timeAgo = timeAgo;
  exports.escapeHtml = escapeHtml;
  exports.shortSpecifier = shortSpecifier;
  exports.formatDuration = formatDuration;
  exports.queueSummary = queueSummary;
  exports.taskDescription = taskDescription;
  exports.fmtBytes = fmtBytes;
  exports.diskTier = diskTier;
  exports.renderFleetControl = renderFleetControl;
  exports.renderRemoteTasks = renderRemoteTasks;
  exports.taskTimeline = taskTimeline;
  exports.renderLocalTasks = renderLocalTasks;
  exports.renderRecentResults = renderRecentResults;
  exports.terminalRecheckQualifies = terminalRecheckQualifies;
  exports.createRecheckScheduler = createRecheckScheduler;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.StatusHelpers = {}));
