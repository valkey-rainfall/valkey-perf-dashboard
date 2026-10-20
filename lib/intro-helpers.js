/**
 * Pure helpers for the sign-on intro overlay on the Performance History page.
 *
 * index.html shows intro.html (the Conductress sign-on from the brand kit) in a
 * full-screen iframe while the first render runs, then releases it at
 * max(charts ready, intro done) with a CRT power-off transition (hard cut under
 * prefers-reduced-motion). Preferences (enabled, sound mode, score, CRT
 * overlay) live in localStorage under one key; this file owns their defaults,
 * validation and (de)serialisation, the iframe URL, the sound decision, the
 * release rule and the audio-tail lengths, so all of that is unit-testable
 * without a browser.
 *
 * Browser: loaded via <script src="lib/intro-helpers.js">.
 * Node tests: required via require().
 */

(function (exports) {
  'use strict';

  const STORAGE_KEY = 'conductress.intro';

  /** Scores intro.html can synthesise. The silent run is score + sound decision, not a score. */
  const SCORES = ['cosmos', 'vhs', 'chip', 'orch'];

  /**
   * Sound modes.
   *   auto: play with sound only when the browser already allows audio without a
   *         gesture (Chrome's media-engagement allowance, Firefox/Safari per-site
   *         autoplay permission). Otherwise the visuals run silent and nothing
   *         nags. This is what everyone else gets.
   *   on:   always try; when refused, offer a SOUND button that restarts the
   *         sequence with the score (a refused AudioContext has no advancing
   *         clock, so a mid-timeline join is not schedulable).
   *   off:  never build an AudioContext.
   */
  const SOUND_MODES = ['auto', 'on', 'off'];

  const DEFAULT_PREFS = Object.freeze({
    enabled: true,
    sound: 'auto',
    score: 'cosmos',   // production default from the brand kit (Rain, Sep 10 2026)
    crt: false,        // scanlines + vignette + end flicker; off by default like the brand kit
  });

  /**
   * Chrome only counts a visit toward the site's Media Engagement Index when
   * audio plays for more than 7 s, so every score keeps its tail audible past
   * that mark and the parent keeps the (invisible) frame alive until here.
   * Seconds from the score's t0.
   */
  const AUDIO_TAIL_S = Object.freeze({ cosmos: 9.6, vhs: 8.8, chip: 8.2, orch: 8.4 });

  /** Hard cap on how long the released frame may linger for its audio tail. */
  const AUDIO_TAIL_CAP_MS = 11000;

  /** Legacy boolean sound pref (PR #24 first cut) -> mode. */
  function soundMode(v) {
    if (SOUND_MODES.includes(v)) return v;
    if (v === true) return 'on';
    if (v === false) return 'off';
    return DEFAULT_PREFS.sound;
  }

  /** Coerce anything into a valid prefs object; unknown values fall back to defaults. */
  function sanitizePrefs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_PREFS.enabled,
      sound: soundMode(src.sound),
      score: SCORES.includes(src.score) ? src.score : DEFAULT_PREFS.score,
      crt: typeof src.crt === 'boolean' ? src.crt : DEFAULT_PREFS.crt,
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
   * A 6 s title sequence is exactly what that setting asks us not to play.
   */
  function shouldPlay(prefs, reducedMotion) {
    return !!(prefs && prefs.enabled) && !reducedMotion;
  }

  /** The iframe URL for a given prefs object. */
  function introSrc(prefs, base) {
    const p = sanitizePrefs(prefs);
    const params = new URLSearchParams();
    params.set('embed', '1');
    params.set('score', p.score);
    params.set('sound', p.sound);
    if (p.crt) params.set('crt', '1');
    return (base || 'intro.html') + '?' + params.toString();
  }

  /** Parse the intro's own query string (intro.html side). */
  function parseEmbedQuery(search) {
    const q = new URLSearchParams(search || '');
    const score = q.get('score');
    const sound = q.get('sound');
    return {
      embed: q.get('embed') === '1',
      score: SCORES.includes(score) ? score : DEFAULT_PREFS.score,
      sound: SOUND_MODES.includes(sound) ? sound : 'off',   // an embed URL with no decision stays silent
      crt: q.get('crt') === '1',
    };
  }

  /**
   * The sound decision once the browser has answered whether audio may start
   * without a gesture (navigator.getAutoplayPolicy where it exists, else an
   * AudioContext resume probe).
   *   start: schedule the score with the visuals right now
   *   offer: show the SOUND button (restart-with-score on click)
   */
  function soundDecision(mode, autoplayAllowed) {
    const m = soundMode(mode);
    if (m === 'off') return { start: false, offer: false };
    if (autoplayAllowed) return { start: true, offer: false };
    return { start: false, offer: m === 'on' };
  }

  /** Whether the embed needs to build/probe an AudioContext at all. */
  function wantsAudio(mode) { return soundMode(mode) !== 'off'; }

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

  /**
   * How the overlay leaves and what happens to the score.
   *   transition: 'crt' (picture collapses to a line, then a dot, then the black
   *               lifts) or 'cut' (reduced motion: hard cut, no animation)
   *   keepAudio:  a score that is playing finishes under the dashboard instead
   *               of being cut with the picture, unless the user skipped
   *   tailMs:     how long the released frame may linger (0 when not keeping audio)
   */
  function releasePlan(state, reducedMotion, score) {
    const skipped = !!(state && state.skipped);
    const audioOn = !!(state && state.audioOn);
    const keepAudio = audioOn && !skipped;
    const started = state && typeof state.audioStartedAt === 'number' ? state.audioStartedAt : null;
    let tailMs = 0;
    if (keepAudio) {
      const tail = (AUDIO_TAIL_S[score] || AUDIO_TAIL_S[DEFAULT_PREFS.score]) * 1000;
      tailMs = Math.min(AUDIO_TAIL_CAP_MS, Math.max(0, tail - (started === null ? 0 : (state.now - started))));
    }
    return { transition: reducedMotion ? 'cut' : 'crt', keepAudio, tailMs };
  }

  exports.STORAGE_KEY = STORAGE_KEY;
  exports.SCORES = SCORES;
  exports.SOUND_MODES = SOUND_MODES;
  exports.DEFAULT_PREFS = DEFAULT_PREFS;
  exports.AUDIO_TAIL_S = AUDIO_TAIL_S;
  exports.AUDIO_TAIL_CAP_MS = AUDIO_TAIL_CAP_MS;
  exports.soundMode = soundMode;
  exports.sanitizePrefs = sanitizePrefs;
  exports.readPrefs = readPrefs;
  exports.writePrefs = writePrefs;
  exports.shouldPlay = shouldPlay;
  exports.introSrc = introSrc;
  exports.parseEmbedQuery = parseEmbedQuery;
  exports.soundDecision = soundDecision;
  exports.wantsAudio = wantsAudio;
  exports.shouldRelease = shouldRelease;
  exports.releasePlan = releasePlan;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.IntroHelpers = {}));
