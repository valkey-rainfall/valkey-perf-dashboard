/**
 * Tests for lib/site-menu.js: render, keyboard, current-page mark, the canary
 * count, and a static check that every page loads the menu.
 * Run: node --test tests/site-menu.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SiteMenu = require('../lib/site-menu.js');

const root = path.join(__dirname, '..');

// A small DOM: enough for the menu's createElement / attribute / event /
// focus calls. Events bubble from the target to the document.
class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = {};
    this.ownText = '';
    this.innerHTMLWrites = 0;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  removeAttribute(name) { delete this.attrs[name]; }
  get textContent() { return this.ownText + this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(value) { this.innerHTMLWrites++; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  focus() { this.ownerDocument.activeElement = this; }
  all(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.all(pred, out)); return out; }
}

function fire(target, type, props) {
  const event = Object.assign({ type, target, defaultPrevented: false }, props || {});
  event.preventDefault = () => { event.defaultPrevented = true; };
  const doc = target.ownerDocument;
  for (let n = target; n; n = n.parentNode) (n.listeners[type] || []).forEach(fn => fn(event));
  (doc.listeners[type] || []).forEach(fn => fn(event));
  return event;
}

function makeDocument() {
  const doc = { listeners: {}, activeElement: null, readyState: 'complete' };
  doc.createElement = tag => new FakeNode(tag, doc);
  doc.head = new FakeNode('head', doc);
  doc.body = new FakeNode('body', doc);
  doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.getElementById = id => [doc.head, doc.body].flatMap(n => n.all(x => x.getAttribute('id') === id))[0] || null;
  doc.querySelectorAll = sel => {
    assert.equal(sel, '[data-site-menu]');
    return doc.body.all(x => x.hasAttribute('data-site-menu'));
  };
  return doc;
}

function render(pathname) {
  const doc = makeDocument();
  const container = doc.body.appendChild(doc.createElement('div'));
  const menu = SiteMenu.mount(container, { document: doc, pathname });
  return { doc, container, menu };
}

describe('site menu render', () => {
  it('draws a button that controls a hidden list of every page', () => {
    const { doc, menu } = render('/index.html');
    assert.equal(menu.button.tagName, 'BUTTON');
    assert.equal(menu.button.getAttribute('type'), 'button');
    assert.equal(menu.button.getAttribute('aria-expanded'), 'false');
    assert.equal(menu.button.textContent, 'Menu');
    const listId = menu.button.getAttribute('aria-controls');
    assert.ok(listId);
    assert.equal(doc.getElementById(listId), menu.list);
    assert.equal(menu.list.tagName, 'UL');
    assert.ok(menu.list.hasAttribute('hidden'));
    assert.deepEqual(menu.links.map(a => a.getAttribute('href')),
      ['index.html', 'notable.html', 'ab.html', 'compare.html', 'canary.html', 'status.html']);
    assert.deepEqual(menu.links.map(a => a.children[0].textContent),
      ['Performance History', 'Notable Changes', 'Commit A/B', 'Compare Engines', 'Canary Findings', 'Host Status']);
    assert.equal(menu.button.parentNode.tagName, 'NAV');
    assert.equal(menu.button.parentNode.getAttribute('aria-label'), 'Site');
  });

  it('injects its style once and writes no markup strings', () => {
    const { doc, container } = render('/index.html');
    SiteMenu.mount(doc.body.appendChild(doc.createElement('div')), { document: doc, pathname: '/index.html' });
    assert.equal(doc.head.children.length, 1);
    assert.ok(doc.head.children[0].textContent.includes('.site-menu-list'));
    assert.equal(container.all(n => n.innerHTMLWrites > 0).length, 0);
  });

  it('a second menu on one page gets its own list id', () => {
    const { doc, menu } = render('/index.html');
    const other = SiteMenu.mount(doc.body.appendChild(doc.createElement('div')), { document: doc, pathname: '/index.html' });
    assert.notEqual(menu.list.getAttribute('id'), other.list.getAttribute('id'));
  });
});

describe('site menu current-page mark', () => {
  for (const page of SiteMenu.PAGES) {
    it(`marks ${page.href} with aria-current and visible text`, () => {
      const { menu } = render('/some/dir/' + page.href);
      const marked = menu.links.filter(a => a.getAttribute('aria-current') === 'page');
      assert.equal(marked.length, 1);
      assert.equal(marked[0].getAttribute('href'), page.href);
      assert.ok(marked[0].textContent.endsWith('current'), 'a visible word, not colour alone');
      for (const a of menu.links) if (a !== marked[0]) assert.ok(!a.textContent.includes('current'));
    });
  }

  it('treats a directory path as index.html and an unknown page as none', () => {
    assert.equal(SiteMenu.currentPage('/'), 'index.html');
    assert.equal(SiteMenu.currentPage('/dashboard/'), 'index.html');
    assert.equal(SiteMenu.currentPage('/intro.html'), null);
    const { menu } = render('/intro.html');
    assert.equal(menu.links.filter(a => a.hasAttribute('aria-current')).length, 0);
  });
});

describe('site menu keyboard', () => {
  it('Enter opens the list and focuses the first page; Escape closes and returns focus', () => {
    const { doc, menu } = render('/index.html');
    menu.button.focus();
    const ev = fire(menu.button, 'keydown', { key: 'Enter' });
    assert.ok(ev.defaultPrevented);
    assert.equal(menu.button.getAttribute('aria-expanded'), 'true');
    assert.ok(!menu.list.hasAttribute('hidden'));
    assert.equal(doc.activeElement, menu.links[0]);
    fire(doc.activeElement, 'keydown', { key: 'Escape' });
    assert.equal(menu.button.getAttribute('aria-expanded'), 'false');
    assert.ok(menu.list.hasAttribute('hidden'));
    assert.equal(doc.activeElement, menu.button);
  });

  it('Space opens and closes from the button', () => {
    const { menu } = render('/index.html');
    fire(menu.button, 'keydown', { key: ' ' });
    assert.ok(menu.isOpen());
    fire(menu.button, 'keydown', { key: ' ' });
    assert.ok(!menu.isOpen());
  });

  it('arrow keys move with wrap, Home and End jump', () => {
    const { doc, menu } = render('/index.html');
    const last = menu.links.length - 1;
    fire(menu.button, 'keydown', { key: 'ArrowDown' });
    assert.ok(menu.isOpen());
    assert.equal(doc.activeElement, menu.links[0]);
    fire(doc.activeElement, 'keydown', { key: 'ArrowDown' });
    assert.equal(doc.activeElement, menu.links[1]);
    fire(doc.activeElement, 'keydown', { key: 'ArrowUp' });
    fire(doc.activeElement, 'keydown', { key: 'ArrowUp' });
    assert.equal(doc.activeElement, menu.links[last], 'ArrowUp on the first wraps to the last');
    fire(doc.activeElement, 'keydown', { key: 'ArrowDown' });
    assert.equal(doc.activeElement, menu.links[0], 'ArrowDown on the last wraps to the first');
    fire(doc.activeElement, 'keydown', { key: 'End' });
    assert.equal(doc.activeElement, menu.links[last]);
    fire(doc.activeElement, 'keydown', { key: 'Home' });
    assert.equal(doc.activeElement, menu.links[0]);
    const other = fire(doc.activeElement, 'keydown', { key: 'a' });
    assert.ok(!other.defaultPrevented, 'other keys keep their default');
  });

  it('ArrowUp on the button opens at the last page; Tab closes without moving focus', () => {
    const { doc, menu } = render('/index.html');
    fire(menu.button, 'keydown', { key: 'ArrowUp' });
    assert.equal(doc.activeElement, menu.links[menu.links.length - 1]);
    const tab = fire(doc.activeElement, 'keydown', { key: 'Tab' });
    assert.ok(!tab.defaultPrevented);
    assert.ok(!menu.isOpen());
  });

  it('nextIndex covers an empty list and no current focus', () => {
    assert.equal(SiteMenu.nextIndex('ArrowDown', 0, 0), -1);
    assert.equal(SiteMenu.nextIndex('ArrowDown', -1, 6), 0);
    assert.equal(SiteMenu.nextIndex('ArrowUp', -1, 6), 5);
    assert.equal(SiteMenu.nextIndex('x', 2, 6), -1);
  });
});

describe('site menu pointer', () => {
  it('a click toggles; a click outside closes; a click inside keeps it open', () => {
    const { doc, menu } = render('/index.html');
    fire(menu.button, 'click');
    assert.ok(menu.isOpen());
    fire(menu.links[2], 'click');
    assert.ok(menu.isOpen());
    const outside = doc.body.appendChild(doc.createElement('main'));
    fire(outside, 'click');
    assert.ok(!menu.isOpen());
    fire(menu.button, 'click');
    fire(menu.button, 'click');
    assert.ok(!menu.isOpen());
  });

  it('focus leaving the menu closes it', () => {
    const { doc, container, menu } = render('/index.html');
    menu.open(0);
    fire(menu.links[0], 'focusout', { relatedTarget: menu.links[1] });
    assert.ok(menu.isOpen());
    fire(menu.links[0], 'focusout', { relatedTarget: doc.body });
    assert.ok(!menu.isOpen());
    assert.ok(container.contains(menu.links[0]));
  });
});

describe('site menu canary link', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');

  it('starts as a muted plain link to the canary page, beside the button', () => {
    const { container, menu } = render('/notable.html');
    assert.equal(menu.canary.parentNode, container, 'visible next to the button, not inside the list');
    assert.equal(menu.canary.textContent, 'Canary');
    assert.equal(menu.canary.getAttribute('href'), 'canary.html');
    assert.ok(menu.canary.getAttribute('class').split(' ').includes('muted'));
  });

  it('shows the open count from a fresh findings file and stays muted for a stale one', () => {
    const { menu } = render('/notable.html');
    menu.setFindings({ generated_at: '2026-11-09T06:00:00Z', open_count: 3 }, now);
    assert.equal(menu.canary.textContent, 'Canary: 3 open findings');
    assert.equal(menu.canary.getAttribute('class'), 'site-menu-canary');
    menu.setFindings({ generated_at: '2026-11-08T08:00:00Z', open_count: 3 }, now);
    assert.equal(menu.canary.textContent, 'Canary');
    assert.ok(menu.canary.getAttribute('class').includes('muted'));
    menu.setFindings(null, now);
    assert.equal(menu.canary.textContent, 'Canary');
  });

  it('links to a runner when the page knows its platform', () => {
    const { menu } = render('/index.html');
    menu.setCanaryRunner('runner-x');
    assert.equal(menu.canary.getAttribute('href'), 'canary.html#runner=runner-x');
    menu.setCanaryRunner(null);
    assert.equal(menu.canary.getAttribute('href'), 'canary.html');
  });

  it('autoInit mounts every [data-site-menu] once, reads findings.json and keeps a runner set before mount', async () => {
    // A fresh copy so the module-level page state starts empty.
    delete require.cache[require.resolve('../lib/site-menu.js')];
    const Fresh = require('../lib/site-menu.js');
    const doc = makeDocument();
    const mountNode = doc.body.appendChild(doc.createElement('div'));
    mountNode.setAttribute('data-site-menu', '');
    const urls = [];
    const win = {
      document: doc,
      location: { pathname: '/index.html' },
      DATA_URL: 'https://data.example.test',
      fetch: url => {
        urls.push(url);
        return Promise.resolve({ ok: true, json: () => ({ generated_at: new Date().toISOString(), open_count: 1 }) });
      },
    };
    Fresh.setCanaryRunner('runner-y');
    Fresh.autoInit(win);
    Fresh.autoInit(win);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(mountNode.all(n => n.tagName === 'BUTTON').length, 1, 'mounted once');
    assert.equal(urls.length, 1, 'findings read once');
    assert.ok(urls[0].startsWith('https://data.example.test/canary/findings.json?t='));
    const canary = mountNode.children[0];
    assert.equal(canary.textContent, 'Canary: 1 open finding');
    assert.equal(canary.getAttribute('href'), 'canary.html#runner=runner-y');
  });
});

describe('every page loads the site menu', () => {
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== 'intro.html');

  it('the menu lists exactly the user-facing pages in the repo', () => {
    assert.deepEqual(SiteMenu.PAGES.map(p => p.href).sort(), pages.slice().sort());
  });

  for (const file of pages) {
    it(`${file} has the menu element in its header and loads the script after period-helpers`, () => {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      assert.ok(header.includes('<div data-site-menu></div>'), 'menu element in the header');
      const helpers = html.indexOf('<script src="lib/period-helpers.js"></script>');
      const menu = html.indexOf('<script src="lib/site-menu.js"></script>');
      assert.ok(helpers > 0 && menu > helpers, 'period-helpers.js then site-menu.js');
      assert.ok(menu > html.indexOf('</header>'), 'script after the menu element');
      assert.ok(html.indexOf('<script src="config.js"></script>') < menu, 'config.js (DATA_URL) first');
    });
  }

  it('the one-off header page links are gone', () => {
    for (const file of pages) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      assert.ok(!/<a href="[a-z]+\.html"/.test(header), `${file} header has no page links of its own`);
    }
  });

  it('intro.html is not a page and has no menu', () => {
    assert.ok(!fs.readFileSync(path.join(root, 'intro.html'), 'utf8').includes('site-menu'));
  });

  it('site-menu.js is ASCII only', () => {
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(fs.readFileSync(path.join(root, 'lib', 'site-menu.js'), 'utf8')));
  });
});
