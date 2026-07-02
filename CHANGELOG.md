# Changelog

All notable changes to **Claude Usage Bars** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.3.3] — 2026-06-14

### Changed

- **Usage now comes from Claude Code's statusline, read locally — no network call and no OAuth token.** Claude Code (the authorized client) hands its `statusLine.command` the rate-limit / model / context / cost data on every render; the extension installs a tap as that command which caches the data locally and reads it back. This keeps the extension inside Anthropic's terms (the previous OAuth-usage-endpoint approach did not).
- **Enable Live Quota** / **Disable Live Quota** commands install/remove the statusline tap, chaining (and restoring) any existing statusline so your bar is unchanged.

### Removed

- All direct calls to the Claude usage API and reading of the subscription OAuth token (Keychain / credentials file).

### Note

- Values are as fresh as Claude Code's last statusline render — live during an active session, last-seen when idle. Open a Claude Code session once to populate the data.

## [0.3.2] — 2026-06-14

### Added

- **Usage panel** — the webview now has two tabs: **Usage** (a day/week usage-over-time chart, current-window breakdown with reset times, and burn rate) and **Settings** (the appearance controls).
- **Click menu** — clicking the status bar opens a quick menu to jump to Usage, Settings, or Refresh.
- Usage history is now retained for **7 days** (was 24h) to power the weekly chart.

### Changed

- The tooltip's **Usage** link now opens the in-editor Usage panel instead of the Claude website.
- The tooltip's **Settings** link and the status bar open the panel on the matching tab.

## [0.3.1] — 2026-06-14

### Changed

- Rebranded to **Claude Usage Bars**: rewritten README, new icon, changelog, and Marketplace metadata (description, keywords, gallery banner). No functional changes.

## [0.3.0] — 2026-06-14

First release of the fork ([`mtglitch.claude-usage-bars`](https://marketplace.visualstudio.com/items?itemName=mtglitch.claude-usage-bars)), forked from [`jjsmackay/claude-usage-vscode`](https://github.com/jjsmackay/claude-usage-vscode) `0.2.0`.

### Added

- **13 status bar render styles** across four groups: ASCII (`percent`, `dual`, `dots`, `brackets`, `minimal`), graphic Unicode bars (`blocks`, `braille`, `gradient`), vertical meters (`vmeter`, `vtwin`, `vgauge`), and codicon vector meters (`iconmeter`, `iconsmall`).
- **Appearance settings panel** (webview) with a live style gallery, a multi-percent preview strip (15/30/40/60/80/95%), color pickers, and instant apply. Opens on status bar click or via *Claude Usage: Open Appearance Settings*.
- **Per-window styles** — render the session and weekly bars in different styles in *Both* mode (`statusBarStyleWeekly`).
- **Configurable colors** — `warnThreshold` / `critThreshold` plus custom hex colors for normal / warn / critical states (`normalColor`, `warnColor`, `critColor`, `colorEnabled`).
- **Configurable bar length** (4–40) and **custom leading icon**.
- **Usage analytics** — a 24-hour session sparkline, burn rate (`%/h`), and an ETA to the limit, shown in the tooltip.
- **Rate-limit handling** — a dedicated `429` status with `Retry-After` backoff instead of a raw error.

### Changed

- Default style is now `vgauge` (session) with `vmeter` for the weekly bar.
- Settings link in the tooltip opens the new appearance panel.

## [0.2.0] — upstream baseline

See the original project: [`jjsmackay/claude-usage-vscode`](https://github.com/jjsmackay/claude-usage-vscode).
