/**
 * Pure helpers for the engine-comparison page's freshness strip: which
 * commit each engine's "latest release" and "current HEAD" numbers come
 * from, how old that commit is, and whether every sweep in the roster
 * agrees on it.
 *
 * Inputs are Conductress series files. Two shapes matter:
 *
 *   - Throughput series (all engines, since #235) tag every point with
 *     `sample`: "release" (a release landmark), "tip" (branch head at
 *     measurement time) or "history" (bisection backfill).
 *   - Memory and latency series mostly carry no `sample`. Every series
 *     carries `landmarks` ({label, commit_index}); a label starting with
 *     a digit is a release tag.
 *
 * `date` on a point is the COMMIT date (day resolution), not the time the
 * measurement ran. For a tip that is a fair proxy for measurement
 * recency (the tip is the branch head when the cell runs); for a release
 * it is how old the release itself is, which is context, not staleness.
 *
 * Absent data resolves to "none"/null, never to a fabricated value.
 *
 * Browser: loaded via <script src="lib/freshness-helpers.js">.
 * Node tests: required via require().
 */

(function (exports) {
  'use strict';

  const DAY_MS = 86400000;

  function points(series) {
    if (!series || !Array.isArray(series.points)) return [];
    return series.points.filter(p => p && typeof p === 'object');
  }

  // Newest-first ordering: commit_index, then date, then original position.
  function newestFirst(list) {
    return list
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const ai = Number.isFinite(a.p.commit_index) ? a.p.commit_index : -Infinity;
        const bi = Number.isFinite(b.p.commit_index) ? b.p.commit_index : -Infinity;
        if (ai !== bi) return bi - ai;
        const ad = typeof a.p.date === 'string' ? a.p.date : '';
        const bd = typeof b.p.date === 'string' ? b.p.date : '';
        if (ad !== bd) return ad < bd ? 1 : -1;
        return b.i - a.i;
      })
      .map(x => x.p);
  }

  /** True when at least one point carries a string `sample` tag. */
  function isSampleTagged(series) {
    return points(series).some(p => typeof p.sample === 'string');
  }

  /** Newest point whose `sample` equals `kind`, or null. */
  function latestPointOfKind(series, kind) {
    const list = newestFirst(points(series).filter(p => p.sample === kind));
    return list.length ? list[0] : null;
  }

  /** Newest point regardless of tag, or null. */
  function newestPoint(series) {
    const list = newestFirst(points(series));
    return list.length ? list[0] : null;
  }

  function isReleaseLabel(label) {
    return typeof label === 'string' && /^\d/.test(label);
  }

  /** Newest release landmark ({label, commit_index}) or null. */
  function latestReleaseLandmark(series) {
    if (!series || !Array.isArray(series.landmarks)) return null;
    const rel = series.landmarks
      .filter(l => l && isReleaseLabel(l.label) && Number.isFinite(l.commit_index))
      .sort((a, b) => b.commit_index - a.commit_index);
    return rel.length ? rel[0] : null;
  }

  function landmarkLabelFor(series, point) {
    if (!series || !Array.isArray(series.landmarks) || !point) return null;
    const hit = series.landmarks.find(l => l && isReleaseLabel(l.label)
      && ((typeof l.commit === 'string' && l.commit === point.commit)
        || (Number.isFinite(l.commit_index) && l.commit_index === point.commit_index)));
    return hit ? hit.label : null;
  }

  /**
   * The point that stands for "latest release" in this series, with its
   * release label when one is known:
   *   1. newest point tagged sample="release";
   *   2. else the point sitting exactly on the newest release landmark
   *      (untagged memory/latency series);
   *   3. else null.
   * Returns {point, label} or null.
   */
  function releasePoint(series) {
    const tagged = latestPointOfKind(series, 'release');
    if (tagged) return { point: tagged, label: landmarkLabelFor(series, tagged) };
    const lm = latestReleaseLandmark(series);
    if (!lm) return null;
    const exact = points(series).find(p => p.commit_index === lm.commit_index);
    return exact ? { point: exact, label: lm.label } : null;
  }

  /**
   * The point that stands for "current HEAD" in this series:
   *   - tagged series: newest sample="tip" point (null when there is none,
   *     e.g. a release-only series);
   *   - untagged series: the newest point.
   * Returns {point, label:null} or null.
   */
  function headPoint(series) {
    if (isSampleTagged(series)) {
      const tip = latestPointOfKind(series, 'tip');
      return tip ? { point: tip, label: null } : null;
    }
    const p = newestPoint(series);
    return p ? { point: p, label: null } : null;
  }

  /** Whole days between a YYYY-MM-DD commit date and `now` (ms), >= 0, or null. */
  function commitAgeDays(dateStr, now) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
    const t = Date.parse(dateStr.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(t)) return null;
    const ref = Number.isFinite(now) ? now : Date.now();
    return Math.max(0, Math.floor((ref - t) / DAY_MS));
  }

  function formatAge(days) {
    if (days === null || days === undefined) return '';
    if (days === 0) return 'today';
    return days + ' d';
  }

  function shortSha(commit) {
    return typeof commit === 'string' ? commit.slice(0, 8) : '';
  }

  /**
   * Completeness of one column (release or head) across a roster of sweeps.
   *
   * entries: [{id, series}]  pick: series -> {point,label}|null
   *
   * state:
   *   'complete' every sweep has a point and all share one commit
   *   'partial'  every sweep has a point, more than one distinct commit
   *   'missing'  at least one sweep has a point, at least one has none
   *   'none'     no sweep has a point (or the roster is empty)
   *
   * `newest` is the newest picked point across the roster (its commit, date,
   * label, commit_index, ageDays); `spanDays` is newest minus oldest commit
   * date among the picked points; `items` is the per-sweep breakdown.
   */
  function rosterFreshness(entries, pick, now) {
    const list = Array.isArray(entries) ? entries : [];
    const items = list.map(e => {
      const r = pick(e && e.series);
      if (!r || !r.point) return { id: e ? e.id : '', present: false, commit: null, date: null, label: null, commit_index: null };
      return {
        id: e.id, present: true,
        commit: typeof r.point.commit === 'string' ? r.point.commit : null,
        date: typeof r.point.date === 'string' ? r.point.date.slice(0, 10) : null,
        label: r.label || null,
        commit_index: Number.isFinite(r.point.commit_index) ? r.point.commit_index : null,
      };
    });
    const present = items.filter(i => i.present);
    const commits = [];
    for (const i of newestFirst(present)) {
      const key = i.commit || ('#' + i.commit_index);
      if (!commits.includes(key)) commits.push(key);
    }
    let state;
    if (list.length === 0 || present.length === 0) state = 'none';
    else if (present.length < list.length) state = 'missing';
    else if (commits.length > 1) state = 'partial';
    else state = 'complete';

    let newest = null, spanDays = null;
    if (present.length) {
      const n = newestFirst(present)[0];
      newest = { commit: n.commit, date: n.date, label: n.label, commit_index: n.commit_index, ageDays: commitAgeDays(n.date, now) };
      const dates = present.map(i => i.date).filter(Boolean).sort();
      if (dates.length) {
        const a = commitAgeDays(dates[0], now), b = commitAgeDays(dates[dates.length - 1], now);
        spanDays = (a === null || b === null) ? null : Math.max(0, a - b);
      }
    }
    return { state, total: list.length, measured: present.length, commits, newest, spanDays, items };
  }

  /** Both columns for one engine's roster. */
  function engineFreshness(entries, now) {
    return {
      release: rosterFreshness(entries, releasePoint, now),
      head: rosterFreshness(entries, headPoint, now),
    };
  }

  const STATE_COLOR = { complete: 'var(--ok)', partial: 'var(--warn)', missing: 'var(--danger)', none: 'var(--muted)' };
  const STATE_TEXT = {
    complete: 'all sweeps on the same commit',
    partial: 'sweeps span more than one commit',
    missing: 'some sweeps have no point',
    none: 'no data',
  };

  function stateColor(state) { return STATE_COLOR[state] || STATE_COLOR.none; }
  function stateText(state) { return STATE_TEXT[state] || STATE_TEXT.none; }

  /**
   * Engine scope from its series: the first non-empty metadata.scope.
   * "history" (landmarks + bisection + backfill) or "release-and-tip"
   * (latest release + tip at most once per interval). null when unknown.
   */
  function engineScope(seriesList) {
    for (const s of (Array.isArray(seriesList) ? seriesList : [])) {
      const scope = s && s.metadata && s.metadata.scope;
      if (typeof scope === 'string' && scope) return scope;
    }
    return null;
  }

  /** How the "Current HEAD" value is derived for a scope. */
  function headBasis(scope) {
    return scope === 'release-and-tip' ? 'newest tip point' : 'median of last 5 points';
  }

  /**
   * One-line summary for a column: "9.2 · 122ec7e1 · Sep 16 · 6 d · 12/12".
   * Pure string assembly; the page wraps it in markup.
   */
  function columnSummary(col) {
    if (!col || !col.newest) return { label: null, sha: '', date: '', age: '', count: col ? `0/${col.total}` : '0/0' };
    return {
      label: col.newest.label,
      sha: shortSha(col.newest.commit),
      date: col.newest.date || '',
      age: formatAge(col.newest.ageDays),
      count: `${col.measured}/${col.total}`,
    };
  }

  exports.isSampleTagged = isSampleTagged;
  exports.latestPointOfKind = latestPointOfKind;
  exports.latestReleaseLandmark = latestReleaseLandmark;
  exports.releasePoint = releasePoint;
  exports.headPoint = headPoint;
  exports.commitAgeDays = commitAgeDays;
  exports.formatAge = formatAge;
  exports.shortSha = shortSha;
  exports.rosterFreshness = rosterFreshness;
  exports.engineFreshness = engineFreshness;
  exports.stateColor = stateColor;
  exports.stateText = stateText;
  exports.engineScope = engineScope;
  exports.headBasis = headBasis;
  exports.columnSummary = columnSummary;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.FreshnessHelpers = {}));
