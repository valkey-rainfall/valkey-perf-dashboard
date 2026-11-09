/**
 * site-menu.js -- the shared site navigation menu.
 *
 * Every user-facing page has an empty `<div data-site-menu></div>` in its
 * header and loads this file after it (and after lib/period-helpers.js).
 * The script fills each such element with:
 *   - the canary link, which shows the open-finding count from
 *     canary/findings.json (PeriodHelpers.canaryLinkState: a muted plain
 *     'Canary' when the file is missing or older than 26 h);
 *   - a "Menu" button that opens a list of all pages, with the current page
 *     marked by aria-current="page", a side bar and the word "current".
 *
 * Keyboard: Enter, Space or ArrowDown on the button opens the list and
 * moves focus to the first page (ArrowUp: the last page). In the list,
 * ArrowUp/ArrowDown move (with wrap), Home/End jump to the ends, Escape
 * closes and returns focus to the button, Tab closes. A click outside closes.
 *
 * Colours come from the page's theme variables (--card, --text, --border,
 * --accent, --muted); the fallbacks match the host status page, which has
 * no variables. Recorded text goes in with textContent only.
 *
 * Browser: loaded via <script src="lib/site-menu.js">; exposes SiteMenu.
 * Node:    const SiteMenu = require('./lib/site-menu.js');
 */
'use strict';

(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SiteMenu = api;
    api.autoInit(root);
  }
})(this, function (root) {

  /** All pages, in menu order. intro.html is the sign-on animation, not a page. */
  var PAGES = [
    { href: 'index.html', label: 'Performance History' },
    { href: 'notable.html', label: 'Notable Changes' },
    { href: 'ab.html', label: 'Commit A/B' },
    { href: 'compare.html', label: 'Compare Engines' },
    { href: 'canary.html', label: 'Canary Findings' },
    { href: 'status.html', label: 'Host Status' },
  ];

  var STYLE_ID = 'site-menu-style';
  var CSS = [
    '.site-menu { position: relative; display: flex; align-items: center; gap: 0.6rem; margin-left: auto; flex: 0 1 auto; min-width: 0; }',
    '.site-menu .site-menu-canary { color: var(--accent, #58a6ff); font-size: 0.76rem; font-weight: 500; text-decoration: none; min-width: 0; }',
    '.site-menu .site-menu-canary.muted { color: var(--muted, #8b949e); font-weight: 400; }',
    '.site-menu .site-menu-canary:hover { text-decoration: underline; }',
    '.site-menu nav { position: relative; flex: 0 0 auto; }',
    '.site-menu-button { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--card, #161b22); color: var(--text, #c9d1d9);',
    '  border: 1px solid var(--border, #30363d); border-radius: 4px; padding: 0.3rem 0.6rem; font: inherit; font-size: 0.8rem; line-height: 1.2; cursor: pointer; }',
    '.site-menu-button:hover, .site-menu-button[aria-expanded="true"] { border-color: var(--accent, #58a6ff); }',
    '.site-menu-bars { display: inline-flex; flex-direction: column; gap: 3px; }',
    '.site-menu-bars span { display: block; width: 13px; height: 2px; border-radius: 1px; background: currentColor; }',
    '.site-menu-list { position: absolute; top: calc(100% + 4px); right: 0; z-index: 300; list-style: none; margin: 0; padding: 0.3rem;',
    '  width: max-content; min-width: 12rem; max-width: calc(100vw - 1.5rem); max-height: calc(100vh - 5rem); overflow-y: auto;',
    '  background: var(--card, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.45); }',
    '.site-menu-list[hidden] { display: none; }',
    '.site-menu-list a { display: flex; align-items: baseline; gap: 0.75rem; padding: 0.45rem 0.6rem; border-left: 3px solid transparent; border-radius: 4px;',
    '  color: var(--text, #c9d1d9); font-size: 0.85rem; text-decoration: none; white-space: nowrap; }',
    '.site-menu-list a:hover { background: var(--border, #30363d); color: var(--text, #c9d1d9); }',
    '.site-menu-list a[aria-current="page"] { border-left-color: var(--accent, #58a6ff); font-weight: 600; }',
    '.site-menu-mark { margin-left: auto; color: var(--muted, #8b949e); font-size: 0.72rem; font-weight: 400; }',
    '.site-menu a:focus-visible, .site-menu-button:focus-visible { outline: 2px solid var(--accent, #58a6ff); outline-offset: 2px; }',
  ].join('\n');

  var idCounter = 0;

  /** The PAGES entry href for a location pathname, or null for another page. */
  function currentPage(pathname) {
    var last = String(pathname || '').split('/').pop() || 'index.html';
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].href === last) return last;
    }
    return null;
  }

  /** Focus index after a key in a list of `count` items, or -1 for other keys. */
  function nextIndex(key, index, count) {
    if (count <= 0) return -1;
    switch (key) {
      case 'ArrowDown': return index < 0 ? 0 : (index + 1) % count;
      case 'ArrowUp': return index < 0 ? count - 1 : (index - 1 + count) % count;
      case 'Home': return 0;
      case 'End': return count - 1;
      default: return -1;
    }
  }

  function periodHelpers() {
    if (root && root.PeriodHelpers) return root.PeriodHelpers;
    if (typeof PeriodHelpers !== 'undefined') return PeriodHelpers; // eslint-disable-line no-undef
    if (typeof require === 'function') return require('./period-helpers.js');
    return null;
  }

  function injectStyle(doc) {
    if (!doc.head || (doc.getElementById && doc.getElementById(STYLE_ID))) return;
    var style = doc.createElement('style');
    style.setAttribute('id', STYLE_ID);
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  /**
   * Fill `container` with the canary link and the menu. Returns a small
   * controller: open(focusIndex), close(returnFocus), isOpen(),
   * setFindings(findings, now), setCanaryRunner(runnerId), and the
   * button / list / links / canary elements.
   */
  function mount(container, options) {
    var opts = options || {};
    var doc = opts.document || container.ownerDocument;
    var current = currentPage(opts.pathname);
    var listId = 'siteMenuList' + (idCounter++ === 0 ? '' : String(idCounter));
    injectStyle(doc);

    container.setAttribute('class', 'site-menu');

    var canary = doc.createElement('a');
    canary.setAttribute('href', 'canary.html');
    canary.setAttribute('class', 'site-menu-canary muted');
    canary.setAttribute('title', 'Daily fixed-commit canary measurements per host');
    canary.textContent = 'Canary';
    container.appendChild(canary);

    var nav = doc.createElement('nav');
    nav.setAttribute('aria-label', 'Site');
    container.appendChild(nav);

    var button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('class', 'site-menu-button');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', listId);
    var bars = doc.createElement('span');
    bars.setAttribute('class', 'site-menu-bars');
    bars.setAttribute('aria-hidden', 'true');
    for (var b = 0; b < 3; b++) bars.appendChild(doc.createElement('span'));
    button.appendChild(bars);
    var buttonText = doc.createElement('span');
    buttonText.textContent = 'Menu';
    button.appendChild(buttonText);
    nav.appendChild(button);

    var list = doc.createElement('ul');
    list.setAttribute('id', listId);
    list.setAttribute('class', 'site-menu-list');
    list.setAttribute('hidden', '');
    nav.appendChild(list);

    var links = PAGES.map(function (page) {
      var item = doc.createElement('li');
      var link = doc.createElement('a');
      link.setAttribute('href', page.href);
      var label = doc.createElement('span');
      label.textContent = page.label;
      link.appendChild(label);
      if (page.href === current) {
        link.setAttribute('aria-current', 'page');
        var mark = doc.createElement('span');
        mark.setAttribute('class', 'site-menu-mark');
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = 'current';
        link.appendChild(mark);
      }
      item.appendChild(link);
      list.appendChild(item);
      return link;
    });

    function isOpen() { return button.getAttribute('aria-expanded') === 'true'; }

    function focusLink(index) {
      if (index >= 0 && index < links.length) links[index].focus();
    }

    function open(focusIndex) {
      button.setAttribute('aria-expanded', 'true');
      list.removeAttribute('hidden');
      if (typeof focusIndex === 'number') focusLink(focusIndex);
    }

    function close(returnFocus) {
      if (!isOpen()) return;
      button.setAttribute('aria-expanded', 'false');
      list.setAttribute('hidden', '');
      if (returnFocus) button.focus();
    }

    button.addEventListener('click', function () {
      if (isOpen()) close(false); else open();
    });

    button.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        // Handled here (not by the native click) so focus can move into the list.
        event.preventDefault();
        if (isOpen()) close(false); else open(0);
      } else if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        open(key === 'ArrowDown' ? 0 : links.length - 1);
      } else if (key === 'Escape' && isOpen()) {
        event.preventDefault();
        close(true);
      }
    });

    list.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key === 'Tab') {
        close(false);
        return;
      }
      var index = links.indexOf(doc.activeElement);
      var next = nextIndex(event.key, index, links.length);
      if (next >= 0) {
        event.preventDefault();
        focusLink(next);
      }
    });

    container.addEventListener('focusout', function (event) {
      var to = event.relatedTarget;
      if (to && !container.contains(to)) close(false);
    });

    doc.addEventListener('click', function (event) {
      if (isOpen() && !container.contains(event.target)) close(false);
    });

    function setFindings(findings, now) {
      var helpers = periodHelpers();
      if (!helpers) return;
      var state = helpers.canaryLinkState(findings, now);
      canary.textContent = state.text;
      canary.setAttribute('class', 'site-menu-canary' + (state.muted ? ' muted' : ''));
    }

    function setCanaryRunner(runnerId) {
      var helpers = periodHelpers();
      canary.setAttribute('href', helpers ? helpers.canaryPageHref(runnerId) : 'canary.html');
    }

    return {
      button: button, list: list, links: links, canary: canary,
      open: open, close: close, isOpen: isOpen,
      setFindings: setFindings, setCanaryRunner: setCanaryRunner,
    };
  }

  var controllers = [];
  var canaryRunner = null;
  var findingsLoaded = false;

  /** Point every canary link on the page at one runner (index.html knows its platform). */
  function setCanaryRunner(runnerId) {
    canaryRunner = runnerId || null;
    controllers.forEach(function (c) { c.setCanaryRunner(canaryRunner); });
  }

  /** Read canary/findings.json once (5-minute cache key) and show the count. */
  function loadFindings(win) {
    var dataUrl = typeof DATA_URL !== 'undefined' ? DATA_URL : win.DATA_URL; // eslint-disable-line no-undef
    if (!dataUrl || typeof win.fetch !== 'function') return;
    win.fetch(dataUrl + '/canary/findings.json?t=' + Math.floor(Date.now() / 300000))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (findings) {
        controllers.forEach(function (c) { c.setFindings(findings, Date.now()); });
      });
  }

  function mountAll(win) {
    var doc = win.document;
    var nodes = doc.querySelectorAll('[data-site-menu]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-site-menu-ready')) continue;
      nodes[i].setAttribute('data-site-menu-ready', '1');
      var controller = mount(nodes[i], { document: doc, pathname: win.location && win.location.pathname });
      if (canaryRunner) controller.setCanaryRunner(canaryRunner);
      controllers.push(controller);
    }
    if (controllers.length && !findingsLoaded) {
      findingsLoaded = true;
      loadFindings(win);
    }
  }

  function autoInit(win) {
    if (!win || !win.document) return;
    // The page loads this script after its header, so the menu element is
    // usually parsed already; mount it now and again once the document is done.
    mountAll(win);
    if (win.document.readyState === 'loading') {
      win.document.addEventListener('DOMContentLoaded', function () { mountAll(win); });
    }
  }

  return {
    PAGES: PAGES,
    currentPage: currentPage,
    nextIndex: nextIndex,
    mount: mount,
    setCanaryRunner: setCanaryRunner,
    autoInit: autoInit,
  };
});
