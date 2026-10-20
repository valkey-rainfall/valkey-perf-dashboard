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
   * Seconds from the score's t0. The bells themselves are gone by ~9.3 s, but
   * the 5.5 s convolver keeps ringing well past that, so the tail is taken out
   * by an output-bus fade (below) rather than by closing the context on it.
   */
  const AUDIO_TAIL_S = 10.4;

  /** Length of the output-bus fade that ends the tail (seconds, exponential to -60 dB). */
  const AUDIO_FADE_S = 3.0;

  /** The fade reaches zero this long before the context is closed, so neither the
   *  embed's close nor the parent's teardown can land on audible signal. */
  const AUDIO_SILENT_LEAD_S = 0.15;

  /** Hard cap on how long the released frame may linger for its audio tail. */
  const AUDIO_TAIL_CAP_MS = 11000;

  /**
   * Where the output bus gain goes on the score's timeline (absolute context seconds):
   *   fadeStart: still at unity until here
   *   silentAt:  zero from here (the ramp runs fadeStart -> silentAt)
   *   closeAt:   the context may be closed; 'audio-ended' fires
   */
  function audioFadePlan(t0) {
    const closeAt = t0 + AUDIO_TAIL_S;
    const silentAt = closeAt - AUDIO_SILENT_LEAD_S;
    return { fadeStart: silentAt - AUDIO_FADE_S, silentAt, closeAt };
  }

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

  /* ---------------------------------------------------------------- night sky */

  /**
   * The sign-on backdrop's star field, generated rather than stored: a few
   * thousand points as a handful of <path> elements (one per brightness step,
   * tint and opacity; a near-zero-length round-capped stroke is a dot), so the
   * file stays small and the sky is re-tuned with two numbers.
   *
   * Scene, in user units of the 900x340 core. The sun is the hard-edged circle
   * glow; windows between 9:16 and 32:9 look at about x -500..1400, y -720..196,
   * the rest of the scenery box only shows on stranger shapes.
   *
   * Placement follows what a dark-sky observer sees: nothing over the sun's
   * disc, stars washed out in the sunset glow (the sky gradient's ellipse, so
   * the wash reaches further sideways than up) and growing both denser and
   * brighter with distance from it, thinner just above the horizon (air mass),
   * densest high in the sky. Brightness follows a magnitude ladder: each step
   * brighter is roughly 2.5x rarer, so most stars are faint and a few brilliant.
   */
  const SKY = Object.freeze({
    sun: Object.freeze({x: 450, y: 110, r: 150}),
    horizon: 196,
    box: Object.freeze({x0: -2700, x1: 3600, y0: -1400}),
    view: Object.freeze({x0: -500, x1: 1400, y0: -720}),
    glow: Object.freeze({x: 450, y: 129, rx: 648, ry: 245}),  // the sky gradient's ellipse (#sky)
    wash: Object.freeze({from: 0.2, to: 0.75}),               // stars washed out inside this band of the glow
    hazeH: 260,            // the horizon's air mass thins them within this height
  });

  /** Brightness ladder, faintest first: weight = share of stars, r = radius, a = opacity. */
  const STAR_STEPS = Object.freeze([
    Object.freeze({weight: 0.56, r: 0.30, a: 0.22}),
    Object.freeze({weight: 0.25, r: 0.40, a: 0.38}),
    Object.freeze({weight: 0.11, r: 0.52, a: 0.55}),
    Object.freeze({weight: 0.05, r: 0.68, a: 0.72}),
    Object.freeze({weight: 0.022, r: 0.90, a: 0.88}),
    Object.freeze({weight: 0.008, r: 1.25, a: 1.0}),
  ]);

  /** Tints: most stars read cream, some blue-white, a few warm. */
  const STAR_TINTS = Object.freeze([
    Object.freeze({weight: 0.78, fill: '#fff6ea'}),
    Object.freeze({weight: 0.14, fill: '#dfe9ff'}),
    Object.freeze({weight: 0.08, fill: '#ffd9a8'}),
  ]);

  const STAR_DEFAULTS = Object.freeze({count: 25000, size: 1, seed: 20261019, outer: 0.3});

  /** Small deterministic PRNG (mulberry32) so the same seed draws the same sky everywhere. */
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  /** 0..1: how readily a star shows at (x, y). 0 on or below the horizon and over the sun. */
  function starVisibility(x, y, sky) {
    sky = sky || SKY;
    if (y >= sky.horizon) return 0;
    const disc = smoothstep(sky.sun.r, sky.sun.r + 30, Math.hypot(x - sky.sun.x, y - sky.sun.y));
    const rho = Math.hypot((x - sky.glow.x) / sky.glow.rx, (y - sky.glow.y) / sky.glow.ry);
    const wash = smoothstep(sky.wash.from, sky.wash.to, rho);
    const haze = 0.15 + 0.85 * smoothstep(0, sky.hazeH, sky.horizon - y);
    return disc * wash * haze;
  }

  function pickWeighted(list, u) {
    let acc = 0;
    for (const item of list) { acc += item.weight; if (u < acc) return item; }
    return list[list.length - 1];
  }

  /**
   * opts: {count: stars placed in the view region (default 25000; about 60 ms of one-off
   *               generation and ~540 KB of path data, drawn once and composited),
   *        size:  radius scale (1),
   *        seed:  PRNG seed,
   *        outer: extra stars, as a fraction of count, spread over the rest of the
   *               scenery box for very wide or very tall windows (0.3),
   *        wash:  {from, to} override of SKY.wash, the band of the sunset glow
   *               (0 = its centre, 1 = its rim) across which stars come through}
   * Returns {stars: [{x, y, r, a, fill}], groups: [{fill, r, a, d}]}: groups carry
   * one SVG path of dots ("M x y h.01") per (step, tint, opacity) so the whole sky
   * is a few dozen elements however many stars it holds.
   */
  function starField(opts) {
    const o = Object.assign({}, STAR_DEFAULTS, opts || {});
    const count = Math.max(0, Math.floor(Number.isFinite(o.count) ? o.count : STAR_DEFAULTS.count));
    const size = Number.isFinite(o.size) && o.size > 0 ? o.size : 1;
    const rnd = mulberry32(Number.isFinite(o.seed) ? o.seed : STAR_DEFAULTS.seed);
    const sky = o.wash ? Object.assign({}, SKY, {wash: Object.assign({}, SKY.wash, o.wash)}) : SKY;
    const v = sky.view, b = sky.box;
    const stars = [];

    // Rejection sampling: a candidate survives with probability = visibility, so
    // density follows the sky; its brightness is dimmed by the same factor.
    function place(x, y, scale) {
      const vis = starVisibility(x, y, sky) * scale;
      if (vis <= 0 || rnd() >= vis) return false;
      const step = pickWeighted(STAR_STEPS, rnd());
      const tint = pickWeighted(STAR_TINTS, rnd());
      const a = Math.round(10 * step.a * (0.55 + 0.45 * vis)) / 10;
      stars.push({x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(step.r * size * 100) / 100, a: Math.max(0.1, a), fill: tint.fill});
      return true;
    }

    let guard = count * 40 + 1000;
    for (let n = 0; n < count && guard-- > 0;) {
      if (place(v.x0 + rnd() * (v.x1 - v.x0), v.y0 + rnd() * (sky.horizon - v.y0), 1)) n++;
    }
    // Far scenery: thin, only ever seen on extreme aspect ratios.
    const outer = Math.floor(count * (Number.isFinite(o.outer) ? o.outer : STAR_DEFAULTS.outer));
    guard = outer * 40 + 1000;
    for (let n = 0; n < outer && guard-- > 0;) {
      const x = b.x0 + rnd() * (b.x1 - b.x0), y = b.y0 + rnd() * (sky.horizon - b.y0);
      if (x >= v.x0 && x <= v.x1 && y >= v.y0) continue;      // the view region is already populated
      if (place(x, y, 0.35)) n++;
    }

    const byKey = new Map();
    for (const s of stars) {
      const key = `${s.fill}|${s.r}|${s.a}`;
      let g = byKey.get(key);
      if (!g) { g = {fill: s.fill, r: s.r, a: s.a, d: ''}; byKey.set(key, g); }
      g.d += `M${s.x} ${s.y}h.01`;
    }
    const groups = Array.from(byKey.values()).sort((p, q) => (p.r - q.r) || (p.a - q.a) || p.fill.localeCompare(q.fill));
    return {stars, groups};
  }

  exports.SKY = SKY;
  exports.STAR_STEPS = STAR_STEPS;
  exports.STAR_TINTS = STAR_TINTS;
  exports.STAR_DEFAULTS = STAR_DEFAULTS;
  exports.starVisibility = starVisibility;
  exports.starField = starField;
  exports.STORAGE_KEY = STORAGE_KEY;
  exports.SOUND_MODES = SOUND_MODES;
  exports.DEFAULT_PREFS = DEFAULT_PREFS;
  exports.AUDIO_TAIL_S = AUDIO_TAIL_S;
  exports.AUDIO_FADE_S = AUDIO_FADE_S;
  exports.AUDIO_SILENT_LEAD_S = AUDIO_SILENT_LEAD_S;
  exports.AUDIO_TAIL_CAP_MS = AUDIO_TAIL_CAP_MS;
  exports.audioFadePlan = audioFadePlan;
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
