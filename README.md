# Jira Subtask Display

A lightweight, no-build **Chrome / Edge Manifest V3** extension for Jira Cloud. Displays a collapsible list of subtasks below the issue summary. When viewing a subtask, it shows the parent issue and sibling subtasks, highlighting the current issue.

## Install (unpacked)

1. Clone this repository and check out `ai/initial-subtask-display`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**, choose **Load unpacked**, and select the repository folder.
4. Open a Jira Cloud issue, e.g. `https://your-site.atlassian.net/browse/PROJECT-123`.

The extension is scoped to `*.atlassian.net` only. It uses your existing Jira session to fetch `/rest/api/3/issue/{key}?fields=summary,status,subtasks,parent`. It does not store Jira data or send it to third parties.

## Behavior

- Parent issues: list direct subtasks with key, summary and status.
- Subtasks: show clickable parent and siblings, including the current issue.
- Supports `/browse/PROJECT-123` and `?selectedIssue=PROJECT-123` URL forms.
- Detects Jira single-page-app navigation and mounts again after Jira replaces the heading.
- Handles empty lists and REST API failures.

## Limitations / next steps

- Jira's DOM is not a stable public extension API; verify the heading placement against the Jira issue view you use. The first implementation mounts just after Jira's summary heading, with fallbacks.
- This is intended for Chrome/Edge desktop; Firefox has not been tested.
- Additional nesting (epics, stories), preferences, and deployment packaging are future enhancements.

## Validation

Run `node --check src/content.js` and inspect `manifest.json`. Then manually verify a parent issue, a child issue, SPA navigation, empty subtasks, and no-access/expired-session behavior in your Jira tenant.
