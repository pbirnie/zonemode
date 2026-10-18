---
name: sync-prd
description: >-
  Keeps docs/PRD.md aligned with shipped extension behavior:
  architecture diagram, event-to-action pseudo-code, storage keys, and CSS
  outline rules. Use whenever changing content scripts, popup/settings UI,
  background messaging, manifest permissions, or any user-visible flow
  described in PRD.md; also when the user asks to update or review PRD.md.
---

# Keep PRD.md in sync

## File

- **[PRD.md](../../../docs/PRD.md)** under **`docs/`**.

## When to update (same change / same PR as the code)

Update **PRD.md** whenever you change anything that would make the PRD **wrong or incomplete** for a reader tracing **events → actions**:

| Area | Typical paths |
|------|----------------|
| Content script lifecycle, injection, navigation | `src/content/index.ts`, `fetchBindPatch.ts` |
| Summarize bar, summarize flow, profile dropdown | `src/content/components/SummaryButton.tsx`, related hooks |
| Metadata hover / diagnostic panel | `src/content/videoLinkTooltips.ts` |
| Profile filter, compact video outlines, anchors | `src/content/videoProfileFilter.ts` |
| Shared settings, storage keys, tabs | `src/shared/components/SettingsPanel.tsx`, `src/shared/*` keys |
| Background messages | `src/background/index.ts` |
| Popup shell | `src/popup/Popup.tsx` |
| Permissions / pages | `src/static/manifest/manifest.json` |

**Skip** PRD edits for refactors that do not change observable flows (rename-only, internal split) unless the PRD names old files or obsolete steps.

## What PRD is for (stay in scope)

- **Architecture** (who talks to whom).
- **Event → action pseudo-code** (load, click, `yt-navigate-finish`, `mouseover`, `MutationObserver`, `chrome.storage`, `runtime.sendMessage`, etc.).
- **Cross-cutting tables** (e.g. storage keys, outline CSS states) when they are part of the product contract.

**Do not** turn PRD into a second **[ENHANCEMENTS.md](../../../docs/ENHANCEMENTS.md)**; release notes and “what shipped when” stay there and in **popupChangelog** per project rules.

## How to sync

1. **Read** the relevant section(s) of **PRD.md** before or while editing code.
2. After behavior changes, **edit PRD.md** so that:
   - Section **numbers and titles** still match the major surfaces (adjust if you add a new major area).
   - **Pseudo-code** reflects real triggers and side effects (listeners, debounces, storage keys, message `type` strings).
   - **Diagram or tables** match new components, keys, or permissions.
3. Use the same **terminology** as the code (e.g. exact `chrome.runtime` message types, storage key constants if they are stable API for the extension).
4. **Before finishing** a task that touched flows above, confirm **PRD.md** would mislead no one following it step-by-step.
5. When **who talks to whom** or **runtime message types** change materially, update **[docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)** (Mermaid diagrams for GitHub) so it stays aligned with the PRD.

## Out of scope for PRD

- Line-by-line API of internal helpers unless they are the **sole** boundary for an event.
- Full prompt text or provider catalog (unless a new **setting** or **flow** is introduced that PRD already summarizes at a high level).
