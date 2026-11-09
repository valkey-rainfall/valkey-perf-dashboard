/**
 * canary-helpers.js -- pure helpers for canary.html.
 *
 * The control service publishes two static files under DATA_URL/canary/:
 *
 *   - findings.json: environment EVENTS, one per observation gap of one
 *     runner (or one pooled fleet row per harness deploy), each tested
 *     against the daily fixed-commit canary and the paired sweep series.
 *     Each event has a state, an effect with a 95% interval, q, severity
 *     and the tests behind it.
 *   - consistency.json: the positive side, one entry per runner (streak,
 *     spread, events cleared, missing days) plus a fleet line.
 *
 * "No evidence of change" (cleared) and "not enough data"
 * (insufficient-data) are different claims. Every helper here keeps them
 * apart in words, never only in colour.
 *
 * Absent data resolves to null or "n/a", never to a made-up zero.
 *
 * Browser: loaded via <script src="lib/canary-helpers.js">.
 * Node:    const C = require('./lib/canary-helpers.js');
 */
'use strict';

(function (exports) {

  var FINDINGS_MAX_AGE_MS = 26 * 3600000;

  // ---------------------------------------------------------------- states

  // Page order of the states (design 3.1 and the Q8 decision): an unknown
  // state sorts last.
  var STATE_ORDER = ['confirmed', 'suspected', 'insufficient-data',
    'suspected-fleet', 'explained', 'cleared'];

  var STATES = {
    'confirmed': { word: 'confirmed', cls: 'confirmed', open: true },
    'suspected': { word: 'suspected', cls: 'suspected', open: true },
    'insufficient-data': { word: 'not enough data', cls: 'insufficient', open: false },
    'suspected-fleet': { word: 'suspected (fleet-wide)', cls: 'fleet', open: false },
    'explained': { word: 'explained', cls: 'explained', open: false },
    'cleared': { word: 'no evidence of change', cls: 'cleared', open: false },
  };

  /**
   * Word and CSS class for a state. A cleared test with a small but
   * significant shift reads "small shift below the floor", so a real small
   * shift is not called "no change".
   *
   * @returns {{word:string, cls:string, open:boolean}}
   */
  function stateInfo(state, belowFloorShift) {
    if (state === 'cleared' && belowFloorShift) {
      return { word: 'small shift below the floor', cls: 'cleared-shift', open: false };
    }
    var s = STATES[state];
    if (s) return { word: s.word, cls: s.cls, open: s.open };
    return { word: 'unknown state', cls: 'unknown', open: false };
  }

  function stateRank(state) {
    var i = STATE_ORDER.indexOf(state);
    return i < 0 ? STATE_ORDER.length : i;
  }

  /** Open finding: confirmed or suspected (explained events are not open). */
  function isOpen(ev) {
    return !!(ev && (ev.state === 'confirmed' || ev.state === 'suspected'));
  }

  function isFleet(ev) {
    return !!(ev && ev.runner_id == null && ev.fleet && typeof ev.fleet === 'object');
  }

  function num(x) {
    return typeof x === 'number' && isFinite(x) ? x : null;
  }

  /**
   * Events in page order: state, then severity (high first), then date
   * (newest first), then event id for a stable result. Does not mutate.
   */
  function sortEvents(events) {
    if (!Array.isArray(events)) return [];
    return events.filter(function (e) { return e && typeof e === 'object'; })
      .slice()
      .sort(function (a, b) {
        var r = stateRank(a.state) - stateRank(b.state);
        if (r) return r;
        var sa = num(a.severity) || 0, sb = num(b.severity) || 0;
        if (sa !== sb) return sb - sa;
        var da = String(a.date || ''), db = String(b.date || '');
        if (da !== db) return da < db ? 1 : -1;
        var ia = String(a.event_id || ''), ib = String(b.event_id || '');
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      });
  }

  // Default view: what may still need a person. Open findings (confirmed,
  // suspected) and fleet-wide suspected rows always; "not enough data" only
  // while the event is recent and still collecting days. Older "not enough
  // data" rows and every cleared or explained row are under "all events".
  var OPEN_STATES = ['confirmed', 'suspected', 'suspected-fleet'];
  var COLLECTING_STATES = ['insufficient-data'];
  var RECENT_DAYS = 14;

  /** True when the event date is within RECENT_DAYS of now (ms); undated or unparsable: false. */
  function isRecent(ev, now) {
    var t = Date.parse(String(ev && ev.date || '') + 'T00:00:00Z');
    if (isNaN(t)) return false;
    return nowMs(now) - t <= RECENT_DAYS * 86400000;
  }

  /** Whether the default view shows the event (see OPEN_STATES and COLLECTING_STATES). */
  function inDefaultView(ev, now) {
    if (!ev) return false;
    if (OPEN_STATES.indexOf(ev.state) >= 0) return true;
    return COLLECTING_STATES.indexOf(ev.state) >= 0 && isRecent(ev, now);
  }

  /** True when the event involves the runner (fleet rows: any member). */
  function involvesRunner(ev, runnerId) {
    if (!runnerId) return true;
    if (ev.runner_id === runnerId) return true;
    if (isFleet(ev) && Array.isArray(ev.fleet.runners)) {
      return ev.fleet.runners.some(function (r) { return r && r.runner_id === runnerId; });
    }
    return false;
  }

  /**
   * Filter events. scope 'open' keeps the default view (inDefaultView, with
   * opts.now as the clock: the analysis time on the page), 'all' keeps every
   * event. runner (an id, or '' for every runner) keeps the events of that
   * runner and the fleet rows it is part of.
   */
  function filterEvents(events, opts) {
    var o = opts || {};
    var scope = o.scope === 'all' ? 'all' : 'open';
    return (Array.isArray(events) ? events : []).filter(function (ev) {
      if (!ev || typeof ev !== 'object') return false;
      if (scope === 'open' && !inDefaultView(ev, o.now)) return false;
      return involvesRunner(ev, o.runner || '');
    });
  }

  /** Runners for the filter: [{id, name}] sorted by name, fleet rows excluded. */
  function runnerOptions(events, consistency) {
    var names = runnerNames(events, consistency);
    return Object.keys(names).sort(function (a, b) {
      return names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : 0;
    }).map(function (id) { return { id: id, name: names[id] }; });
  }

  /** Map runner id -> display name from both files (id when no name). */
  function runnerNames(events, consistency) {
    var out = {};
    var runners = consistency && Array.isArray(consistency.runners) ? consistency.runners : [];
    runners.forEach(function (r) {
      if (r && typeof r.runner_id === 'string') out[r.runner_id] = r.display_name || r.runner_id;
    });
    (Array.isArray(events) ? events : []).forEach(function (e) {
      if (e && typeof e.runner_id === 'string' && !out[e.runner_id]) {
        out[e.runner_id] = e.display_name || e.runner_id;
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- time

  function nowMs(now) {
    if (now instanceof Date) return now.getTime();
    if (typeof now === 'number') return now;
    return Date.now();
  }

  /** True when generated_at is missing, unreadable or older than 26 h. */
  function isStale(generatedAt, now) {
    var at = Date.parse(generatedAt);
    if (isNaN(at)) return true;
    return nowMs(now) - at > FINDINGS_MAX_AGE_MS;
  }

  /** "2026-11-09 12:00 UTC", or "unknown time". */
  function formatUtc(iso) {
    var at = Date.parse(iso);
    if (isNaN(at)) return 'unknown time';
    var d = new Date(at).toISOString();
    return d.slice(0, 10) + ' ' + d.slice(11, 16) + ' UTC';
  }

  // ---------------------------------------------------------------- numbers

  /** "+12.29%" / "-0.37%"; "n/a" when absent. */
  function formatPct(x, digits) {
    var v = num(x);
    if (v === null) return 'n/a';
    var d = typeof digits === 'number' ? digits : 2;
    var s = Math.abs(v).toFixed(d);
    if (Number(s) === 0) return (0).toFixed(d) + '%';
    return (v > 0 ? '+' : '-') + s + '%';
  }

  function ciValid(ci) {
    return Array.isArray(ci) && ci.length === 2 && num(ci[0]) !== null && num(ci[1]) !== null;
  }

  /** "+11.71..+12.56%", or "no interval" when the interval is missing. */
  function formatCi(ci, digits) {
    if (!ciValid(ci)) return 'no interval';
    return formatPct(ci[0], digits).replace('%', '') + '..' + formatPct(ci[1], digits);
  }

  /** Confidence (1 - q) with 3 decimals, or "n/a". */
  function formatConfidence(c) {
    var v = num(c);
    return v === null ? 'n/a' : v.toFixed(3);
  }

  /** q or p: 3 significant digits, "< 0.001" below that. */
  function formatQ(q) {
    var v = num(q);
    if (v === null) return 'n/a';
    if (v < 0.001) return '< 0.001';
    return String(Number(v.toPrecision(2)));
  }

  /** Share in [0, 1] as "100%", or "n/a". */
  function formatShare(x) {
    var v = num(x);
    return v === null ? 'n/a' : Math.round(v * 100) + '%';
  }

  /** Score as "615.7k" / "1.23M" / "950". */
  function formatScore(x) {
    var v = num(x);
    if (v === null) return 'n/a';
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  /** Z with sign and 2 decimals, or "n/a". */
  function formatZ(z) {
    var v = num(z);
    if (v === null) return 'n/a';
    return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(2);
  }

  // ---------------------------------------------------------------- evidence

  function canaryTest(ev) {
    var tests = ev && Array.isArray(ev.tests) ? ev.tests : [];
    for (var i = 0; i < tests.length; i++) {
      if (tests[i] && tests[i].kind === 'canary') return tests[i];
    }
    return null;
  }

  /**
   * Evidence count for the list: "3 days after, 97 pairs" for a runner
   * event; "4 runners" for a fleet row; "no tests" when there are none.
   * Pairs count the paired tests that have an interval.
   */
  function evidenceText(ev) {
    if (isFleet(ev)) {
      var n = Array.isArray(ev.fleet.runners) ? ev.fleet.runners.length : 0;
      return n + ' runner' + (n === 1 ? '' : 's');
    }
    var parts = [];
    var c = canaryTest(ev);
    if (c && num(c.n_after) !== null) {
      parts.push(c.n_after + ' day' + (c.n_after === 1 ? '' : 's') + ' after');
    }
    var pairs = 0;
    (ev && Array.isArray(ev.tests) ? ev.tests : []).forEach(function (t) {
      if (t && t.kind !== 'canary' && ciValid(t.ci_pct) && num(t.n_after) !== null) pairs += t.n_after;
    });
    if (pairs) parts.push(pairs + ' pair' + (pairs === 1 ? '' : 's'));
    return parts.length ? parts.join(', ') : 'no tests';
  }

  /** "kernel: kernel-3 -> kernel-2", or the label alone when no values. */
  function fieldText(f) {
    if (!f || typeof f !== 'object') return '';
    var label = String(f.label || f.field || 'change');
    var hasOld = f.old != null && f.old !== '';
    var hasNew = f.new != null && f.new !== '';
    if (hasOld || hasNew) {
      return label + ': ' + (hasOld ? String(f.old) : 'none') + ' -> ' + (hasNew ? String(f.new) : 'none');
    }
    return label;
  }

  /**
   * What changed, on one line for the event row: every field ("kernel:
   * 6.1.170 -> 6.1.189; glibc; reboot"), cut at maxChars with "+N more".
   * Empty when the event lists no fields.
   */
  function fieldsSummary(ev, maxChars) {
    var limit = num(maxChars) || 140;
    var parts = (ev && Array.isArray(ev.fields) ? ev.fields : []).map(fieldText).filter(Boolean);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var next = out ? out + '; ' + parts[i] : parts[i];
      if (next.length > limit && out) {
        return out + ' (+' + (parts.length - i) + ' more)';
      }
      out = next;
    }
    return out;
  }

  /** Row data for the tests table of one event. */
  function testRows(ev) {
    return (ev && Array.isArray(ev.tests) ? ev.tests : []).filter(Boolean).map(function (t) {
      var nb = num(t.n_before), na = num(t.n_after);
      var n = t.kind === 'canary'
        ? (nb === null ? 'n/a' : nb) + ' before, ' + (na === null ? 'n/a' : na) + ' after'
        : (na === null ? 'n/a' : na + ' pair' + (na === 1 ? '' : 's'));
      var st = stateInfo(t.state, t.below_floor_shift);
      return {
        series: String(t.series || 'unnamed series'),
        n: n,
        effect: formatPct(t.effect_pct),
        ci: formatCi(t.ci_pct),
        q: formatQ(t.q),
        state: st.word,
        stateCls: st.cls,
        sameDirection: t.kind === 'canary' ? 'n/a' : formatShare(t.same_direction),
      };
    });
  }

  /**
   * Strict-window text for the canary test (window cut at the next event
   * of any kind), or null when not published.
   */
  function strictText(ev) {
    var c = canaryTest(ev);
    if (!c || num(c.effect_strict_pct) === null) return null;
    var n = num(c.n_after_strict);
    return formatPct(c.effect_strict_pct) + (n === null ? '' : ' (' + n + ' day' + (n === 1 ? '' : 's') + ' after)');
  }

  // ---------------------------------------------------------------- CI bar

  /**
   * Shared scale for the list's interval bars: the largest absolute CI
   * bound or effect over the rows, kept between 1% and 1.5% so small
   * effects stay readable. Rows outside
   * the scale are clipped and marked (the text still gives the numbers).
   */
  function ciScale(events) {
    var m = 0;
    (Array.isArray(events) ? events : []).forEach(function (e) {
      if (!e) return;
      [num(e.effect_pct)].concat(ciValid(e.ci_pct) ? e.ci_pct : []).forEach(function (v) {
        if (v !== null && Math.abs(v) > m) m = Math.abs(v);
      });
    });
    return Math.min(1.5, Math.max(1, m));
  }

  /**
   * Geometry of one interval bar of `width` px for domain [-scale, +scale].
   * Returns null when there is neither an effect nor an interval.
   * Fields: zero, x0/x1 (interval, null when none), dot (effect, null when
   * none), floor0/floor1 (+/- floor band, null when no floor), clipLeft,
   * clipRight.
   */
  function ciBar(ci, effect, floorPct, scale, width) {
    var s = num(scale) && scale > 0 ? scale : 1;
    var w = num(width) && width > 0 ? width : 100;
    var eff = num(effect);
    var hasCi = ciValid(ci);
    if (eff === null && !hasCi) return null;
    var clipL = false, clipR = false;
    function x(v) {
      if (v < -s) { clipL = true; v = -s; }
      if (v > s) { clipR = true; v = s; }
      return (v + s) / (2 * s) * w;
    }
    var lo = hasCi ? Math.min(ci[0], ci[1]) : null;
    var hi = hasCi ? Math.max(ci[0], ci[1]) : null;
    var out = {
      zero: w / 2,
      x0: hasCi ? x(lo) : null,
      x1: hasCi ? x(hi) : null,
      dot: eff === null ? null : x(eff),
      floor0: null,
      floor1: null,
    };
    var f = num(floorPct);
    if (f !== null && f > 0) {
      // The floor band is context: never marks a clip.
      var saveL = clipL, saveR = clipR;
      out.floor0 = x(-f);
      out.floor1 = x(f);
      clipL = saveL; clipR = saveR;
    }
    out.clipLeft = clipL;
    out.clipRight = clipR;
    return out;
  }

  // ---------------------------------------------------------------- plot

  function median(xs) {
    var a = xs.filter(function (v) { return num(v) !== null; }).slice().sort(function (p, q) { return p - q; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /**
   * Scale an event's plot ({dates[], scores[], event_index, cut_dates[]})
   * into an SVG box. Points before event_index are 'before', the rest
   * 'after'. The y range covers every score and the CI band, with 8%
   * margin. Returns null when there are no usable scores.
   *
   * @returns {{points:Array, before:Object|null, after:Object|null,
   *   band:Object|null, cuts:Array, yMin:number, yMax:number,
   *   x:function, y:function}}
   */
  function plotGeometry(plot, ci, width, height, pad) {
    if (!plot || !Array.isArray(plot.scores) || !Array.isArray(plot.dates)) return null;
    var p = pad || { left: 56, right: 12, top: 12, bottom: 28 };
    var n = Math.min(plot.scores.length, plot.dates.length);
    var ok = [];
    for (var i = 0; i < n; i++) if (num(plot.scores[i]) !== null) ok.push(i);
    if (!ok.length) return null;
    var ei = num(plot.event_index);
    if (ei === null) ei = n;
    var beforeS = [], afterS = [];
    ok.forEach(function (i) { (i < ei ? beforeS : afterS).push(plot.scores[i]); });
    var mb = median(beforeS), ma = median(afterS);
    var band = null;
    if (mb !== null && afterS.length && ciValid(ci)) {
      band = { lo: mb * (1 + Math.min(ci[0], ci[1]) / 100), hi: mb * (1 + Math.max(ci[0], ci[1]) / 100) };
    }
    var vals = ok.map(function (i) { return plot.scores[i]; });
    if (band) vals.push(band.lo, band.hi);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = hi - lo || Math.abs(hi) * 0.01 || 1;
    var yMin = lo - span * 0.08, yMax = hi + span * 0.08;
    var iw = width - p.left - p.right, ih = height - p.top - p.bottom;
    function x(idx) { return p.left + (n <= 1 ? iw / 2 : idx / (n - 1) * iw); }
    function y(v) { return p.top + (yMax - v) / (yMax - yMin) * ih; }
    // Boundary between the windows: half way between the last before day
    // and the first after day.
    var splitX = ei <= 0 ? x(0) : ei >= n ? x(n - 1) : (x(ei - 1) + x(ei)) / 2;
    var points = ok.map(function (i) {
      return { x: x(i), y: y(plot.scores[i]), date: String(plot.dates[i]), score: plot.scores[i], side: i < ei ? 'before' : 'after' };
    });
    var cuts = (Array.isArray(plot.cut_dates) ? plot.cut_dates : []).map(function (d) {
      var k = plot.dates.indexOf(d);
      if (k < 0) return null;
      var cx = k === 0 ? x(0) : (x(k - 1) + x(k)) / 2;
      return { date: String(d), x: cx };
    }).filter(Boolean);
    return {
      points: points,
      before: mb === null ? null : { value: mb, y: y(mb), x0: x(0), x1: splitX },
      after: ma === null ? null : { value: ma, y: y(ma), x0: splitX, x1: x(n - 1) },
      band: band ? { y0: y(band.hi), y1: y(band.lo), x0: splitX, x1: x(n - 1), lo: band.lo, hi: band.hi } : null,
      cuts: cuts,
      yMin: yMin,
      yMax: yMax,
      x: x,
      y: y,
    };
  }

  // ---------------------------------------------------------------- hash

  /** Parse "#runner=<id>&event=<id>" into {runner, event} (null when absent). */
  function parseHash(hash) {
    var out = { runner: null, event: null };
    var h = String(hash || '').replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (part) {
      var eq = part.indexOf('=');
      if (eq < 0) return;
      var k = part.slice(0, eq), v;
      try { v = decodeURIComponent(part.slice(eq + 1)); } catch (e) { return; }
      if (!v) return;
      if (k === 'runner') out.runner = v;
      else if (k === 'event') out.event = v;
    });
    return out;
  }

  /** Inverse of parseHash; '' when both are empty. */
  function buildHash(state) {
    var s = state || {};
    var parts = [];
    if (s.runner) parts.push('runner=' + encodeURIComponent(s.runner));
    if (s.event) parts.push('event=' + encodeURIComponent(s.event));
    return parts.length ? '#' + parts.join('&') : '';
  }

  // ---------------------------------------------------------------- header

  /** "1 open finding" / "no open findings" / null when the count is unusable. */
  function openCountText(findings) {
    var n = findings && num(findings.open_count);
    if (n === null || n < 0) return null;
    n = Math.floor(n);
    if (n === 0) return 'no open findings';
    return n + ' open finding' + (n === 1 ? '' : 's');
  }

  /** "1 confirmed, 22 not enough data, ..." in page order, from state_counts. */
  function stateCountsText(counts) {
    if (!counts || typeof counts !== 'object') return '';
    return STATE_ORDER.filter(function (s) { return num(counts[s]) > 0; })
      .map(function (s) { return counts[s] + ' ' + stateInfo(s).word; }).join(', ');
  }

  // ---------------------------------------------------------------- consistency

  var STREAK_REASONS = {
    'out-of-band day': 'ended by an out-of-band day',
    'start of history': 'since the start of the history',
    'confirmed step': 'since a confirmed step',
  };

  /**
   * Streak signal for one runner. A zero streak whose reason is a lack of
   * data reads "not enough data", never "0 days".
   *
   * @returns {{text:string, cls:string}}
   */
  function streakText(r) {
    var d = r && num(r.streak_days);
    var reason = r && typeof r.streak_end_reason === 'string' ? r.streak_end_reason : '';
    if (d === null || (d === 0 && /not enough data/.test(reason))) {
      return { text: 'Within-band streak: not enough data' + (reason && !/^not enough data$/.test(reason) ? ' (' + reason.replace(/^not enough data\s*/, '') + ')' : ''), cls: 'insufficient' };
    }
    var why = STREAK_REASONS[reason] || reason;
    return {
      text: 'Within band for ' + d + ' day' + (d === 1 ? '' : 's') + (why ? ' (' + why + ')' : ''),
      cls: d > 0 ? 'cleared' : 'neutral',
    };
  }

  /** "Spread 0.28% in the last 28 days (first 28 days: 0.55%)". */
  function sdText(r) {
    var rec = r && num(r.sd_recent_pct), first = r && num(r.sd_first_pct);
    if (rec === null && first === null) return 'Spread: not enough data';
    return 'Spread ' + (rec === null ? 'n/a' : rec.toFixed(2) + '%') + ' in the last 28 days (first 28 days: ' +
      (first === null ? 'n/a' : first.toFixed(2) + '%') + ')';
  }

  /** Events of the last 90 days: cleared and not enough data, as words. */
  function eventsText(r) {
    var t = r && num(r.events_tested_90d);
    if (t === null) return 'Events in the last 90 days: n/a';
    var c = num(r.events_cleared_90d), i = num(r.events_insufficient_90d);
    return t + ' event' + (t === 1 ? '' : 's') + ' tested in the last 90 days: ' +
      (c === null ? 'n/a' : c) + ' no evidence of change, ' +
      (i === null ? 'n/a' : i) + ' not enough data';
  }

  /** Missing canary days: count in 90 days plus the dates of the last 30. */
  function missingText(r) {
    var n = r && num(r.missing_days_90d);
    var list = r && Array.isArray(r.missing_days_30d) ? r.missing_days_30d.filter(function (d) { return typeof d === 'string'; }) : [];
    if (n === null && !list.length) return 'Missing days: n/a';
    if (n === 0 && !list.length) return 'No missing days in the last 90 days';
    var s = (n === null ? list.length : n) + ' missing day' + ((n === null ? list.length : n) === 1 ? '' : 's') + ' in the last 90 days';
    if (list.length) s += ' (last 30 days: ' + list.join(', ') + ')';
    return s;
  }

  /** Last confirmation run, or "none yet". */
  function confirmationText(r) {
    var c = r && r.last_confirmation_run;
    if (!c || typeof c !== 'object') return 'Last confirmation run: none yet';
    var bits = [];
    if (c.date) bits.push(String(c.date));
    if (c.verdict) bits.push(String(c.verdict));
    if (num(c.pairs) !== null) bits.push(c.pairs + ' pairs');
    return 'Last confirmation run: ' + (bits.length ? bits.join(', ') : 'recorded');
  }

  /** Fleet line of consistency.json. */
  function fleetText(f) {
    if (!f || typeof f !== 'object') return { text: 'Fleet: no fleet deploy in the data', cls: 'neutral' };
    var st = stateInfo(f.state);
    var bits = ['Latest fleet harness deploy ' + (f.latest_deploy_date || 'n/a')];
    if (f.same_direction) bits.push(f.same_direction + ' runners moved the same way');
    if (num(f.z) !== null) bits.push('pooled Z ' + formatZ(f.z));
    return { text: bits.join(', ') + ': ' + st.word, cls: st.cls };
  }

  exports.FINDINGS_MAX_AGE_MS = FINDINGS_MAX_AGE_MS;
  exports.STATE_ORDER = STATE_ORDER;
  exports.stateInfo = stateInfo;
  exports.stateRank = stateRank;
  exports.isOpen = isOpen;
  exports.isFleet = isFleet;
  exports.sortEvents = sortEvents;
  exports.filterEvents = filterEvents;
  exports.inDefaultView = inDefaultView;
  exports.isRecent = isRecent;
  exports.RECENT_DAYS = RECENT_DAYS;
  exports.fieldsSummary = fieldsSummary;
  exports.runnerOptions = runnerOptions;
  exports.runnerNames = runnerNames;
  exports.isStale = isStale;
  exports.formatUtc = formatUtc;
  exports.formatPct = formatPct;
  exports.formatCi = formatCi;
  exports.formatConfidence = formatConfidence;
  exports.formatQ = formatQ;
  exports.formatShare = formatShare;
  exports.formatScore = formatScore;
  exports.formatZ = formatZ;
  exports.canaryTest = canaryTest;
  exports.evidenceText = evidenceText;
  exports.fieldText = fieldText;
  exports.testRows = testRows;
  exports.strictText = strictText;
  exports.ciScale = ciScale;
  exports.ciBar = ciBar;
  exports.median = median;
  exports.plotGeometry = plotGeometry;
  exports.parseHash = parseHash;
  exports.buildHash = buildHash;
  exports.openCountText = openCountText;
  exports.stateCountsText = stateCountsText;
  exports.streakText = streakText;
  exports.sdText = sdText;
  exports.eventsText = eventsText;
  exports.missingText = missingText;
  exports.confirmationText = confirmationText;
  exports.fleetText = fleetText;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.CanaryHelpers = {}));
