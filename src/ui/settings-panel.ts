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

  return {
    config,
    gallery,
    live,
    samples,
    // Whether the weekly-style selector is relevant right now.
    showWeeklyStyle: config.statusBarDisplay === 'both' && isBarStyle(config.statusBarStyle),
    colors: {
      enabled: config.colorEnabled,
      normal: config.normalColor,
      warn: config.warnColor,
      crit: config.critColor,
    },
    usingSample: getLastUsage() === undefined,
  }
}

/**
 * Singleton webview panel that lets the user configure the status bar
 * appearance with a live preview of every style.
 */
export class SettingsPanel {
  private static current: SettingsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly extensionUri: vscode.Uri
  private readonly disposables: vscode.Disposable[] = []

  static show(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor?.viewColumn

    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(column)
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
      'Claude Status Bar Settings',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [codiconRoot],
      },
    )

    SettingsPanel.current = new SettingsPanel(panel, extensionUri)
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel
    this.extensionUri = extensionUri
    this.panel.webview.html = this.getHtml()

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    this.panel.webview.onDidReceiveMessage(
      (message: { type: string; key?: keyof PanelConfig; value?: unknown }) => {
        if (message.type === 'ready') {
          this.postState()
          return
        }
        if (message.type === 'set' && message.key !== undefined) {
          void this.applySetting(message.key, message.value)
        }
      },
      null,
      this.disposables,
    )

    // Keep the panel in sync if settings change from elsewhere.
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
    this.panel.webview.postMessage(buildState(readConfig()))
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
    padding: 16px 20px 48px;
    font-size: 13px;
  }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .section { margin-top: 24px; }
  .section > label { display: block; font-weight: 600; margin-bottom: 8px; }
  /* Bars use the SAME font as the status bar (the UI font, not the editor
     monospace font) so the preview matches what actually renders. */
  .barfont {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
  }
  .barfont .codicon { vertical-align: middle; font-size: 14px; line-height: 1; }
  #weeklyStyleRow { display: contents; }
  #weeklyStyleRow.hidden { display: none; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px 12px;
    cursor: pointer;
    background: var(--vscode-editorWidget-background);
    transition: border-color .1s;
    overflow: hidden;
  }
  .card:hover { border-color: var(--vscode-focusBorder); }
  .card.selected {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
  }
  .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  .card .group { float: right; font-size: 10px; opacity: .6; }
  .card .preview { white-space: nowrap; overflow-x: auto; max-width: 100%; }
  .livebar {
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--vscode-statusBar-background, #007acc);
    color: var(--vscode-statusBar-foreground, #fff);
    white-space: nowrap;
    overflow-x: auto;
    max-width: 100%;
    box-sizing: border-box;
  }
  .seg + .seg { margin-left: 4px; }
  .samples { display: flex; flex-wrap: wrap; gap: 8px; }
  .sample {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 6px 10px;
    background: var(--vscode-editorWidget-background);
    max-width: 100%;
    box-sizing: border-box;
  }
  .sample .pct { font-size: 10px; color: var(--vscode-descriptionForeground); display: block; margin-bottom: 3px; }
  .sample .val { white-space: nowrap; overflow-x: auto; max-width: 280px; }
  .controls { display: grid; grid-template-columns: max-content 1fr; gap: 12px 16px; align-items: center; max-width: 480px; }
  .controls label { font-weight: 500; }
  input[type="text"], input[type="number"], select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: inherit;
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;
  }
  input[type="range"] { width: 100%; }
  input[type="color"] { width: 36px; height: 26px; padding: 0; border: 1px solid var(--vscode-input-border, transparent); background: none; border-radius: 4px; cursor: pointer; }
  .row { display: flex; align-items: center; gap: 8px; }
  .reset { cursor: pointer; font-size: 11px; color: var(--vscode-textLink-foreground); background: none; border: none; padding: 0; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
</style>
</head>
<body>
  <h2>Claude Status Bar — Appearance</h2>
  <div class="muted" id="datasource">Live preview</div>

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

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let state = null;

  function set(key, value) {
    vscode.postMessage({ type: 'set', key, value });
  }

  // Resolve the CSS color for a usage level, honoring custom colors and the
  // global color toggle. Returns '' (inherit) when uncolored.
  function colorFor(level) {
    const c = state.colors;
    if (!level || !c.enabled) return '';
    if (level === 'crit') return c.crit || 'var(--vscode-errorForeground)';
    if (level === 'warn') return c.warn || 'var(--vscode-editorWarning-foreground)';
    return c.normal || '';
  }

  // Render a string into an element, converting $(codicon-name) tokens into
  // codicon <i> elements so the preview matches the status bar.
  function setRich(el, text) {
    el.textContent = '';
    const re = /\\$\\(([a-z0-9-]+)\\)/gi;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        el.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const i = document.createElement('i');
      i.className = 'codicon codicon-' + m[1];
      el.appendChild(i);
      last = re.lastIndex;
    }
    if (last < text.length) {
      el.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  function render() {
    if (!state) return;
    const { config, gallery, live, samples, usingSample } = state;
    $('datasource').textContent = usingSample
      ? 'Live preview — sample data (no usage fetched yet)'
      : 'Live preview — your current usage';

    // Gallery (fixed thumbnails, no color)
    const galleryEl = $('gallery');
    galleryEl.innerHTML = '';
    for (const p of gallery) {
      const card = document.createElement('div');
      card.className = 'card' + (p.id === config.statusBarStyle ? ' selected' : '');
      card.onclick = () => set('statusBarStyle', p.id);
      card.innerHTML =
        '<div class="label">' + p.label +
        '<span class="group">' + p.group + '</span></div>' +
        '<div class="preview barfont"></div>';
      setRich(card.querySelector('.preview'), p.text);
      galleryEl.appendChild(card);
    }

    const selectedMeta = gallery.find((p) => p.id === config.statusBarStyle);
    $('selectedLabel').textContent = selectedMeta ? selectedMeta.label : config.statusBarStyle;

    // Live preview (current options + colors, whole-item color)
    const livebar = $('livebar');
    setRich(livebar, live.text);
    livebar.style.color = colorFor(live.level) || 'var(--vscode-statusBar-foreground)';

    // Multi-percent samples
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

    // Weekly bar style selector (only relevant in "both" with a bar style)
    const weeklyRow = $('weeklyStyleRow');
    const weeklySel = $('weeklyStyle');
    if (weeklySel.options.length === 0) {
      const sameOpt = document.createElement('option');
      sameOpt.value = 'same';
      sameOpt.textContent = 'Same as main';
      weeklySel.appendChild(sameOpt);
      for (const p of gallery) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label;
        weeklySel.appendChild(opt);
      }
    }
    weeklySel.value = config.statusBarStyleWeekly;
    weeklyRow.className = state.showWeeklyStyle ? '' : 'hidden';

    // Controls
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

  $('display').onchange = (e) => set('statusBarDisplay', e.target.value);
  $('weeklyStyle').onchange = (e) => set('statusBarStyleWeekly', e.target.value);
  $('icon').oninput = (e) => set('statusBarIcon', e.target.value);
  $('barLength').oninput = (e) => {
    $('barLengthVal').textContent = e.target.value;
    set('barLength', Number(e.target.value));
  };
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
    state = event.data;
    render();
  });

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
