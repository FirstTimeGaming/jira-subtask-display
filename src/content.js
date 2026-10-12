/* Jira Subtask Display — runs only on Jira Cloud issue views. */
(() => {
  "use strict";

  const PANEL_ID = "jira-subtask-display";
  const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[0-9]+$/i;
  const HEADER_SELECTORS = [
    '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
    '[data-testid="issue.views.issue-base.foundation.summary.heading-container"] h1',
    'main h1',
    '[role="main"] h1'
  ];
  let activeKey = null;
  let requestId = 0;
  let controller = null;
  let cachedView = null;
  let expanded = true;

  function getIssueKey() {
    const browse = location.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/i);
    if (browse) return browse[1].toUpperCase();
    // Jira project boards may open issues in a modal using selectedIssue.
    const selected = new URLSearchParams(location.search).get("selectedIssue");
    return selected && ISSUE_KEY.test(selected) ? selected.toUpperCase() : null;
  }

  function issueUrl(key) {
    return location.origin + "/browse/" + encodeURIComponent(key);
  }

  async function fetchIssue(key, signal) {
    const path = "/rest/api/3/issue/" + encodeURIComponent(key) +
      "?fields=summary,status,subtasks,parent";
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal
    });
    if (!response.ok) {
      throw new Error(response.status === 401 || response.status === 403
        ? "Jira access denied. Check your session and issue permissions."
        : "Jira API returned HTTP " + response.status);
    }
    return response.json();
  }

  function findHeader() {
    for (const selector of HEADER_SELECTORS) {
      const candidate = document.querySelector(selector);
      if (candidate && candidate.isConnected) return candidate;
    }
    return null;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createLink(issue, currentKey) {
    const key = issue.key;
    const link = element("a", "jsd-issue");
    link.href = issueUrl(key);
    if (key === currentKey) {
      link.classList.add("jsd-current");
      link.setAttribute("aria-current", "page");
    }
    const status = issue.fields?.status?.name || "";
    const isDone = issue.fields?.status?.statusCategory?.key === "done";
    link.append(element("span", "jsd-mark", isDone ? "✓" : "○"));
    link.append(element("span", "jsd-key", key));
    link.append(element("span", "jsd-summary", issue.fields?.summary || "Untitled issue"));
    if (status) link.append(element("span", "jsd-status", status));
    return link;
  }

  function showMessage(container, message) {
    container.replaceChildren(element("p", "jsd-message", message));
  }

  function render(view) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !view) return;
    const { issue, siblings, error } = view;
    const parent = issue.fields?.parent;
    const children = parent ? siblings : (issue.fields?.subtasks || []);
    const heading = panel.querySelector(".jsd-toggle");
    const body = panel.querySelector(".jsd-body");
    heading.textContent = (expanded ? "▾ " : "▸ ") +
      (parent ? "Sibling subtasks" : "Subtasks") +
      (error ? "" : " (" + children.length + ")");
    heading.setAttribute("aria-expanded", String(expanded));
    body.hidden = !expanded;
    if (!expanded) return;

    body.replaceChildren();
    if (parent) {
      const parentLabel = element("div", "jsd-section-label", "Parent issue");
      body.append(parentLabel, createLink(parent, issue.key));
      body.append(element("div", "jsd-section-label", "Subtasks"));
    }
    if (error) {
      showMessage(body, error);
    } else if (children.length === 0) {
      body.append(element("p", "jsd-message", "No subtasks found."));
    } else {
      const list = element("div", "jsd-list");
      for (const child of children) list.append(createLink(child, issue.key));
      body.append(list);
    }
  }

  function mount() {
    if (!activeKey) return;
    const header = findHeader();
    if (!header) return;
    let panel = document.getElementById(PANEL_ID);
    if (panel && panel.dataset.issueKey !== activeKey) panel.remove();
    panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = element("section", "jsd-panel");
      panel.id = PANEL_ID;
      panel.dataset.issueKey = activeKey;
      panel.setAttribute("aria-label", "Issue hierarchy");
      const button = element("button", "jsd-toggle", "▾ Subtasks");
      button.type = "button";
      button.setAttribute("aria-expanded", String(expanded));
      const body = element("div", "jsd-body");
      button.addEventListener("click", () => {
        expanded = !expanded;
        if (cachedView) render(cachedView);
        else {
          button.setAttribute("aria-expanded", String(expanded));
          body.hidden = !expanded;
        }
      });
      panel.append(button, body);
    }
    // Jira re-renders sections during SPA navigation; reattach when necessary.
    if (panel.previousElementSibling !== header) {
      header.insertAdjacentElement("afterend", panel);
      if (cachedView) render(cachedView);
      else showMessage(panel.querySelector(".jsd-body"), "Loading subtasks…");
    }
  }

  async function load(key, id, signal) {
    try {
      const issue = await fetchIssue(key, signal);
      let siblings = [];
      if (issue.fields?.parent?.key) {
        const parent = await fetchIssue(issue.fields.parent.key, signal);
        siblings = parent.fields?.subtasks || [];
      }
      if (id !== requestId) return;
      cachedView = { issue, siblings };
    } catch (error) {
      if (id !== requestId || error.name === "AbortError") return;
      cachedView = {
        issue: { fields: {} },
        siblings: [],
        error: error instanceof Error ? error.message : "Failed to load issues."
      };
    }
    mount();
    render(cachedView);
  }

  function update() {
    const key = getIssueKey();
    if (key !== activeKey) {
      activeKey = key;
      requestId++;
      controller?.abort();
      controller = null;
      cachedView = null;
      document.getElementById(PANEL_ID)?.remove();
      if (key) {
        controller = new AbortController();
        mount();
        void load(key, requestId, controller.signal);
      }
      return;
    }
    if (key) mount();
  }

  // Poll for Jira's client-side routing; observe DOM for replaced issue headers.
  // Debouncing prevents a MutationObserver loop caused by our own panel updates.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      update();
    }, 150);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener("popstate", update);
  window.addEventListener("hashchange", update);
  setInterval(update, 1000);
  update();
})();
