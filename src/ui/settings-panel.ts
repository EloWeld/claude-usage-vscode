import * as vscode from 'vscode'
import { ClaudeUsage } from '../types'
import {
  renderGallery,
  renderStatusText,
  renderSamples,
  previewLevel,
  peakPercent,
  isBarStyle,
  StyleId,
  DisplayWindow,
  ColorConfig,
} from './styles'
import { refreshStatusBar, getLastUsage } from './status-bar'
import { getHistory, computeBurn } from '../services/history'
import { formatResetTime } from '../utils/time-formatter'

export type PanelTab = 'usage' | 'settings'

/**
 * Representative usage used for the live preview when no real data has been
 * fetched yet, so the selected style renders something meaningful.
 */
const SAMPLE_USAGE: ClaudeUsage = {
  five_hour: { utilization: 67, resets_at: null },
  seven_day: { utilization: 34, resets_at: null },
}

/** Fill levels shown in the multi-percent preview strip. */
const SAMPLE_PERCENTS = [15, 30, 40, 60, 80, 95]

const WINDOW_LABELS: Array<[keyof ClaudeUsage, string]> = [
  ['five_hour', 'Session (5h)'],
  ['seven_day', 'Weekly (7d)'],
  ['seven_day_opus', 'Opus (7d)'],
  ['seven_day_oauth_apps', 'Apps (7d)'],
]

interface PanelConfig {
  statusBarStyle: StyleId
  statusBarStyleWeekly: string
  statusBarDisplay: DisplayWindow
  statusBarIcon: string
  barLength: number
  colorEnabled: boolean
  warnThreshold: number
  critThreshold: number
  normalColor: string
  warnColor: string
  critColor: string
}

function readConfig(): PanelConfig {
  const c = vscode.workspace.getConfiguration('claudeUsage')
  return {
    statusBarStyle: c.get<StyleId>('statusBarStyle', 'vgauge'),
    statusBarStyleWeekly: c.get<string>('statusBarStyleWeekly', 'vmeter'),
    statusBarDisplay: c.get<DisplayWindow>('statusBarDisplay', 'both'),
    statusBarIcon: c.get<string>('statusBarIcon', '✼'),
    barLength: c.get<number>('barLength', 8),
    colorEnabled: c.get<boolean>('colorEnabled', true),
    warnThreshold: c.get<number>('warnThreshold', 75),
    critThreshold: c.get<number>('critThreshold', 90),
    normalColor: c.get<string>('normalColor', ''),
    warnColor: c.get<string>('warnColor', ''),
    critColor: c.get<string>('critColor', ''),
  }
}

/** Build the current-usage breakdown rows for the Usage tab. */
function buildWindows(usage: ClaudeUsage) {
  const out: Array<{ label: string; pct: number; resetText: string }> = []
  for (const [key, label] of WINDOW_LABELS) {
    const w = usage[key]
    if (!w) {
      continue
    }
    let resetText = ''
    if (w.resets_at) {
      const t = formatResetTime(w.resets_at)
      if (t !== 'Reset time passed') {
        resetText = t
      }
    }
    out.push({ label, pct: Math.round(w.utilization), resetText })
  }
  return out
}

function buildState(config: PanelConfig) {
  const usage = getLastUsage() ?? SAMPLE_USAGE
  const color: ColorConfig = {
    enabled: config.colorEnabled,
    warn: config.warnThreshold,
    crit: config.critThreshold,
    normalColor: config.normalColor,
    warnColor: config.warnColor,
    critColor: config.critColor,
  }

  // The gallery is intentionally fixed — changing bar length / colors must not
  // disturb the style picker thumbnails.
  const gallery = renderGallery()

  // The live preview and the sample strip DO reflect the current options.
  const live = {
    text: renderStatusText(usage, {
      style: config.statusBarStyle,
      display: config.statusBarDisplay,
      icon: config.statusBarIcon,
      barLength: config.barLength,
      styleWeekly:
        config.statusBarStyleWeekly === 'same'
          ? undefined
          : (config.statusBarStyleWeekly as StyleId),
    }),
    level: previewLevel(peakPercent(usage, config.statusBarDisplay), color),
  }
  const samples = renderSamples(
    config.statusBarStyle,
    { icon: config.statusBarIcon, barLength: config.barLength },
    SAMPLE_PERCENTS,
    color,
  )

  // Usage-tab data: history points, the current windows, and burn rate.
  const lastUsage = getLastUsage()
  const history = getHistory()
  const burn = computeBurn(history, lastUsage?.five_hour?.utilization ?? 0)

  return {
    config,
    gallery,
    live,
    samples,
    showWeeklyStyle: config.statusBarDisplay === 'both' && isBarStyle(config.statusBarStyle),
    colors: {
      enabled: config.colorEnabled,
      normal: config.normalColor,
      warn: config.warnColor,
      crit: config.critColor,
    },
    usingSample: lastUsage === undefined,
    usage: {
      points: history,
      nowMs: Date.now(),
      windows: lastUsage ? buildWindows(lastUsage) : [],
      burn,
    },
  }
}

/**
 * Singleton webview panel with two tabs: Usage (charts + breakdown) and
 * Settings (status bar appearance). Kept a single window so the status bar
 * click, the tooltip's Usage link, and its Settings link all land here.
 */
export class SettingsPanel {
  private static current: SettingsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly extensionUri: vscode.Uri
  private readonly disposables: vscode.Disposable[] = []
  private pendingTab: PanelTab

  static show(extensionUri: vscode.Uri, tab: PanelTab = 'usage') {
    const column = vscode.window.activeTextEditor?.viewColumn

    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(column)
      SettingsPanel.current.panel.webview.postMessage({ type: 'setTab', tab })
      SettingsPanel.current.postState()
      return
    }

    const codiconRoot = vscode.Uri.joinPath(
      extensionUri,
      'node_modules',
      '@vscode',
      'codicons',
      'dist',
    )
    const panel = vscode.window.createWebviewPanel(
      'claudeUsageSettings',
      'Claude Usage Bars',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [codiconRoot],
      },
    )

    SettingsPanel.current = new SettingsPanel(panel, extensionUri, tab)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tab: PanelTab,
  ) {
    this.panel = panel
    this.extensionUri = extensionUri
    this.pendingTab = tab
    this.panel.webview.html = this.getHtml()

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    this.panel.webview.onDidReceiveMessage(
      (message: { type: string; key?: keyof PanelConfig; value?: unknown }) => {
        if (message.type === 'ready') {
          this.postState()
          this.panel.webview.postMessage({ type: 'setTab', tab: this.pendingTab })
          return
        }
        if (message.type === 'set' && message.key !== undefined) {
          void this.applySetting(message.key, message.value)
        }
      },
      null,
      this.disposables,
    )

    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('claudeUsage')) {
          this.postState()
        }
      },
      null,
      this.disposables,
    )
  }

  private async applySetting(key: keyof PanelConfig, value: unknown) {
    const config = vscode.workspace.getConfiguration('claudeUsage')
    await config.update(key, value, vscode.ConfigurationTarget.Global)
    refreshStatusBar()
    this.postState()
  }

  private postState() {
    this.panel.webview.postMessage({ type: 'state', ...buildState(readConfig()) })
  }

  private dispose() {
    SettingsPanel.current = undefined
    this.panel.dispose()
    while (this.disposables.length) {
      this.disposables.pop()?.dispose()
    }
  }

  private getHtml(): string {
    const nonce = makeNonce()
    const webview = this.panel.webview
    const codiconCss = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'node_modules',
        '@vscode',
        'codicons',
        'dist',
        'codicon.css',
      ),
    )
    const csp =
      `default-src 'none'; ` +
      `style-src 'unsafe-inline' ${webview.cspSource}; ` +
      `font-src ${webview.cspSource}; ` +
      `script-src 'nonce-${nonce}';`
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${codiconCss}" rel="stylesheet" />
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 0 20px 48px;
    font-size: 13px;
  }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .section { margin-top: 24px; }
  .section > label { display: block; font-weight: 600; margin-bottom: 8px; }
  /* Tabs */
  .tabs {
    position: sticky; top: 0; z-index: 1;
    display: flex; gap: 4px;
    padding: 12px 0 0;
    margin-bottom: 4px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .tab {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-descriptionForeground);
    font-size: 13px; font-family: inherit;
    padding: 8px 14px; border-bottom: 2px solid transparent;
  }
  .tab:hover { color: var(--vscode-foreground); }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .pane { display: none; }
  /* Bars use the SAME font as the status bar (UI font) for true WYSIWYG. */
  .barfont { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); }
  .barfont .codicon { vertical-align: middle; font-size: 14px; line-height: 1; }
  #weeklyStyleRow { display: contents; }
  #weeklyStyleRow.hidden { display: none; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 10px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; cursor: pointer; background: var(--vscode-editorWidget-background); transition: border-color .1s; overflow: hidden; }
  .card:hover { border-color: var(--vscode-focusBorder); }
  .card.selected { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); }
  .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  .card .group { float: right; font-size: 10px; opacity: .6; }
  .card .preview { white-space: nowrap; overflow-x: auto; max-width: 100%; }
  .livebar { margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: var(--vscode-statusBar-background, #007acc); color: var(--vscode-statusBar-foreground, #fff); white-space: nowrap; overflow-x: auto; max-width: 100%; box-sizing: border-box; }
  .seg + .seg { margin-left: 4px; }
  .samples { display: flex; flex-wrap: wrap; gap: 8px; }
  .sample { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 6px 10px; background: var(--vscode-editorWidget-background); max-width: 100%; box-sizing: border-box; }
  .sample .pct { font-size: 10px; color: var(--vscode-descriptionForeground); display: block; margin-bottom: 3px; }
  .sample .val { white-space: nowrap; overflow-x: auto; max-width: 280px; }
  .controls { display: grid; grid-template-columns: max-content 1fr; gap: 12px 16px; align-items: center; max-width: 480px; }
  .controls label { font-weight: 500; }
  input[type="text"], input[type="number"], select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 4px 8px; font-family: inherit; font-size: 13px; width: 100%; box-sizing: border-box; }
  input[type="range"] { width: 100%; }
  input[type="color"] { width: 36px; height: 26px; padding: 0; border: 1px solid var(--vscode-input-border, transparent); background: none; border-radius: 4px; cursor: pointer; }
  .row { display: flex; align-items: center; gap: 8px; }
  .reset { cursor: pointer; font-size: 11px; color: var(--vscode-textLink-foreground); background: none; border: none; padding: 0; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  /* Usage tab */
  .usage-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .usage-head label { font-weight: 600; }
  .rangetabs { display: flex; gap: 4px; }
  .rangebtn { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); border: none; border-radius: 4px; padding: 3px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
  .rangebtn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .chart { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; background: var(--vscode-editorWidget-background); }
  .legend { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
  .legend span { font-size: 13px; }
  .breakdown { display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
  .bdrow { display: grid; grid-template-columns: 110px 1fr 42px auto; gap: 10px; align-items: center; }
  .bdlabel { font-weight: 500; }
  .bdbar { height: 8px; border-radius: 4px; background: var(--vscode-panel-border); overflow: hidden; }
  .bdfill { display: block; height: 100%; background: var(--vscode-charts-blue, #4ea1ff); }
  .bdpct { text-align: right; font-variant-numeric: tabular-nums; }
  .bdreset { font-size: 11px; }
</style>
</head>
<body>
  <div class="tabs">
    <button class="tab" data-tab="usage" id="tabBtn-usage">Usage</button>
    <button class="tab" data-tab="settings" id="tabBtn-settings">Settings</button>
  </div>

  <!-- USAGE TAB -->
  <div class="pane" id="pane-usage">
    <div class="section">
      <div class="usage-head">
        <label>Usage over time</label>
        <div class="rangetabs">
          <button class="rangebtn" data-range="day" id="rangeBtn-day">Day</button>
          <button class="rangebtn" data-range="week" id="rangeBtn-week">Week</button>
        </div>
      </div>
      <div id="chart" class="chart"></div>
      <div id="burnsummary" class="muted" style="margin-top:8px"></div>
    </div>
    <div class="section">
      <label>Current usage</label>
      <div id="breakdown" class="breakdown"></div>
    </div>
  </div>

  <!-- SETTINGS TAB -->
  <div class="pane" id="pane-settings">
    <div class="muted" id="datasource" style="margin-top:12px">Live preview</div>

    <div class="section">
      <label>Style <span class="pill" id="selectedLabel"></span></label>
      <div class="gallery" id="gallery"></div>
    </div>

    <div class="section">
      <label>Current status bar preview</label>
      <div class="livebar barfont" id="livebar"></div>
    </div>

    <div class="section">
      <label>Selected style at different usage levels</label>
      <div class="samples" id="samples"></div>
    </div>

    <div class="section">
      <label>Options</label>
      <div class="controls">
        <label for="display">Window</label>
        <select id="display">
          <option value="both">Session · Weekly</option>
          <option value="session">Session (5h)</option>
          <option value="weekly">Weekly (7d)</option>
          <option value="highest">Highest</option>
        </select>

        <label for="icon">Icon</label>
        <input type="text" id="icon" maxlength="4" placeholder="(none)" />

        <label for="barLength">Bar length</label>
        <div class="row">
          <input type="range" id="barLength" min="4" max="40" step="1" />
          <span id="barLengthVal" class="muted"></span>
        </div>

        <span id="weeklyStyleRow" class="hidden">
          <label for="weeklyStyle">Weekly bar style</label>
          <select id="weeklyStyle"></select>
        </span>
      </div>
    </div>

    <div class="section">
      <label>Colors</label>
      <div class="controls">
        <label for="colorEnabled">Color by usage</label>
        <div class="row"><input type="checkbox" id="colorEnabled" /></div>

        <label for="warnThreshold">Warn at %</label>
        <input type="number" id="warnThreshold" min="0" max="100" />

        <label for="critThreshold">Critical at %</label>
        <input type="number" id="critThreshold" min="0" max="100" />

        <label for="normalColor">Normal color</label>
        <div class="row">
          <input type="color" id="normalColor" />
          <button class="reset" data-reset="normalColor">use theme default</button>
        </div>

        <label for="warnColor">Warn color</label>
        <div class="row">
          <input type="color" id="warnColor" />
          <button class="reset" data-reset="warnColor">use theme default</button>
        </div>

        <label for="critColor">Critical color</label>
        <div class="row">
          <input type="color" id="critColor" />
          <button class="reset" data-reset="critColor">use theme default</button>
        </div>
      </div>
    </div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let state = null;
  let currentTab = 'usage';
  let usageRange = 'day';

  function set(key, value) {
    vscode.postMessage({ type: 'set', key, value });
  }

  function colorFor(level) {
    const c = state.colors;
    if (!level || !c.enabled) return '';
    if (level === 'crit') return c.crit || 'var(--vscode-errorForeground)';
    if (level === 'warn') return c.warn || 'var(--vscode-editorWarning-foreground)';
    return c.normal || '';
  }

  function setRich(el, text) {
    el.textContent = '';
    const re = /\\$\\(([a-z0-9-]+)\\)/gi;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const i = document.createElement('i');
      i.className = 'codicon codicon-' + m[1];
      el.appendChild(i);
      last = re.lastIndex;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  // ---- Tabs ----
  function applyTab() {
    ['usage', 'settings'].forEach(function (t) {
      const pane = $('pane-' + t); if (pane) pane.style.display = (t === currentTab ? 'block' : 'none');
      const btn = $('tabBtn-' + t); if (btn) btn.className = 'tab' + (t === currentTab ? ' active' : '');
    });
  }
  ['usage', 'settings'].forEach(function (t) {
    const b = $('tabBtn-' + t); if (b) b.onclick = function () { currentTab = t; applyTab(); };
  });

  // ---- Usage chart ----
  function fmtDur(min) { if (min < 60) return min + 'm'; const h = Math.floor(min / 60), m = min % 60; return m ? h + 'h ' + m + 'm' : h + 'h'; }
  function fmtTime(t, mode) {
    const d = new Date(t);
    if (mode === 'week') return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    return ('' + d.getHours()).padStart(2, '0') + ':' + ('' + d.getMinutes()).padStart(2, '0');
  }

  function buildChartSvg(points, nowMs, rangeMs, mode) {
    const W = 620, H = 190, padL = 28, padR = 10, padT = 10, padB = 22;
    const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
    const minT = nowMs - rangeMs;
    const pts = (points || []).filter(function (p) { return p.t >= minT; });
    if (pts.length < 2) {
      return '<div class="muted">Collecting usage data… the chart fills in as the extension runs (currently ' + pts.length + ' point' + (pts.length === 1 ? '' : 's') + ' in range).</div>';
    }
    const sx = function (t) { return x0 + (t - minT) / (nowMs - minT) * (x1 - x0); };
    const sy = function (v) { const c = Math.max(0, Math.min(100, v)); return y0 - c / 100 * (y0 - y1); };
    let grid = '';
    [0, 25, 50, 75, 100].forEach(function (g) {
      const y = sy(g);
      grid += '<line x1="' + x0 + '" y1="' + y + '" x2="' + x1 + '" y2="' + y + '" stroke="var(--vscode-charts-lines, #8884)" stroke-width="1" />';
      grid += '<text x="' + (x0 - 4) + '" y="' + (y + 3) + '" text-anchor="end" font-size="9" fill="var(--vscode-descriptionForeground)">' + g + '</text>';
    });
    let xt = '';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const t = minT + (nowMs - minT) * i / ticks;
      xt += '<text x="' + sx(t) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" fill="var(--vscode-descriptionForeground)">' + fmtTime(t, mode) + '</text>';
    }
    const poly = function (key, color) {
      let d = '';
      pts.forEach(function (p) { d += (d ? ' ' : '') + sx(p.t).toFixed(1) + ',' + sy(p[key]).toFixed(1); });
      return '<polyline points="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5" />';
    };
    const sc = 'var(--vscode-charts-blue, #4ea1ff)';
    const wc = 'var(--vscode-charts-orange, #ff9f4e)';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:680px;height:auto">' +
      grid + xt + poly('s', sc) + poly('w', wc) + '</svg>' +
      '<div class="legend"><span style="color:' + sc + '">■</span> Session &nbsp; <span style="color:' + wc + '">■</span> Weekly</div>';
  }

  function renderUsage() {
    if (!state) return;
    const u = state.usage || { points: [], nowMs: 0, windows: [], burn: null };
    ['day', 'week'].forEach(function (r) { const b = $('rangeBtn-' + r); if (b) b.className = 'rangebtn' + (usageRange === r ? ' active' : ''); });
    const rangeMs = usageRange === 'week' ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
    $('chart').innerHTML = buildChartSvg(u.points, u.nowMs, rangeMs, usageRange);

    let bs = '';
    if (u.burn) {
      const r = u.burn.sessionRatePerHour;
      if (r > 0.1) { bs = 'Burning ' + r.toFixed(1) + '%/h (session)'; if (u.burn.sessionEtaMinutes != null) bs += ' · ~' + fmtDur(u.burn.sessionEtaMinutes) + ' to 100%'; }
      else if (r < -0.1) bs = 'Session recovering (window reset)';
      else bs = 'Session steady';
      if (u.burn.weeklyRatePerHour > 0.05) bs += ' · weekly +' + u.burn.weeklyRatePerHour.toFixed(1) + '%/h';
    } else bs = 'Not enough data yet for a burn rate.';
    $('burnsummary').textContent = bs;

    const bd = $('breakdown');
    bd.innerHTML = '';
    if (!u.windows.length) { bd.innerHTML = '<div class="muted">No usage data fetched yet.</div>'; }
    u.windows.forEach(function (w) {
      const row = document.createElement('div');
      row.className = 'bdrow';
      row.innerHTML =
        '<span class="bdlabel">' + w.label + '</span>' +
        '<span class="bdbar"><span class="bdfill" style="width:' + w.pct + '%"></span></span>' +
        '<span class="bdpct">' + w.pct + '%</span>' +
        '<span class="bdreset muted">' + (w.resetText ? 'resets ' + w.resetText : '') + '</span>';
      bd.appendChild(row);
    });
  }

  ['day', 'week'].forEach(function (r) {
    const b = $('rangeBtn-' + r); if (b) b.onclick = function () { usageRange = r; renderUsage(); };
  });

  // ---- Settings ----
  function renderSettings() {
    const { config, gallery, live, samples, usingSample } = state;
    $('datasource').textContent = usingSample
      ? 'Live preview — sample data (no usage fetched yet)'
      : 'Live preview — your current usage';

    const galleryEl = $('gallery');
    galleryEl.innerHTML = '';
    for (const p of gallery) {
      const card = document.createElement('div');
      card.className = 'card' + (p.id === config.statusBarStyle ? ' selected' : '');
      card.onclick = () => set('statusBarStyle', p.id);
      card.innerHTML = '<div class="label">' + p.label + '<span class="group">' + p.group + '</span></div><div class="preview barfont"></div>';
      setRich(card.querySelector('.preview'), p.text);
      galleryEl.appendChild(card);
    }
    const selectedMeta = gallery.find((p) => p.id === config.statusBarStyle);
    $('selectedLabel').textContent = selectedMeta ? selectedMeta.label : config.statusBarStyle;

    const livebar = $('livebar');
    setRich(livebar, live.text);
    livebar.style.color = colorFor(live.level) || 'var(--vscode-statusBar-foreground)';

    const strip = $('samples');
    strip.innerHTML = '';
    for (const s of samples) {
      const el = document.createElement('div');
      el.className = 'sample';
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = s.percent + '%';
      const val = document.createElement('span');
      val.className = 'val barfont';
      setRich(val, s.text);
      val.style.color = colorFor(s.level);
      el.appendChild(pct);
      el.appendChild(val);
      strip.appendChild(el);
    }

    const weeklyRow = $('weeklyStyleRow');
    const weeklySel = $('weeklyStyle');
    if (weeklySel.options.length === 0) {
      const sameOpt = document.createElement('option');
      sameOpt.value = 'same'; sameOpt.textContent = 'Same as main';
      weeklySel.appendChild(sameOpt);
      for (const p of gallery) {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.label;
        weeklySel.appendChild(opt);
      }
    }
    weeklySel.value = config.statusBarStyleWeekly;
    weeklyRow.className = state.showWeeklyStyle ? '' : 'hidden';

    $('display').value = config.statusBarDisplay;
    $('icon').value = config.statusBarIcon;
    $('barLength').value = config.barLength;
    $('barLengthVal').textContent = config.barLength;
    $('colorEnabled').checked = config.colorEnabled;
    $('warnThreshold').value = config.warnThreshold;
    $('critThreshold').value = config.critThreshold;
    $('normalColor').value = config.normalColor || '#cccccc';
    $('warnColor').value = config.warnColor || '#e5c07b';
    $('critColor').value = config.critColor || '#e06c75';
  }

  function render() {
    if (!state) return;
    renderSettings();
    renderUsage();
    applyTab();
  }

  $('display').onchange = (e) => set('statusBarDisplay', e.target.value);
  $('weeklyStyle').onchange = (e) => set('statusBarStyleWeekly', e.target.value);
  $('icon').oninput = (e) => set('statusBarIcon', e.target.value);
  $('barLength').oninput = (e) => { $('barLengthVal').textContent = e.target.value; set('barLength', Number(e.target.value)); };
  $('colorEnabled').onchange = (e) => set('colorEnabled', e.target.checked);
  $('warnThreshold').onchange = (e) => set('warnThreshold', Number(e.target.value));
  $('critThreshold').onchange = (e) => set('critThreshold', Number(e.target.value));
  $('normalColor').oninput = (e) => set('normalColor', e.target.value);
  $('warnColor').oninput = (e) => set('warnColor', e.target.value);
  $('critColor').oninput = (e) => set('critColor', e.target.value);
  for (const btn of document.querySelectorAll('.reset')) {
    btn.onclick = () => set(btn.getAttribute('data-reset'), '');
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'setTab') { currentTab = msg.tab; applyTab(); return; }
    state = msg;
    render();
  });

  applyTab();
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let text = ''
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
