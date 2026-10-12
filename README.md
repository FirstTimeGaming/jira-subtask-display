# Jira Subtask Display

A no-build Chrome/Edge Manifest V3 extension that inserts expandable issue hierarchy controls **into Jira Cloud backlog rows**, not the issue detail drawer.

## Install

1. Check out `ai/initial-subtask-display`.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, then choose **Load unpacked** and select this directory.
3. Navigate to your Jira project's **Backlog** page. Only rows showing Jira's hierarchy/subtask glyph receive a compact **▸** chevron, placed alongside that glyph within the issue row.
4. Click to expand an inline list directly below that backlog row. Click again to collapse.

The first click fetches the issue through the existing Jira session via `/rest/api/3/issue/{key}?fields=summary,status,subtasks,parent`. A parent issue shows its direct subtasks; a child issue shows its **parent and sibling subtasks**, since Jira's native subtasks only have one level.

## Implementation notes

- Backlog-only. The right-side issue drawer is unchanged.
- Glyph-gated compact chevrons, avoiding unnecessary controls on issues without Jira's subtask indicator; children show issue keys, summaries, and status.
- Requests load on demand and are cached during the page session.
- Detects DOM updates and SPA navigation to attach controls to freshly rendered rows.
- Only matches `*.atlassian.net`, requires an existing Jira session, and does not send data elsewhere.

## Validation

`node --check src/content.js`

**Browser testing is still required.** Jira backlog DOM structure and styling can vary across tenants, so confirm that (1) controls appear in the intended row, (2) expansion is directly beneath that row, (3) parent/child behavior is accurate, (4) scrolling and sprint/grouping remain usable, and (5) SPA navigation doesn't produce duplicated controls.

The glyph detection uses Jira test IDs / accessibility labels when available, followed by a conservative connected-box SVG heuristic. Some Jira versions may need an adjusted glyph selector; absence of a recognizable glyph intentionally suppresses the toggle. If your tenant uses virtualized rows or table markup, additional selector and placement tuning may be needed.
