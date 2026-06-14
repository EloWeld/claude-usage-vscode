# Changelog

All notable changes to **Claude Usage Bars** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
