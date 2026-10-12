(() => {
  'use strict';
  // Adds row-local hierarchy toggles to Jira Cloud backlogs, not the issue detail drawer.
  const keyPattern = /^[A-Z][A-Z0-9_]*-\d+$/i;
  const rowSelectors = ['[data-testid*="issue-card"]','[data-testid*="issueCard"]',
    '[data-testid*="backlog.card"]','[data-testid*="backlog.issue"]',
    '[data-issue-key]','[role="listitem"]','[role="row"]'];
  const mounted = new Map();
  // Jira's hierarchy/subtask glyph is the signal: never add a toggle to every row.
  const glyphSelectors = [
    '[data-testid*="subtask" i]', '[data-testid*="hierarchy" i]',
    '[aria-label*="subtask" i]', '[aria-label*="hierarchy" i]',
    '[title*="subtask" i]', '[title*="hierarchy" i]',
    'svg[data-testid*="child" i]', '[data-testid*="child-issue" i]'
  ];
  const cache = new Map();
  let pendingScan = false;
  const make = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const isBacklog = () => /backlog/i.test(location.pathname + location.hash);
  const url = key => location.origin + '/browse/' + encodeURIComponent(key);

  function findRow(label) {
    for (const selector of rowSelectors) {
      const el = label.closest(selector);
      if (el && el.getBoundingClientRect().width >= 250 &&
          el.getBoundingClientRect().height <= 160) return el;
    }
    for (let el = label.parentElement; el && el !== document.body; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width >= 300 && r.height >= 32 && r.height <= 95) return el;
    }
    return null;
  }

  function labels() {
    const root = document.querySelector('[data-testid*="backlog.card-list"]') ||
      document.querySelector('[data-testid*="backlog-content"]') ||
      document.querySelector('main') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const result = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (!keyPattern.test(text)) continue;
      const el = walker.currentNode.parentElement;
      if (!el || el.closest('.jsd-inline, [role="dialog"]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.left > window.innerWidth * .72) continue;
      result.push({ key: text.toUpperCase(), el });
    }
    return result;
  }

  function findSubtaskGlyph(row, label) {
    // Prefer Jira's accessible/test identifiers, but restrict matches to a compact
    // icon around the issue's summary, not a whole backlog row or panel.
    const rowRect = row.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    for (const selector of glyphSelectors) {
      for (const candidate of row.querySelectorAll(selector)) {
        const svg = candidate.matches('svg') ? candidate : candidate.querySelector('svg');
        if (!svg) continue;
        const rect = svg.getBoundingClientRect();
        if (rect.width < 10 || rect.width > 28 || rect.height < 10 || rect.height > 28) continue;
        if (rect.left <= labelRect.left || rect.right > rowRect.right - 20) continue;
        return svg;
      }
    }

    // Some Jira editions expose only the SVG without its semantic label.
    // Match the connected-box hierarchy glyph by geometric primitives,
    // never merely by the presence of *any* SVG in a row.
    for (const svg of row.querySelectorAll('svg')) {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 14 || rect.width > 26 || rect.height < 14 || rect.height > 26) continue;
      if (rect.left <= labelRect.right + 12 || rect.right > rowRect.right - 40) continue;
      const shapes = svg.querySelectorAll('rect, circle, line, polyline');
      const boxes = svg.querySelectorAll('rect, circle').length;
      const connections = svg.querySelectorAll('line, polyline').length;
      if (boxes >= 2 && connections >= 1 && shapes.length >= 3) return svg;
      // Atlassian also draws this symbol as one or more paths with
      // multiple rectangular subpaths and a horizontal/vertical connector.
      const pathData = [...svg.querySelectorAll('path[d]')]
        .map(path => path.getAttribute('d') || '').join(' ');
      if ((pathData.match(/[mM]/g) || []).length >= 3 &&
          /[hHvV]/.test(pathData)) return svg;
    }
    return null;
  }

  async function getIssue(key, signal) {
    if (cache.has(key)) return cache.get(key);
    const response = await fetch('/rest/api/3/issue/' + encodeURIComponent(key) +
      '?fields=summary,status,subtasks,parent', {
      credentials: 'same-origin', headers: { Accept: 'application/json' }, signal
    });
    if (!response.ok) throw new Error('Jira API returned HTTP ' + response.status);
    const issue = await response.json();
    cache.set(key, issue);
    return issue;
  }

  function childLink(issue, currentKey) {
    const link = make('a', 'jsd-child');
    link.href = url(issue.key);
    if (issue.key === currentKey) link.classList.add('jsd-active');
    const done = issue.fields?.status?.statusCategory?.key === 'done';
    link.append(make('span', 'jsd-check', done ? '✓' : '○'));
    link.append(make('span', 'jsd-key', issue.key));
    link.append(make('span', 'jsd-summary', issue.fields?.summary || 'Untitled issue'));
    if (issue.fields?.status?.name)
      link.append(make('span', 'jsd-status', issue.fields.status.name));
    link.addEventListener('click', e => e.stopPropagation());
    return link;
  }

  function title(entry, label) {
    entry.button.textContent = entry.open ? '▾' : '▸';
    entry.button.title = label + ' for ' + entry.key;
    entry.button.setAttribute('aria-label', (entry.open ? 'Collapse ' : 'Expand ') + label + ' for ' + entry.key);
    entry.button.setAttribute('aria-expanded', String(entry.open));
  }

  function draw(entry, issue, siblings) {
    if (!entry.open || !entry.panel.isConnected) return;
    const parent = issue.fields?.parent;
    const items = parent ? siblings : (issue.fields?.subtasks || []);
    title(entry, (parent ? 'Sibling subtasks' : 'Subtasks') + ' (' + items.length + ')');
    entry.panel.replaceChildren();
    if (parent) {
      entry.panel.append(make('div', 'jsd-caption', 'Parent issue'));
      entry.panel.append(childLink(parent, entry.key));
      entry.panel.append(make('div', 'jsd-caption', 'Sibling subtasks'));
    }
    if (!items.length) entry.panel.append(make('div', 'jsd-empty', 'No subtasks found.'));
    else for (const child of items) entry.panel.append(childLink(child, entry.key));
  }

  async function expand(entry) {
    entry.open = true;
    entry.panel.hidden = false;
    title(entry, 'Loading…');
    entry.panel.replaceChildren(make('div', 'jsd-empty', 'Loading issue hierarchy…'));
    const controller = new AbortController();
    entry.controller = controller;
    try {
      const issue = await getIssue(entry.key, controller.signal);
      const parentKey = issue.fields?.parent?.key;
      const parent = parentKey ? await getIssue(parentKey, controller.signal) : null;
      if (entry.controller === controller && entry.open)
        draw(entry, issue, parent?.fields?.subtasks || []);
    } catch (error) {
      if (error.name === 'AbortError' || !entry.open) return;
      title(entry, 'Subtasks');
      entry.panel.replaceChildren(make('div', 'jsd-empty', 'Unable to load: ' + error.message));
    }
  }

  function remove(entry) {
    entry.controller?.abort();
    entry.button.remove();
    entry.panel.remove();
    if (entry.row.dataset.jsdIssueKey === entry.key) delete entry.row.dataset.jsdIssueKey;
    mounted.delete(entry.key);
  }

  function attach(key, label) {
    const row = findRow(label);
    if (!row || row.closest('.jsd-inline')) return;
    const glyph = findSubtaskGlyph(row, label);
    if (!glyph) return;
    if (row.dataset.jsdIssueKey && row.dataset.jsdIssueKey !== key) return;
    const old = mounted.get(key);
    if (old && old.row === row && old.button.isConnected && old.panel.isConnected) return;
    if (old) remove(old);

    const button = make('button', 'jsd-expand', '▸');
    button.type = 'button';
    button.setAttribute('aria-label', 'Expand subtasks for ' + key);
    button.setAttribute('aria-expanded', 'false');
    const panel = make('div', 'jsd-inline');
    panel.hidden = true;
    panel.addEventListener('click', event => event.stopPropagation());
    const entry = { key, row, label, button, panel, open: false, controller: null };
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (entry.open) {
        entry.open = false;
        entry.controller?.abort();
        entry.panel.hidden = true;
        title(entry, 'Subtasks');
      } else void expand(entry);
    });
    row.dataset.jsdIssueKey = key;
    // Place the compact chevron next to Jira's existing hierarchy icon,
    // not after the issue key (which causes the label to wrap vertically).
    const anchor = glyph.closest('button, [role="button"]') || glyph;
    anchor.insertAdjacentElement('afterend', button);
    row.insertAdjacentElement('afterend', panel);
    mounted.set(key, entry);
  }

  function scan() {
    if (!isBacklog()) {
      for (const entry of [...mounted.values()]) remove(entry);
      return;
    }
    const found = new Set();
    for (const { key, el } of labels()) {
      if (found.has(key)) continue;
      found.add(key);
      attach(key, el);
    }
    for (const entry of [...mounted.values()])
      if (!entry.row.isConnected || !entry.button.isConnected || !entry.panel.isConnected ||
          !found.has(entry.key) || !findSubtaskGlyph(entry.row, entry.label))
        remove(entry);
  }

  new MutationObserver(() => {
    if (pendingScan) return;
    pendingScan = true;
    setTimeout(() => { pendingScan = false; scan(); }, 200);
  }).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', scan);
  setInterval(scan, 1500);
  scan();
})();
