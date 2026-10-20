/**
 * Pure helpers for the sign-on intro overlay on the Performance History page.
 *
 * index.html shows intro.html (the Conductress sign-on from the brand kit) in a
 * full-screen iframe while the first render runs, then releases it at
 * max(charts ready, intro done) with a CRT power-off transition (hard cut under
 * prefers-reduced-motion). Preferences (enabled, sound mode) live in
 * localStorage under one key; this file owns their defaults, validation and
 * (de)serialisation, the iframe URL, the sound decision, the release rule and
 * the audio-tail length, so all of that is unit-testable without a browser.
 *
 * The score is always Cosmos and the CRT overlay is gone (Rain, Oct 19 2026):
 * the dashboard copy of the sign-on carries exactly one cut. Older stored
 * prefs may still hold `score` / `crt` keys; sanitizePrefs drops them.
 *
 * Browser: loaded via <script src="lib/intro-helpers.js">.
 * Node tests: required via require().
 */

(function (exports) {
  'use strict';

  const STORAGE_KEY = 'conductress.intro';

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
  });

  /**
   * Chrome only counts a visit toward the site's Media Engagement Index when
   * audio plays for more than 7 s, so the score keeps its tail audible past
   * that mark and the parent keeps the (invisible) frame alive until here.
   * Seconds from the score's t0: Cosmos' last bell trail decays to silence.
   */
  const AUDIO_TAIL_S = 9.6;

  /** Hard cap on how long the released frame may linger for its audio tail. */
  const AUDIO_TAIL_CAP_MS = 11000;

  /** Legacy boolean sound pref (PR #24 first cut) -> mode. */
  function soundMode(v) {
    if (SOUND_MODES.includes(v)) return v;
    if (v === true) return 'on';
    if (v === false) return 'off';
    return DEFAULT_PREFS.sound;
  }

  /** Coerce anything into a valid prefs object; unknown values and retired keys fall away. */
  function sanitizePrefs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_PREFS.enabled,
      sound: soundMode(src.sound),
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
    params.set('sound', p.sound);
    return (base || 'intro.html') + '?' + params.toString();
  }

  /** Parse the intro's own query string (intro.html side). */
  function parseEmbedQuery(search) {
    const q = new URLSearchParams(search || '');
    const sound = q.get('sound');
    return {
      embed: q.get('embed') === '1',
      sound: SOUND_MODES.includes(sound) ? sound : 'off',   // an embed URL with no decision stays silent
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
   * One line for the settings popover describing what the browser decided on
   * the last load, so "I turned sound on and hear nothing" has an answer on
   * screen. `verdict` is the intro's `autoplay` event: {allowed, mode}.
   */
  function autoplayStatus(verdict) {
    if (!verdict) return '';
    if (verdict.mode === 'off') return 'This load: sound off.';
    if (verdict.allowed) return 'This load: the browser allowed sound without a click.';
    return verdict.mode === 'on'
      ? 'This load: the browser refused to start sound without a click, so the SOUND button was shown.'
      : 'This load: the browser refused to start sound without a click, so the intro ran silent.';
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

  /**
   * How the overlay leaves and what happens to the score.
   *   transition: 'crt' (picture collapses to a line, then a dot, then the black
   *               lifts) or 'cut' (reduced motion: hard cut, no animation)
   *   keepAudio:  a score that is playing finishes under the dashboard instead
   *               of being cut with the picture, unless the user skipped
   *   tailMs:     how long the released frame may linger (0 when not keeping audio)
   */
  function releasePlan(state, reducedMotion) {
    const skipped = !!(state && state.skipped);
    const audioOn = !!(state && state.audioOn);
    const keepAudio = audioOn && !skipped;
    const started = state && typeof state.audioStartedAt === 'number' ? state.audioStartedAt : null;
    let tailMs = 0;
    if (keepAudio) {
      const tail = AUDIO_TAIL_S * 1000;
      tailMs = Math.min(AUDIO_TAIL_CAP_MS, Math.max(0, tail - (started === null ? 0 : (state.now - started))));
    }
    return { transition: reducedMotion ? 'cut' : 'crt', keepAudio, tailMs };
  }

  exports.STORAGE_KEY = STORAGE_KEY;
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
  exports.autoplayStatus = autoplayStatus;
  exports.shouldRelease = shouldRelease;
  exports.releasePlan = releasePlan;

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.IntroHelpers = {}));
