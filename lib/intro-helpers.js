/**
 * Pure helpers for the sign-on intro overlay on the Performance History page.
 *
 * index.html shows intro.html in a full-screen iframe while the first render
 * runs, then fades it out at max(charts ready, intro done). Preferences
 * (enabled, sound, score, tape) live in localStorage under one key; this file
 * owns their defaults, validation and (de)serialisation, the iframe URL, and
 * the release rule, so all of that is unit-testable without a browser.
 *
 * Browser: loaded via <script src="lib/intro-helpers.js">.
 * Node tests: required via require().
 */

(function (exports) {
  'use strict';

  const STORAGE_KEY = 'conductress.intro';

  /** Scores intro.html can synthesise. 'mute' is what sound=false maps to. */
  const SCORES = ['fm', 'sid', 'turbine', 'launch'];

  /**
   * Sound is OFF by default: anyone hitting the URL gets the visuals only.
   * Browsers refuse audio without a gesture anyway, so a stored sound=true
   * only lets the intro *offer* sound on load and start it on the first click.
   */
  const DEFAULT_PREFS = Object.freeze({
    enabled: true,
    sound: false,
    score: 'launch',
    tape: false,
  });

  /** Coerce anything into a valid prefs object; unknown values fall back to defaults. */
  function sanitizePrefs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_PREFS.enabled,
      sound: typeof src.sound === 'boolean' ? src.sound : DEFAULT_PREFS.sound,
      score: SCORES.includes(src.score) ? src.score : DEFAULT_PREFS.score,
      tape: typeof src.tape === 'boolean' ? src.tape : DEFAULT_PREFS.tape,
    };
  }

  /**
   * Read prefs from a Storage-like object (getItem). Missing, unparseable or
   * throwing storage (Safari private mode) all resolve to defaults.
   */
  function readPrefs(storage) {
    let text = null;
    try { text = storage ? storage.getItem(STORAGE_KEY) : null; } catch (e) { text = null; }
    if (!text) return sanitizePrefs(null);
    try { return sanitizePrefs(JSON.parse(text)); } catch (e) { return sanitizePrefs(null); }
  }

  /** Persist prefs; returns the sanitized object actually written. Never throws. */
  function writePrefs(storage, prefs) {
    const clean = sanitizePrefs(prefs);
    try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(clean)); } catch (e) { /* storage full / denied */ }
    return clean;
  }

  /**
   * Whether to show the intro on this load.
   * reducedMotion: the `(prefers-reduced-motion: reduce)` media query result.
   */
  function shouldPlay(prefs, reducedMotion) {
    return !!(prefs && prefs.enabled) && !reducedMotion;
  }

  /** The iframe URL for a given prefs object. Sound off => the silent score. */
  function introSrc(prefs, base) {
    const p = sanitizePrefs(prefs);
    const params = new URLSearchParams();
    params.set('embed', '1');
    params.set('score', p.sound ? p.score : 'mute');
    if (p.sound && p.tape) params.set('tape', '1');
    return (base || 'intro.html') + '?' + params.toString();
  }

  /**
   * The release rule. The overlay comes down when BOTH the charts are ready
   * and the intro has reached its done mark, or immediately on skip. Once
   * released it stays released.
   *   state: {chartsReady, introDone, skipped, released}
   */
  function shouldRelease(state) {
    if (!state || state.released) return false;
    if (state.skipped) return true;
    return !!(state.chartsReady && state.introDone);
  }

  /** Parse the intro's own query string (intro.html side). */
  function parseEmbedQuery(search) {
    const q = new URLSearchParams(search || '');
    const score = q.get('score');
    return {
      embed: q.get('embed') === '1',
      score: score === 'mute' || SCORES.includes(score) ? score : null,
      tape: q.get('tape') === '1',
    };
  }

  exports.STORAGE_KEY = STORAGE_KEY;
  exports.SCORES = SCORES;
  exports.DEFAULT_PREFS = DEFAULT_PREFS;
  exports.sanitizePrefs = sanitizePrefs;
  exports.readPrefs = readPrefs;
  exports.writePrefs = writePrefs;
  exports.shouldPlay = shouldPlay;
  exports.introSrc = introSrc;
  exports.shouldRelease = shouldRelease;
  exports.parseEmbedQuery = parseEmbedQuery;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.IntroHelpers = {}));
