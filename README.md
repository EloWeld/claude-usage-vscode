<p align="center">
  <img src="resources/claude-color.png" width="120" alt="Claude Usage Bars" />
</p>

<h1 align="center">Claude Usage Bars</h1>

<p align="center"><b>The most customizable Claude Code usage indicator for VS Code.</b></p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=mtglitch.claude-usage-bars"><img src="https://img.shields.io/visual-studio-marketplace/v/mtglitch.claude-usage-bars?color=cc6644&label=Marketplace" alt="Marketplace Version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mtglitch.claude-usage-bars"><img src="https://img.shields.io/visual-studio-marketplace/i/mtglitch.claude-usage-bars?color=cc6644" alt="Installs" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mtglitch.claude-usage-bars"><img src="https://img.shields.io/visual-studio-marketplace/r/mtglitch.claude-usage-bars?color=cc6644" alt="Rating" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

No more hitting usage limits mid-flow. See your Claude Code session and weekly limits right in the VS Code status bar — and make them look exactly how you want.

![Status bar showing usage](resources/screenshot.png)

## What's new in this fork

A heavily extended fork of [`jjsmackay/claude-usage-vscode`](https://github.com/jjsmackay/claude-usage-vscode). On top of the original status bar indicator, it adds:

- **13 render styles** — ASCII, Unicode bars, vertical meters, and crisp codicon meters.
- **A live settings panel** — pick a style and tune everything with an instant preview, no JSON editing.
- **Per-window styles** — render the session and weekly bars in *different* styles.
- **Custom colors** — warn/critical thresholds with your own hex colors.
- **Burn-rate analytics** — a 24-hour sparkline, consumption rate, and an ETA to the limit.
- **Graceful rate-limit handling** — a clear `429` state with automatic backoff.

## Features

### Styles

Choose how usage is rendered. `{p}` is the percentage; in **Both** mode, bar styles draw a separate bar for the session and weekly limits.

| Group | Style | Example |
| ----- | ----- | ------- |
| ASCII | `percent` | `✼ 45%` |
| ASCII | `dual` | `✼ 45% · 23%` |
| ASCII | `dots` | `✼ ●●●●●○○○○○ 45%` |
| ASCII | `brackets` | `✼ [####······] 45%` |
| ASCII | `minimal` | `45%` |
| Graphic | `blocks` | `✼ ▰▰▰▰▱▱▱▱ 45%` |
| Graphic | `braille` | `✼ ⣿⣿⣦⣀ 45%` |
| Graphic | `gradient` | `✼ ▓▓▓▓░░░░ 45%` |
| Vertical | `vmeter` | `✼ ▆ 45%` |
| Vertical | `vtwin` | `✼ ▆▃ 45·23` |
| Vertical | `vgauge` | `✼ ███▄▁▁▁▁ 45%` |
| Icon | `iconmeter` | vector circle meter (codicons) |
| Icon | `iconsmall` | vector circle meter, smaller |

Bar length is configurable from 4 to 40 segments.

### Settings panel

Click the status bar item (or run **Claude Usage: Open Appearance Settings**) to open a panel with:

- a live gallery of every style,
- the selected style previewed at 15 / 30 / 40 / 60 / 80 / 95%,
- color pickers and threshold controls,

…all applied to the status bar instantly as you change them.

### Colors

Tint the indicator as usage climbs. Set **warn** and **critical** thresholds, and optionally your own hex colors for the normal / warn / critical states. Coloring can be turned off entirely.

### Analytics

Hover the status bar for the full breakdown — session (5h), weekly (7d), Opus, and Apps windows with progress bars and reset countdowns — plus an **Analytics** section: a sparkline of session usage over the last 24 hours, the current burn rate (`%/h`), and an estimated time to 100%.

### Resilience

When the Claude API rate-limits requests, the status bar shows a clear `🕐 429` state (instead of a raw error) and automatically backs off using the server's `Retry-After` hint.

## Settings reference

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `claudeUsage.statusBarStyle` | `vgauge` | Main render style (session). |
| `claudeUsage.statusBarStyleWeekly` | `vmeter` | Style for the weekly bar in **Both** mode (`same` = match main). |
| `claudeUsage.statusBarDisplay` | `both` | Which window(s) to show: `session`, `weekly`, `highest`, `both`. |
| `claudeUsage.statusBarIcon` | `✼` | Leading icon (empty to hide). |
| `claudeUsage.barLength` | `8` | Bar segments for bar styles (4–40). |
| `claudeUsage.colorEnabled` | `true` | Tint the indicator by usage. |
| `claudeUsage.warnThreshold` | `75` | Percent at which it turns to the warn color. |
| `claudeUsage.critThreshold` | `90` | Percent at which it turns to the critical color. |
| `claudeUsage.normalColor` | _theme_ | Custom hex for normal usage. |
| `claudeUsage.warnColor` | _theme_ | Custom hex for the warn level. |
| `claudeUsage.critColor` | _theme_ | Custom hex for the critical level. |
| `claudeUsage.updateInterval` | `300` | How often to poll for usage, in seconds. |
| `claudeUsage.showNotifications` | `false` | Get pinged when any window hits 90%. |

## Install

From the VS Code Marketplace: search **Claude Usage Bars**, or:

```
code --install-extension mtglitch.claude-usage-bars
```

## Authentication

The extension reads your existing Claude Code credentials — no separate login.

- **macOS:** reads the OAuth token from your system Keychain (added by Claude Code on login).
- **Linux:** reads from `~/.claude/.credentials.json`.

User info (name, email, subscription type) comes from `~/.claude.json`. If the status bar shows an auth error, re-run `claude` in your terminal to refresh your credentials, then reload the VS Code window.

## Requirements

VS Code 1.74.0+ and an active Claude Code subscription.

## Credits

Forked from [`jjsmackay/claude-usage-vscode`](https://github.com/jjsmackay/claude-usage-vscode) by [Jonathan Mackay](https://github.com/jjsmackay). Maintained and extended by [mtglitch](https://github.com/EloWeld).

## License

MIT
