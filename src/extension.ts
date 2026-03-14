import * as vscode from 'vscode';

type RageMode = 'normal' | 'cat' | 'zen' | 'chaos';

interface RageStats {
  events: Array<{ timestamp: number; fileName: string }>;
  fileCounts: Record<string, number>;
  longestSessionMs: number;
  currentSessionStart?: number;
  lastEventTimestamp?: number;
  achievementShown: boolean;
}

const STATS_KEY = 'rageDetector.stats';

let lockUntil = 0;
let lastLockToast = 0;
let lastReactionAt = 0;
let statusBar: vscode.StatusBarItem;
let stats: RageStats;
let recentKeystrokes: number[] = [];
let emergencyBurstTimestamps: number[] = [];
let globalTypedChunks: Array<{ text: string; timestamp: number }> = [];
const handledTerminalExecutions = new WeakSet<vscode.TerminalShellExecution>();
const REACTION_COOLDOWN_MS = 2000;

const funnyAdvice = [
  'Have you tried turning the bug off and on again?',
  'Maybe the semicolon is just shy.',
  'Stack Overflow believes in you.',
  'Print the variable. Then print your feelings.',
  'If it compiles, celebrate quietly.'
];

const catGifs = [
  'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
  'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif',
  'https://media.giphy.com/media/v6aOjy0Qo1fIA/giphy.gif'
];

export function activate(context: vscode.ExtensionContext): void {
  stats = loadStats(context);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'rageDetector.showStats';
  context.subscriptions.push(statusBar);
  updateStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand('rageDetector.showStats', () => showStatsPanel(context)),
    vscode.commands.registerCommand('rageDetector.showSurvivalMode', () => showSurvivalModePanel()),
    vscode.commands.registerCommand('rageDetector.triggerRage', async () => {
      await handleDetectedRage(context, getLikelyInputSurface());
    }),
    vscode.commands.registerCommand(
      'rageDetector.reportExternalInput',
      async (payload?: { text?: string; source?: string }) => {
        const text = payload?.text ?? '';
        const source = payload?.source?.trim() || 'external-input';
        if (text && !isKeyboardSmash(text, 0)) {
          vscode.window.showInformationMessage('No keyboard smash detected in external input.');
          return;
        }
        await handleDetectedRage(context, source);
      }
    ),
    vscode.commands.registerCommand('rageDetector.resetStats', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Reset all keyboard rage statistics?',
        { modal: true },
        'Reset'
      );
      if (choice === 'Reset') {
        stats = createEmptyStats();
        saveStats(context);
        updateStatusBar();
        vscode.window.showInformationMessage('Rage statistics reset. Inner peace restored.');
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (!event.contentChanges.length) {
        return;
      }

      const now = Date.now();
      for (const change of event.contentChanges) {
        const inserted = change.text;
        if (!inserted) {
          continue;
        }

        checkEasterEgg(inserted);

        if (isSingleCharacterInput(inserted)) {
          recentKeystrokes.push(now);
        }
      }

      recentKeystrokes = recentKeystrokes.filter((t) => now - t <= 2500);

      const smashingChange = event.contentChanges.find((change) => {
        return isKeyboardSmash(change.text, recentKeystrokes.length);
      });

      if (!smashingChange) {
        return;
      }

      const fileName = vscode.workspace.asRelativePath(event.document.uri, false);
      await handleDetectedRage(context, fileName, now);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument(async (event) => {
      for (const change of event.contentChanges) {
        for (const cell of change.addedCells) {
          const text = cell.document.getText();
          if (isKeyboardSmash(text, 0)) {
            const source = vscode.workspace.asRelativePath(event.notebook.uri, false) + ':notebook-cell';
            await handleDetectedRage(context, source);
            return;
          }
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution(async (event) => {
      await processTerminalExecution(context, event);
    }),
    vscode.window.onDidEndTerminalShellExecution(async (event) => {
      await processTerminalExecution(context, event);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('type', async (args: { text: string }) => {
      const now = Date.now();

      if (args?.text) {
        recordGlobalTyping(args.text, now);
        checkEasterEgg(args.text);

        const burst = getRecentTypedBurst(now);
        if (burst && isKeyboardSmash(burst, getRecentGlobalTypingCount(now))) {
          await handleDetectedRage(context, getLikelyInputSurface(), now);
        }
      }

      if (now < lockUntil) {
        if (now - lastLockToast > 1000) {
          lastLockToast = now;
          vscode.window.setStatusBarMessage('Cooling down developer… Please wait.', 1200);
        }
        return;
      }
      await vscode.commands.executeCommand('default:type', args);
    })
  );
}

export function deactivate(): void {}

function createEmptyStats(): RageStats {
  return {
    events: [],
    fileCounts: {},
    longestSessionMs: 0,
    achievementShown: false
  };
}

function loadStats(context: vscode.ExtensionContext): RageStats {
  const stored = context.globalState.get<RageStats>(STATS_KEY);
  if (!stored) {
    return createEmptyStats();
  }

  return {
    events: Array.isArray(stored.events) ? stored.events : [],
    fileCounts: stored.fileCounts ?? {},
    longestSessionMs: stored.longestSessionMs ?? 0,
    currentSessionStart: stored.currentSessionStart,
    lastEventTimestamp: stored.lastEventTimestamp,
    achievementShown: stored.achievementShown ?? false
  };
}

function saveStats(context: vscode.ExtensionContext): void {
  void context.globalState.update(STATS_KEY, stats);
}

function checkEasterEgg(text: string): void {
  if (text.toLowerCase().includes('sudo fix my life')) {
    vscode.window.showErrorMessage('Permission denied.');
  }
}

function recordGlobalTyping(text: string, timestamp: number): void {
  if (!text.trim()) {
    return;
  }

  globalTypedChunks.push({ text, timestamp });
  globalTypedChunks = globalTypedChunks.filter((entry) => timestamp - entry.timestamp <= 3000);
}

function getRecentTypedBurst(timestamp: number): string {
  const burst = globalTypedChunks
    .filter((entry) => timestamp - entry.timestamp <= 2500)
    .map((entry) => entry.text)
    .join('')
    .trim();

  return burst.slice(-40);
}

function getRecentGlobalTypingCount(timestamp: number): number {
  return globalTypedChunks.filter((entry) => timestamp - entry.timestamp <= 2500).length;
}

function isSingleCharacterInput(text: string): boolean {
  return text.length === 1 && text !== ' ' && text !== '\n' && text !== '\t';
}

function isKeyboardSmash(text: string, recentSpeedCount: number): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return false;
  }

  return lines.some((line) => isSmashLine(line, recentSpeedCount));
}

function isSmashLine(line: string, recentSpeedCount: number): boolean {
  if (line.length < 5) {
    return false;
  }

  if (/^(.)\1{4,}$/.test(line)) {
    return true;
  }

  const lower = line.toLowerCase();
  const obviousPatterns = [
    'asdfgh',
    'qwerty',
    'zxcvbn',
    ';;;;;',
    '/////',
    'aaaaaa',
    'sdfghj',
    'lkjhg'
  ];

  if (obviousPatterns.some((p) => lower.includes(p))) {
    return true;
  }

  if (/^[asdfghjkl;qwertyuiopzxcvbnm,./]{6,}$/i.test(line)) {
    return true;
  }

  if (/^[;:/\\|.,'"\[\]{}()+=_-]{5,}$/.test(line)) {
    return true;
  }

  if (/^[a-z]{7,}$/i.test(line)) {
    const vowels = (line.match(/[aeiou]/gi) ?? []).length;
    const vowelRatio = vowels / line.length;
    const uniqueChars = new Set(lower.split('')).size;
    const looksRandom = vowelRatio < 0.22 && uniqueChars >= 3 && uniqueChars <= 10;
    if (looksRandom) {
      return true;
    }
  }

  if (recentSpeedCount >= 12 && /^[a-z;:/\\|.,'"\[\]{}()+=_-]{3,}$/i.test(line)) {
    return true;
  }

  return false;
}

function registerRageEvent(fileName: string, timestamp: number): void {
  stats.events.push({ timestamp, fileName });
  stats.fileCounts[fileName] = (stats.fileCounts[fileName] ?? 0) + 1;

  const previous = stats.lastEventTimestamp;
  if (!previous || timestamp - previous > 45000) {
    stats.currentSessionStart = timestamp;
  }

  stats.lastEventTimestamp = timestamp;
  if (stats.currentSessionStart) {
    stats.longestSessionMs = Math.max(stats.longestSessionMs, timestamp - stats.currentSessionStart);
  }

  emergencyBurstTimestamps.push(timestamp);
  emergencyBurstTimestamps = emergencyBurstTimestamps.filter((t) => timestamp - t <= 120000);

  if (!stats.achievementShown && stats.events.length >= 10) {
    stats.achievementShown = true;
    void vscode.window.showInformationMessage('Achievement unlocked: Senior Developer');
  }
}

async function handleDetectedRage(
  context: vscode.ExtensionContext,
  sourceLabel: string,
  timestamp = Date.now()
): Promise<void> {
  if (timestamp - lastReactionAt < REACTION_COOLDOWN_MS) {
    return;
  }

  lastReactionAt = timestamp;
  registerRageEvent(sourceLabel, timestamp);
  saveStats(context);
  updateStatusBar();
  await reactToRage(context, sourceLabel);
}

async function processTerminalExecution(
  context: vscode.ExtensionContext,
  event: vscode.TerminalShellExecutionStartEvent | vscode.TerminalShellExecutionEndEvent
): Promise<void> {
  const config = vscode.workspace.getConfiguration('rageDetector');
  const enableTerminalDetection = config.get<boolean>('enableTerminalDetection', true);
  if (!enableTerminalDetection) {
    return;
  }

  const execution = event.execution;
  if (handledTerminalExecutions.has(execution)) {
    return;
  }

  const commandLine = execution.commandLine.value.trim();
  if (!commandLine) {
    return;
  }

  checkEasterEgg(commandLine);

  if (!isKeyboardSmash(commandLine, 0)) {
    return;
  }

  handledTerminalExecutions.add(execution);
  await handleDetectedRage(context, `terminal:${event.terminal.name}`);
}

function getLikelyInputSurface(): string {
  if (vscode.window.activeTextEditor) {
    const uri = vscode.window.activeTextEditor.document.uri;
    return vscode.workspace.asRelativePath(uri, false) || 'editor';
  }

  if (vscode.window.activeTerminal) {
    return `terminal:${vscode.window.activeTerminal.name}`;
  }

  return 'chat-or-input';
}

async function reactToRage(context: vscode.ExtensionContext, sourceLabel: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('rageDetector');
  const mode = config.get<RageMode>('mode', 'normal');
  const enableFunny = config.get<boolean>('enableFunnyAdvice', true);
  const enableLock = config.get<boolean>('enableTemporaryLock', true);
  const lockDurationMs = config.get<number>('lockDurationMs', 3000);

  await showCalmDownPopup();

  if (enableFunny) {
    const tip = funnyAdvice[Math.floor(Math.random() * funnyAdvice.length)];
    vscode.window.showInformationMessage(`${tip} [${sourceLabel}]`);
  }

  if (enableLock) {
    lockUntil = Math.max(lockUntil, Date.now() + Math.max(500, lockDurationMs));
    vscode.window.showWarningMessage('Cooling down developer… Please wait.');
  }

  if (mode === 'cat') {
    showCatTherapyPanel();
  } else if (mode === 'zen') {
    vscode.window.showInformationMessage('🔔 The bug is temporary. Your suffering is optional.');
  } else if (mode === 'chaos') {
    vscode.window.showWarningMessage('YES. LET THE DEBUGGING RAGE FLOW THROUGH YOU.');
  }

  if (emergencyBurstTimestamps.length >= 3) {
    showSurvivalModePanel();
  }

  saveStats(context);
}

async function showCalmDownPopup(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    '⚠️ Keyboard Smash Detected\n\nIt appears you are fighting the keyboard.\nTake a deep breath.\nThe bug cannot feel fear.',
    'I am calm now',
    'It deserved it'
  );

  if (choice === 'It deserved it') {
    vscode.window.showInformationMessage('Fair. Still, maybe hydrate and print variables.');
  }
}

function showCatTherapyPanel(): void {
  const panel = vscode.window.createWebviewPanel(
    'rageDetectorCatTherapy',
    'Cat Therapy Mode',
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );

  const gif = catGifs[Math.floor(Math.random() * catGifs.length)];
  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; color: #ddd; background: #1e1e1e; }
    h2 { margin-top: 0; }
    img { max-width: 100%; border-radius: 8px; }
  </style>
</head>
<body>
  <h2>🐱 Cat Therapy Mode</h2>
  <p>Take a breath. The cat has your back.</p>
  <img src="${gif}" alt="Cat therapy" />
</body>
</html>`;
}

function showSurvivalModePanel(): void {
  const panel = vscode.window.createWebviewPanel(
    'rageDetectorSurvivalMode',
    'Debug Survival Mode',
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; color: #ddd; background: #1e1e1e; }
    h1 { margin-top: 0; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <h1>🧯 Debug Survival Mode</h1>
  <ol>
    <li>Drink water</li>
    <li>Walk for 2 minutes</li>
    <li>Print variables</li>
    <li>Stop blaming JavaScript</li>
  </ol>
</body>
</html>`;
}

function showStatsPanel(context: vscode.ExtensionContext): void {
  const now = Date.now();
  const todayCount = stats.events.filter((e) => isSameDay(now, e.timestamp)).length;
  const weekCount = stats.events.filter((e) => now - e.timestamp <= 7 * 24 * 60 * 60 * 1000).length;

  const mostViolentFile = Object.entries(stats.fileCounts).sort((a, b) => b[1] - a[1])[0];
  const violentFileText = mostViolentFile ? `${mostViolentFile[0]} (${mostViolentFile[1]})` : 'N/A';

  const panel = vscode.window.createWebviewPanel(
    'rageDetectorStats',
    'Rage Statistics',
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; color: #ddd; background: #1e1e1e; line-height: 1.6; }
    h1 { margin-top: 0; }
    .card { border: 1px solid #444; border-radius: 8px; padding: 12px; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>📊 Rage Statistics</h1>
  <div class="card">Today's Keyboard Smashes: <strong>${todayCount}</strong></div>
  <div class="card">This Week's Smashes: <strong>${weekCount}</strong></div>
  <div class="card">Longest Rage Session: <strong>${formatMs(stats.longestSessionMs)}</strong></div>
  <div class="card">Most Violent Target: <strong>${escapeHtml(violentFileText)}</strong></div>
  <div class="card">Weekly Summary: You smashed the keyboard <strong>${weekCount}</strong> times this week. We recommend touching grass.</div>
</body>
</html>`;

  saveStats(context);
}

function updateStatusBar(): void {
  const now = Date.now();
  const todayCount = stats.events.filter((e) => isSameDay(now, e.timestamp)).length;
  statusBar.text = `$(flame) Rage: ${todayCount} today`;
  statusBar.tooltip = 'Keyboard Rage Detector statistics';
  statusBar.show();
}

function isSameDay(a: number, b: number): boolean {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}m ${remain}s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
