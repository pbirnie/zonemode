---
name: Popup scrollbar UX
overview: Eliminate nested profile scrollbars in the toolbar popup, keep **`#root`** as the sole vertical scroll surface, and add a **sticky top chrome** so **Save**, **Close**, and **tab pills** remain visible while scrolling long Profiles (and other tabs).
todos:
  - id: confirm-third-bar
    content: >-
      Optional — In Chrome DevTools, confirm which element owns any “middle” scrollbar
      (#root vs html/body vs resize UI).
  - id: relax-textarea-scroll
    content: >-
      Edit `src/static/popup/styles.css` — remove `max-height` + `overflow-y: auto` from
      `#root textarea.summary-profile-keywords`; optionally bump `rows` on keyword
      textareas in `SettingsPanel.tsx`.
  - id: sticky-top-chrome
    content: >-
      Tabbed toolbar popup (`SettingsPanel.tsx` when `tabbed && deferPersistenceWrites`): wrap
      **`settings-header`**, **`settings-sync-hint`** (when present), and **`settings-tabs`**
      in a single **`settings-popup-sticky`** container. Add **`src/static/popup/styles.css`** (or
      popup-scoped overrides) — `position: sticky; top: 0`, solid background matching shell,
      `z-index` above scrolling body, subtle **bottom border/shadow**, no double borders between
      header and tabs (may adjust existing header/panel borders).
  - id: regression-wheel
    content: >-
      Manually regression-test popup wheel/trackpad after keyword textarea edits and long
      profile lists (#root-only scroll).
  - id: changelog
    content: >-
      Update `ENHANCEMENTS.md` + `popupChangelog.ts` Unreleased — popup layout (single scroll +
      sticky header/tabs/actions); PRD only if UX section warrants a line.

---

# Popup Profiles scroll + sticky Save / Close / tabs

## Goal

1. Prefer **one** vertical scrollbar for the popup content (historically **`#root`** in [`src/static/popup/styles.css`](src/static/popup/styles.css)).
2. **Sticky top region** stays visible during scroll: **Save**, **Close**, **tab strip** (“Profiles”, “API”, etc.), and optionally the yellow **Changes apply after Save…** hint so users always reach actions/tabs without scrolling back up.

## Source of stacked scrollbars (today)

- **`#root`**: `overflow-y: auto`, `max-height` — primary scroll (**intended**).
- **Keyword textarea**: `#root textarea.summary-profile-keywords { max-height: 340px; overflow-y: auto }` — **second scroll** when content exceeds cap.
- A **third** bar (if observed): verify in DevTools; may be resize affordance vs host chrome.

## Part A — Remove textarea-inner scroll

- In [`src/static/popup/styles.css`](src/static/popup/styles.css), remove **`max-height: 340px`** and **`overflow-y: auto`** from **`#root textarea.summary-profile-keywords`** (or set **`overflow-y: visible`** / **`max-height: none`**).
- Optional: increase **`rows`** on the Profiles keyword **`<textarea>`** in [`src/shared/components/SettingsPanel.tsx`](src/shared/components/SettingsPanel.tsx).

## Part B — Sticky header / hint / tabs (required)

### Markup (`SettingsPanel.tsx`, tabbed + deferred-save path only)

Today order is roughly:

```text
.settings-header → h3 + Save/Close
.settings-content
  (.settings-sync-hint)
  (.settings-tabs)
  (#settings-tabpanel-main …)
```

**Change:** Introduce wrapper **only when `tabbed && deferPersistenceWrites`** (toolbar popup):

```text
.settings-popup-sticky (new)
  .settings-header
  .settings-sync-hint (if present — keep inside sticky strip so hint doesn’t disappear)
  .settings-tabs
.settings-tab-panel (+ rest of scrolling content stays below wrapper)
```

Optionally rename/move **`id="settings-tabpanel-main"`** / **`aria-labelledby`** so accessibility still matches **`role="tabpanel"`**: tab buttons’ **`aria-controls`** should continue to reference the scrolling panel **`id`** (either keep **`settings-tabpanel-main`** only on the panel below sticky, or update attributes consistently).

### CSS (popup stylesheet only — [`src/static/popup/styles.css`](src/static/popup/styles.css))

- **`.settings-popup-sticky`** (or **`#root .settings-popup-shell .settings-popup-sticky`**):

  - `position: sticky; top: 0;`
  - `z-index: 12` (or similar) above profile sections and changelog.
  - **Solid background** matching **`#1a1b1e`** / **`zonemode-container`** so content doesn’t show through while scrolling (`background` — consider matching **`.settings-header`** if it differs).
  - **`border-bottom`** or light **box-shadow** to separate fixed strip from scrolling body.
  - **Bottom padding adjustments** — avoid doubling borders between header and tabs (may remove/adjust **`settings-tabs`** `border-bottom` or **`settings-header`** border if present).

- Ensure **`.popup-root`** / **`.popup-scroll-pane`** don’t defeat sticky (no stray `overflow: hidden` on an ancestor between **`#root`** and sticky — today **`popup-scroll-pane`** is `overflow: visible`; keep it that way).

### Use existing **`settings-popup-shell`** class on the outer **`zonemode-container`**

[`settings-popup-shell`](src/shared/components/SettingsPanel.tsx) is already applied when `tabbed` is true (`SettingsPanel.tsx`).

Add popup-only rules under **`#root .settings-popup-shell`** to scope overrides (don’t regress watch-page / non-tabbed embed).

## Verification

- **Profiles** tab with multiple custom profiles + long keyword lists: only **`#root`** scrolls (no scrollbar inside keyword textarea unless user **resizes** via **`resize: vertical`** — acceptable).
- While scrolling, **Save**, **Close**, **sync hint**, and **tabs** remain pinned at top of **`#root`** viewport.
- Other tabs (**API**, **Prompt**, etc.) behave the same; **sticky strip** stays visible.

## Documentation

- **`ENHANCEMENTS.md`** + **`src/shared/popupChangelog.ts`** — Unreleased bullet for toolbar popup UX.
- **`PRD.md`** — one line under settings popup UX if pseudocode mentions layout (optional).

