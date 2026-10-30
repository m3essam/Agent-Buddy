// Agent Buddy: an always-on-top desktop companion for Claude Code sessions, shown as the
// user's own character. Hooks (hook.js) post events to a local HTTP server here; blocking
// hooks (permission requests, AskUserQuestion) wait until the user answers from the bubble.

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog, protocol, net } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const PORT = 47321;
const DATA_DIR = path.join(os.homedir(), '.agent-buddy');
const LEGACY_DIR = path.join(os.homedir(), '.claude-pet');
const TOKEN_FILE = path.join(DATA_DIR, 'token');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
const PLACEHOLDER_DIR = path.join(__dirname, 'assets', 'placeholder');
const ASK_TIMEOUT_MS = 55_000; // hook timeout is 60s; fall back to Claude's own dialog before that
const WIN_W = 320, WIN_H = 560; // tall enough for a question bubble above a tall character; the empty part is click-through

// A second launch must exit before touching the token or the port the running pet owns.
if (!app.requestSingleInstanceLock()) process.exit(0);

// Earlier builds kept their settings in ~/.claude-pet; carry them over once.
if (!fs.existsSync(DATA_DIR) && fs.existsSync(path.join(LEGACY_DIR, 'config.json'))) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(path.join(LEGACY_DIR, 'config.json'), CONFIG_FILE);
}
fs.mkdirSync(CHARACTERS_DIR, { recursive: true });
// The token is written into Claude Code's hook settings, so it stays the same across restarts.
let token = '';
try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {}
if (!/^[0-9a-f]{48}$/.test(token)) { token = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(TOKEN_FILE, token); }

let config = {};
const firstRun = !fs.existsSync(CONFIG_FILE);
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

// User settings (the settings window). hook.js reads watchCli from this file too.
const DEFAULT_SETTINGS = {
  scale: 1,               // size of the buddy and its bubble
  theme: 'system',        // bubble theme: system | light | dark
  confetti: true,
  sound: false,           // a soft chime when a session needs you
  doneSeconds: 9,         // how long the "done" bubble stays up
  quiet: false,           // stay hidden until a session needs you or finishes
  answerPermissions: false, // Allow / Deny from the bubble; off by default, it approves commands
  answerQuestions: true,
  watchCli: false,        // also follow Claude Code in a terminal or editor, not just the desktop app
};
// Earlier builds always answered permissions from the bubble; keep that for existing users.
if (!config.settings && !firstRun) config.settings = { answerPermissions: true };
config.settings = { ...DEFAULT_SETTINGS, ...config.settings };
const settings = () => config.settings;
const winSize = () => ({ width: Math.round(WIN_W * settings().scale), height: Math.round(WIN_H * settings().scale) });

let win, tray, settingsWin, trayIconImage;
const hooks = require('./install-hooks');
const sessions = new Map(); // session_id -> { id, title, cwd, state, detail, updatedAt }
const pending = new Map();  // ask id -> { id, kind, sessionId, payload, resolve, timer }

app.on('second-instance', () => { if (win) setVisible(true); });

// ---------- sessions ----------

function sessionFor(ev) {
  let s = sessions.get(ev.session_id);
  if (!s) {
    s = { id: ev.session_id, title: '', cwd: ev.cwd || '', state: 'idle', detail: '', updatedAt: Date.now() };
    sessions.set(ev.session_id, s);
  }
  if (ev.session_title) s.title = ev.session_title;
  if (ev.host_session_id) s.hostId = ev.host_session_id;
  if (ev.cwd) s.cwd = ev.cwd;
  if (!s.title && ev.prompt) s.title = ev.prompt.replace(/\s+/g, ' ').slice(0, 48);
  if (!s.title && s.cwd) s.title = path.basename(s.cwd);
  s.updatedAt = Date.now();
  return s;
}

const TOOL_LABELS = {
  Bash: 'Running a command', PowerShell: 'Running a command', Read: 'Reading files', Edit: 'Editing code',
  Write: 'Writing a file', Grep: 'Searching', Glob: 'Searching', WebFetch: 'Browsing the web',
  WebSearch: 'Searching the web', Agent: 'Delegating to a helper', Task: 'Delegating to a helper',
};
const toolLabel = (name = '') => TOOL_LABELS[name] || (name.startsWith('mcp__') ? 'Using ' + name.split('__')[1] : 'Using ' + name);
// Tools that look things up get the "checking" pose; everything else gets "running".
const CHECKING_TOOLS = /^(Read|Grep|Glob|LS|WebFetch|WebSearch|NotebookRead|TaskOutput|ListMcpResources|ReadMcpResource)$|__(read|get|list|search|fetch|query)/i;
const activityFor = (tool = '') => (CHECKING_TOOLS.test(tool) ? 'checking' : 'running');

function effect(name) {
  if (win && !win.isDestroyed()) win.webContents.send('effect', name);
}

function handleEvent(ev) {
  const name = ev.hook_event_name;
  if (name === 'SessionEnd') {
    sessions.delete(ev.session_id);
    cancelPendingFor(ev.session_id);
    return broadcast();
  }
  const s = sessionFor(ev);
  switch (name) {
    case 'SessionStart':
      s.state = 'idle'; s.detail = 'Ready';
      if (ev.source === 'startup') effect('hello');
      break;
    case 'UserPromptSubmit': cancelPendingFor(ev.session_id); s.state = 'working'; s.unread = false; s.activity = 'thinking'; s.detail = 'Thinking'; break;
    case 'PreToolUse': s.state = 'working'; s.activity = activityFor(ev.tool_name); s.detail = toolLabel(ev.tool_name); break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      // a tool ran, so any bubble still asking about this session was answered elsewhere
      cancelPendingFor(ev.session_id);
      if (ev.tool_name === 'AskUserQuestion') s.state = 'working'; // answered in Claude, even if the mirror was dismissed
      if (s.state !== 'waiting') { s.state = 'working'; s.activity = 'thinking'; s.detail = 'Thinking'; }
      if (name === 'PostToolUseFailure' && !ev.is_interrupt) { s.detail = 'That didn’t work, retrying'; effect('error'); }
      break;
    case 'StopFailure':
      cancelPendingFor(ev.session_id);
      s.state = 'done';
      s.unread = true;
      s.failed = true;
      s.detail = 'Stopped by an error: ' + (ev.error || 'unknown').replace(/_/g, ' ');
      effect('error');
      break;
    case 'Notification':
      if (/permission|input|elicitation/.test(ev.notification_type || '') && !hasPendingFor(s.id)) {
        s.state = 'waiting'; s.detail = ev.message || 'Needs your input';
      }
      break;
    case 'Stop':
      cancelPendingFor(ev.session_id);
      s.state = 'done';
      s.unread = true;
      s.failed = false;
      s.detail = (ev.last_assistant_message || 'Finished').replace(/\s+/g, ' ').slice(0, 140);
      break;
  }
  broadcast();
}

// ---------- blocking asks (permission + questions) ----------

const hasPendingFor = (sid) => [...pending.values()].some(p => p.sessionId === sid);

function cancelPendingFor(sid) {
  for (const p of [...pending.values()]) if (p.sessionId === sid) settle(p.id, null);
}

function settle(id, result) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (p.resolve) p.resolve(result);
  const s = sessions.get(p.sessionId);
  if (s && s.state === 'waiting' && !p.dismissed && !hasPendingFor(s.id)) { s.state = 'working'; s.detail = 'Thinking'; }
  broadcast();
}

function addPending(kind, ev) {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const s = sessionFor(ev);
    s.state = 'waiting';
    s.detail = kind === 'permission' ? 'Needs your OK: ' + toolLabel(ev.tool_name).toLowerCase() : 'Has a question for you';
    const timer = setTimeout(() => settle(id, null), ASK_TIMEOUT_MS);
    pending.set(id, { id, kind, sessionId: s.id, payload: ev, resolve, timer, createdAt: Date.now() });
    broadcast();
    effect('hello');
  });
}

// A question Claude is asking in its own dialog: shown in the bubble too, answered only in Claude.
// It goes away once that session moves on (the tool ran, the turn ended, or a new prompt).
function mirrorQuestion(ev) {
  const s = sessionFor(ev);
  cancelPendingFor(s.id);
  s.state = 'waiting';
  s.detail = 'Has a question for you in Claude';
  const id = crypto.randomUUID();
  pending.set(id, { id, kind: 'mirror', sessionId: s.id, payload: ev, createdAt: Date.now() });
  broadcast();
  effect('hello');
}

// Short human summary of what a tool wants to do.
function describeTool(ev) {
  const i = ev.tool_input || {};
  const v = i.command || i.file_path || i.path || i.url || i.query || i.pattern || i.description || '';
  return String(v || JSON.stringify(i)).slice(0, 400);
}

// ---------- http ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj ?? {})); };
  if (req.method !== 'POST' || req.headers['x-pet-token'] !== token) return reply(403, { error: 'forbidden' });
  let ev;
  try { ev = await readBody(req); } catch { return reply(400, { error: 'bad json' }); }

  // Claude Code's HTTP hooks post every event here and read the reply as hook output.
  if (req.url === '/hook') {
    ev.host_session_id = req.headers['x-host-session'] || undefined;
    if (req.headers['x-entrypoint'] !== 'claude-desktop' && !settings().watchCli) return reply(200, {});
    const name = ev.hook_event_name;
    if (name === 'PermissionRequest') {
      const d = await ask('permission', ev, res);
      if (d && (d.behavior === 'allow' || d.behavior === 'deny')) {
        return reply(200, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });
      }
      return reply(200, {});
    }
    if (name === 'PreToolUse' && ev.tool_name === 'AskUserQuestion') {
      handleEvent(ev);
      // The desktop app shows its own question dialog even when a hook supplies the answers, so
      // holding the hook only delays that dialog. Let Claude ask right away and mirror the question.
      if (req.headers['x-entrypoint'] === 'claude-desktop') {
        mirrorQuestion(ev);
        return reply(200, {});
      }
      const r = await ask('question', ev, res);
      if (r && r.answers) {
        return reply(200, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
          updatedInput: { ...ev.tool_input, answers: r.answers } } });
      }
      return reply(200, {});
    }
    handleEvent(ev);
    return reply(200, {});
  }

  // Source runs only: screenshots and a click on the pet for tools/demo.js.
  if (!app.isPackaged && req.url === '/dev/capture') {
    const png = await devCapture(ev.target);
    if (!png) return reply(404, { error: 'that window is not open' });
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(png);
  }
  if (!app.isPackaged && req.url === '/dev/toggle-list') {
    win.webContents.executeJavaScript('onPetClick()').catch(() => {});
    return reply(200, {});
  }
  if (!app.isPackaged && req.url === '/dev/demo-only') {
    devDemoOnly = !!ev.on;
    broadcast();
    return reply(200, {});
  }
  if (!app.isPackaged && req.url === '/dev/wizard') {
    openWizard(ev.mode || 'new');
    return reply(200, {});
  }
  if (!app.isPackaged && req.url === '/dev/eval') {
    const w = { pet: win, settings: settingsWin, wizard: wizardWin }[ev.target];
    if (!w || w.isDestroyed()) return reply(404, { error: 'that window is not open' });
    try { return reply(200, { result: await w.webContents.executeJavaScript(ev.js) }); }
    catch (e) { return reply(200, { error: String(e) }); }
  }

  reply(404, {});
}).listen(PORT, '127.0.0.1');

// The pet window is mostly transparent: its capture is cropped to what's drawn.
async function devCapture(target = 'pet') {
  if (target === 'settings' && !(settingsWin && !settingsWin.isDestroyed())) {
    openSettings();
    await new Promise((r) => settingsWin.once('ready-to-show', () => setTimeout(r, 600)));
  }
  const w = { pet: win, settings: settingsWin, wizard: wizardWin }[target];
  if (!w || w.isDestroyed()) return null;
  const img = await w.webContents.capturePage();
  if (target !== 'pet') return img.toPNG();
  const { width: W, height: H } = img.getSize(), px = img.toBitmap(), PAD = 8;
  let top = H;
  for (let y = 0; y < H && top === H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 8) { top = y; break; }
  const y = Math.max(0, top - PAD);
  return img.crop({ x: 0, y, width: W, height: H - y }).toPNG();
}

// Source runs: while tools/demo.js takes screenshots, show only its made-up sessions.
let devDemoOnly = false;

// Wait for the user's answer in the bubble; null means "let Claude ask as usual".
async function ask(kind, ev, res) {
  // Answering from the bubble is turned off: show that Claude needs you and let Claude ask.
  if (!settings()[kind === 'permission' ? 'answerPermissions' : 'answerQuestions']) {
    const s = sessionFor(ev);
    s.state = 'waiting';
    s.detail = kind === 'permission' ? 'Needs your OK in Claude' : 'Has a question for you in Claude';
    broadcast();
    effect('hello');
    return null;
  }
  // If Claude stops waiting (timeout, or the user answered in Claude), drop the bubble too.
  res.on('close', () => { if (!res.writableFinished) for (const p of pending.values()) if (p.payload === ev) settle(p.id, null); });
  return addPending(kind, ev);
}

// ---------- renderer bridge ----------

function snapshot() {
  return {
    sessions: [...sessions.values()].filter((s) => !devDemoOnly || s.id.startsWith('demo-')).sort((a, b) => b.updatedAt - a.updatedAt),
    pending: [...pending.values()].filter((p) => !devDemoOnly || p.sessionId.startsWith('demo-')).sort((a, b) => a.createdAt - b.createdAt).map(p => ({
      id: p.id, kind: p.kind, sessionId: p.sessionId,
      sessionTitle: sessions.get(p.sessionId)?.title || '',
      toolName: p.payload.tool_name,
      summary: p.kind === 'permission' ? describeTool(p.payload) : '',
      questions: p.kind === 'permission' ? [] : (p.payload.tool_input?.questions || []),
    })),
  };
}

const STALE_MS = 6 * 3600_000;

function broadcast() {
  // Forget quiet sessions that have nothing for the user (closed windows rarely send SessionEnd).
  for (const [id, s] of sessions) {
    if (s.state === 'idle' && !s.unread && !hasPendingFor(id) && Date.now() - s.updatedAt > STALE_MS) sessions.delete(id);
  }
  if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
  updateVisibility();
}

// Hidden: only an ask from Claude brings the buddy up. Quiet: it also comes up when a
// session needs you or finishes, and goes away again once nothing does.
function updateVisibility() {
  if (!win || win.isDestroyed()) return;
  const needed = [...sessions.values()].some((s) => s.state === 'waiting' || s.state === 'done');
  const show = pending.size > 0 || (!config.hidden && (!settings().quiet || needed));
  if (show && !win.isVisible()) { keepOnScreen(); win.showInactive(); win.moveTop(); }
  else if (!show && win.isVisible()) win.hide();
}

ipcMain.handle('get-state', () => snapshot());

// ---------- characters ----------
// A character is a folder with character.json (see README) plus its image or frames.
// The active one lives in ~/.agent-buddy/characters/<id>; with none chosen, the
// built-in placeholder in assets/placeholder is shown.

function readCharacter(dir) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
    return c.kind === 'image' || c.kind === 'frames' ? c : null;
  } catch { return null; }
}

function listCharacters() {
  return fs.readdirSync(CHARACTERS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, info: readCharacter(path.join(CHARACTERS_DIR, d.name)) }))
    .filter((c) => c.info);
}

function activeCharacterDir() {
  const dir = config.character && path.join(CHARACTERS_DIR, config.character);
  return dir && readCharacter(dir) ? dir : PLACEHOLDER_DIR;
}

// Character files are served as buddy://character/<file> from the active folder only.
// buddy://app/<file> serves the video wizard and its background-removal model: a real origin
// lets it fetch the model's wasm, which file:// pages cannot.
protocol.registerSchemesAsPrivileged([{ scheme: 'buddy', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } }]);
const APP_FILES = ['renderer/', 'assets/vision/', 'node_modules/@mediapipe/tasks-vision/'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream' };
function serveCharacterFiles() {
  protocol.handle('buddy', async (req) => {
    const url = new URL(req.url), rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (url.host === 'app') {
      const file = path.resolve(__dirname, rel), inApp = path.relative(__dirname, file).split(path.sep).join('/');
      if (!APP_FILES.some((p) => inApp.startsWith(p))) return new Response('', { status: 403 });
      // fs reads inside the packaged app.asar too
      try { return new Response(await fs.promises.readFile(file), { headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' } }); }
      catch { return new Response('', { status: 404 }); }
    }
    const dir = activeCharacterDir();
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep)) return new Response('', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).href);
    // CORS lets the renderer read pixels back (to draw the tray icon from the character)
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || '', 'Access-Control-Allow-Origin': '*' } });
  });
}

ipcMain.handle('character', () => ({ ...readCharacter(activeCharacterDir()), base: 'buddy://character/' }));

function useCharacter(id) {
  config.character = id; saveConfig();
  if (win && !win.isDestroyed()) win.webContents.reload();
  rebuildTray();
}

const slugify = (name) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  let slug = base;
  for (let i = 2; fs.existsSync(path.join(CHARACTERS_DIR, slug)); i++) slug = `${base}-${i}`;
  return slug;
};

// Quick path: one picture, animated by the renderer for each state.
async function newCharacterFromImage() {
  const r = await dialog.showOpenDialog({
    title: 'Choose a picture of your character',
    filters: [{ name: 'Images', extensions: ['png', 'webp', 'gif', 'svg', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return;
  const src = r.filePaths[0], ext = path.extname(src).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    const { response } = await dialog.showMessageBox({
      type: 'info', buttons: ['Use it anyway', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'This picture has a background',
      detail: 'JPG pictures show as a rectangle on your desktop. A PNG with a transparent background looks best.',
    });
    if (response === 1) return;
  }
  const name = path.basename(src, ext);
  const id = slugify(name);
  const dir = path.join(CHARACTERS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, 'avatar' + ext));
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify({ name, kind: 'image', image: 'avatar' + ext }, null, 2));
  useCharacter(id);
}

// ---------- video wizard ----------
// One video becomes a frames character: the wizard cuts the figure out frame by frame, then you
// mark which frames play for each state. "Edit clips" reopens the marking step for the active one.

let wizardWin = null, wizardMode = 'new';
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function openWizard(mode) {
  if (mode === 'edit' && readCharacter(activeCharacterDir())?.kind !== 'frames') return;
  if (wizardWin && !wizardWin.isDestroyed()) wizardWin.close();
  wizardMode = mode;
  const w = wizardWin = new BrowserWindow({
    width: 980, height: 760, minWidth: 760, minHeight: 600, title: mode === 'edit' ? 'Edit clips' : 'New character from a video',
    icon: trayIconImage || undefined, autoHideMenuBar: true, show: false, backgroundColor: '#f7f6f3',
    webPreferences: { preload: path.join(__dirname, 'wizard-preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  w.setMenu(null);
  w.loadURL('buddy://app/renderer/video-wizard.html');
  w.once('ready-to-show', () => w.show());
  // a replaced wizard closes after the new one opens; only forget the window that is closing
  w.on('closed', () => { if (wizardWin === w) wizardWin = null; });
}

ipcMain.handle('wizard:init', () => (wizardMode === 'edit'
  ? { mode: 'edit', character: { ...readCharacter(activeCharacterDir()), base: 'buddy://character/' } }
  : { mode: 'new' }));

ipcMain.handle('wizard:pick-video', async () => {
  // Source runs: AGENT_BUDDY_TEST_VIDEO skips the dialog, for trying the wizard repeatedly.
  const r = !app.isPackaged && process.env.AGENT_BUDDY_TEST_VIDEO
    ? { filePaths: [process.env.AGENT_BUDDY_TEST_VIDEO] }
    : await dialog.showOpenDialog(wizardWin, {
      title: 'Choose a video of your character',
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }],
      properties: ['openFile'],
    });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0], size = fs.statSync(file).size;
  if (size > MAX_VIDEO_BYTES) return { error: 'That video is over 500 MB. Trim it to the part with your character first.' };
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = { mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' }[ext] || 'video/mp4';
  return { name: path.basename(file, path.extname(file)), type, bytes: await fs.promises.readFile(file) };
});

// New: frames is a list of webp files (as bytes). Edit: frames is null and only character.json changes.
ipcMain.handle('wizard:save', async (_e, { character, frames }) => {
  let dir = activeCharacterDir(), id = config.character;
  if (frames) {
    id = slugify(character.name || 'character');
    dir = path.join(CHARACTERS_DIR, id);
    fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
    await Promise.all(frames.map((buf, i) => fs.promises.writeFile(path.join(dir, 'frames', `f${String(i).padStart(3, '0')}.webp`), Buffer.from(buf))));
    character.frames = { ...character.frames, count: frames.length, file: 'frames/f###.webp' };
  } else if (dir === PLACEHOLDER_DIR) return false;
  const prev = readCharacter(dir) || {};
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify({ ...prev, ...character, kind: 'frames' }, null, 2));
  useCharacter(id);
  if (wizardWin && !wizardWin.isDestroyed()) wizardWin.close();
  return true;
});

// A shared character: a folder that holds character.json and its files.
async function importCharacter() {
  const r = await dialog.showOpenDialog({ title: 'Choose a character folder (it holds character.json)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  const info = readCharacter(r.filePaths[0]);
  if (!info) {
    dialog.showMessageBox({ type: 'warning', message: 'That folder is not a character', detail: 'A character folder needs a character.json file. See the README for the format.' });
    return;
  }
  const id = slugify(info.name || path.basename(r.filePaths[0]));
  fs.cpSync(r.filePaths[0], path.join(CHARACTERS_DIR, id), { recursive: true });
  useCharacter(id);
}

// The renderer draws the tray icon from the character's head.
ipcMain.on('tray-icon', (_e, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) return;
  const size = Math.round(16 * screen.getPrimaryDisplay().scaleFactor);
  const icon = img.resize({ width: size, height: size, quality: 'best' });
  trayIconImage = img;
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.setIcon(img);
  if (tray) tray.setImage(icon);
  else createTray(icon);
});

ipcMain.on('answer', (_e, { id, answer }) => {
  const p = pending.get(id);
  if (!p) return;
  if (answer.type === 'allow') settle(id, { behavior: 'allow' });
  else if (answer.type === 'deny') settle(id, { behavior: 'deny', message: 'Denied from Agent Buddy' });
  else if (answer.type === 'answers') settle(id, { answers: answer.answers });
  else if (answer.type === 'dismiss') { p.dismissed = true; settle(id, null); } // a mirrored question: hide it, Claude still asks
  else { const sid = p.sessionId; settle(id, null); openSession(sid); } // "Open Claude": fall back to the normal dialog
});

// The done bubble timed out: the pet calms down, but the session stays unread.
ipcMain.on('linger-end', (_e, sid) => {
  const s = sessions.get(sid);
  if (s && s.state === 'done') { s.state = 'idle'; broadcast(); }
});

ipcMain.on('mark-read', (_e, sid) => {
  const s = sessions.get(sid);
  if (!s) return;
  s.unread = false;
  if (s.state === 'done') s.state = 'idle';
  broadcast();
});

ipcMain.on('open-session', (_e, sid) => openSession(sid));
ipcMain.on('focus-claude', () => focusClaude());
ipcMain.on('show-menu', () => { if (win) Menu.buildFromTemplate(menuTemplate()).popup({ window: win }); });

// Open that session in the Claude desktop app (marks it read).
function openSession(sid) {
  const s = sessions.get(sid);
  if (s) { s.unread = false; if (s.state === 'done') s.state = 'idle'; broadcast(); }
  // Only desktop-app sessions can be opened; a terminal session has nowhere to go.
  if (!s || !/^local_[A-Za-z0-9-]{1,64}$/.test(s.hostId || '')) return;
  // "continue" looks the id up among all open sessions; "needs-input" only searches waiting ones
  // and opens a new conversation for anything else.
  shell.openExternal(`claude://code/continue?session=${s.hostId}&source=agent-buddy`).catch(() => {});
  // The link selects the session; this makes sure the window comes forward either way.
  setTimeout(focusClaude, 400);
}

ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

let dragStart = null;
ipcMain.on('drag', (_e, { phase, x, y }) => {
  if (!win) return;
  if (phase === 'start') { const [wx, wy] = win.getPosition(); dragStart = { x, y, wx, wy }; }
  // setBounds, not setPosition: with display scaling, setPosition lets the window grow a pixel per move
  else if (phase === 'move' && dragStart) {
    win.setBounds({ x: Math.round(dragStart.wx + x - dragStart.x), y: Math.round(dragStart.wy + y - dragStart.y), ...winSize() });
  }
  else if (phase === 'end') {
    dragStart = null;
    const [px, py] = win.getPosition();
    config.position = { x: px, y: py }; saveConfig();
    keepOnScreen();
  }
});

// Bring the Claude desktop window to the front as it is: restore it if minimized,
// and relaunch the app (which re-shows its window) if it only lives in the tray.
const FOCUS_CLAUDE_PS = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class PetWin {
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$p = Get-Process -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  $h = $p.MainWindowHandle
  if ([PetWin]::IsIconic($h)) { [void][PetWin]::ShowWindowAsync($h, 9) }
  [void][PetWin]::SetForegroundWindow($h)
  [void](New-Object -ComObject WScript.Shell).AppActivate($p.Id)
} else {
  $exe = Join-Path $env:LOCALAPPDATA 'AnthropicClaude\\claude.exe'
  if (Test-Path $exe) { Start-Process $exe }
}`;

function focusClaude() {
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', FOCUS_CLAUDE_PS], { windowsHide: true }, () => {});
}

// ---------- window + tray ----------

function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea, { width, height } = winSize();
  return { x: wa.x + wa.width - width - 16, y: wa.y + wa.height - height };
}

// The pet (its lower part, where the avatar stands) must sit on a connected screen.
function onScreen(pos) {
  const { width, height } = winSize();
  const feet = { x: pos.x + width / 2, y: pos.y + height - 60 };
  return screen.getAllDisplays().some(({ workArea: a }) =>
    feet.x >= a.x && feet.x < a.x + a.width && feet.y >= a.y && feet.y < a.y + a.height);
}

function keepOnScreen() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  if (onScreen({ x, y })) return;
  const p = defaultPosition();
  win.setBounds({ ...p, ...winSize() });
  delete config.position; saveConfig();
}

function setVisible(show) {
  config.hidden = !show; saveConfig();
  updateVisibility();
  rebuildTray();
}

// Resize around the buddy's feet, so it grows or shrinks in place.
function applyScale() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition(), [w, h] = win.getSize(), size = winSize();
  win.setBounds({ x: Math.round(x + (w - size.width) / 2), y: y + h - size.height, ...size });
  win.webContents.setZoomFactor(settings().scale);
  const [px, py] = win.getPosition();
  if (config.position) { config.position = { x: px, y: py }; saveConfig(); }
  keepOnScreen();
}

function createWindow() {
  // The window grew taller in this version; keep a saved position's feet where they were.
  if (config.position && (config.winH || 490) !== WIN_H) config.position.y -= Math.round((WIN_H - (config.winH || 490)) * settings().scale);
  config.winH = WIN_H; saveConfig();
  const pos = config.position && onScreen(config.position) ? config.position : defaultPosition();
  win = new BrowserWindow({
    ...winSize(), x: pos.x, y: pos.y,
    transparent: true, frame: false, resizable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, focusable: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings().scale));
  win.once('ready-to-show', () => updateVisibility());
  // Unplugging a monitor or changing scaling can strand the pet off-screen.
  for (const ev of ['display-removed', 'display-metrics-changed']) screen.on(ev, () => setTimeout(keepOnScreen, 500));
  // Some fullscreen apps knock topmost windows down; keep re-asserting.
  setInterval(() => { if (win && !win.isDestroyed() && win.isVisible()) win.moveTop(); }, 5000);
}

// Installed, the app's own exe starts it; from source, electron.exe needs the app folder.
const LOGIN_ITEM = { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()], name: 'Agent Buddy' };
const LEGACY_LOGIN_NAME = 'Claude Pet';

function characterMenu() {
  const active = activeCharacterDir();
  const pick = (id, label, dir) => ({ label, type: 'radio', checked: active === dir, click: () => useCharacter(id) });
  return [
    pick(null, 'Default buddy', PLACEHOLDER_DIR),
    ...listCharacters().map((c) => pick(c.id, c.info.name || c.id, path.join(CHARACTERS_DIR, c.id))),
    { type: 'separator' },
    { label: 'New character from a video…', click: () => openWizard('new') },
    { label: 'New character from a picture…', click: () => newCharacterFromImage() },
    { label: 'Edit clips…', enabled: readCharacter(active)?.kind === 'frames' && active !== PLACEHOLDER_DIR, click: () => openWizard('edit') },
    { label: 'Import a character folder…', click: () => importCharacter() },
    { label: 'Open characters folder', click: () => shell.openPath(CHARACTERS_DIR) },
  ];
}

function resetPosition() {
  delete config.position; saveConfig();
  win.setBounds({ ...defaultPosition(), ...winSize() });
  setVisible(true);
}

const startsWithWindows = () => app.getLoginItemSettings(LOGIN_ITEM).openAtLogin;
function setStartWithWindows(on) { app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: on }); rebuildTray(); }

// Shared by the tray icon and right-clicking the pet.
function menuTemplate() {
  return [
    { label: 'Show buddy', type: 'checkbox', checked: !config.hidden, click: (item) => setVisible(item.checked) },
    { label: 'Character', submenu: characterMenu() },
    { label: 'Settings…', click: () => openSettings() },
    { label: 'Reset position', click: resetPosition },
    { label: 'Start with Windows', type: 'checkbox', checked: startsWithWindows(), click: (item) => setStartWithWindows(item.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}

function rebuildTray() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('changed');
  if (!tray) return;
  tray.setToolTip(config.hidden ? 'Agent Buddy (click to show)' : 'Agent Buddy (click to hide)');
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

// ---------- settings window ----------

function settingsState() {
  return {
    settings: settings(),
    characters: [{ id: null, name: 'Default buddy' }, ...listCharacters().map((c) => ({ id: c.id, name: c.info.name || c.id, kind: c.info.kind }))],
    character: activeCharacterDir() === PLACEHOLDER_DIR ? null : config.character,
    shown: !config.hidden,
    startWithWindows: startsWithWindows(),
    hooks: hooks.status(token),
    version: app.getVersion(),
  };
}

function setSetting(key, value) {
  const def = DEFAULT_SETTINGS[key];
  if (def === undefined || typeof value !== typeof def) return;
  if (key === 'scale') value = Math.min(1.6, Math.max(0.6, value));
  if (key === 'doneSeconds') value = Math.min(60, Math.max(3, Math.round(value)));
  if (key === 'theme' && !['system', 'light', 'dark'].includes(value)) return;
  config.settings[key] = value; saveConfig();
  if (key === 'scale') applyScale();
  if (key === 'quiet') updateVisibility();
  if (win && !win.isDestroyed()) win.webContents.send('settings', settings());
}

const SETTINGS_ACTIONS = {
  character: (id) => useCharacter(id),
  newFromPicture: () => newCharacterFromImage(),
  newFromVideo: () => openWizard('new'),
  editClips: () => openWizard('edit'),
  importCharacter: () => importCharacter(),
  openCharacters: () => shell.openPath(CHARACTERS_DIR),
  shown: (on) => setVisible(!!on),
  resetPosition: () => resetPosition(),
  startWithWindows: (on) => setStartWithWindows(!!on),
  installHooks: () => hooks.install(token),
  removeHooks: () => hooks.uninstall(),
};

ipcMain.handle('settings:get', () => settingsState());
ipcMain.handle('settings:set', (_e, key, value) => { setSetting(key, value); return settingsState(); });
ipcMain.handle('settings:action', async (_e, name, arg) => {
  if (SETTINGS_ACTIONS[name]) await SETTINGS_ACTIONS[name](arg);
  return settingsState();
});
ipcMain.handle('get-settings', () => settings());

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 500, height: 720, minWidth: 420, minHeight: 400, title: 'Agent Buddy settings',
    icon: trayIconImage || undefined, autoHideMenuBar: true, show: false, backgroundColor: '#f7f6f3',
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// Created once the renderer sends the first icon drawn from the character.
function createTray(icon) {
  tray = new Tray(icon);
  tray.on('click', () => setVisible(!!config.hidden));
  win.on('show', rebuildTray);
  win.on('hide', rebuildTray);
  rebuildTray();
}

app.whenReady().then(() => {
  // Start at sign-in by default; the tray checkbox turns it off.
  if (config.loginItemName !== LOGIN_ITEM.name) {
    // Keep the choice made under the old name; very old builds used Electron's default name.
    const legacy = { path: LOGIN_ITEM.path, args: LOGIN_ITEM.args, name: LEGACY_LOGIN_NAME };
    const wasOn = config.loginItemName === LEGACY_LOGIN_NAME ? app.getLoginItemSettings(legacy).openAtLogin : true;
    app.setLoginItemSettings({ ...legacy, openAtLogin: false });
    app.setLoginItemSettings({ path: LOGIN_ITEM.path, args: LOGIN_ITEM.args, openAtLogin: false });
    app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: wasOn });
    config.loginItemName = LOGIN_ITEM.name;
    delete config.loginItemSet;
    saveConfig();
  }
  serveCharacterFiles();
  // Installed copies update themselves from GitHub Releases: downloaded quietly, applied on quit.
  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    check();
    setInterval(check, 6 * 3600_000);
  }
  createWindow();
  if (firstRun) openSettings();
  // in case the character can't be drawn, still give the user a tray menu
  setTimeout(() => { if (!tray) createTray(nativeImage.createEmpty()); }, 8000);
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  for (const p of [...pending.values()]) settle(p.id, null);
});
