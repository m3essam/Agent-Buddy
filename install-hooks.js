// Adds (or with --uninstall removes) the Agent Buddy hooks in ~/.claude/settings.json.
// They are HTTP hooks: Claude Code posts each event to the running app, so nothing has to be
// installed besides the app. Existing hooks are left untouched; a backup is written first.
// Run directly (node install-hooks.js [--uninstall]) or used by the settings window.

const fs = require('fs');
const os = require('os');
const path = require('path');

const file = path.join(os.homedir(), '.claude', 'settings.json');
const TOKEN_FILE = path.join(os.homedir(), '.agent-buddy', 'token');
const URL = 'http://127.0.0.1:47321/hook';
const BACKUP = file + '.bak-agent-buddy';

// Ours: the HTTP hook, plus command hooks earlier builds installed (node .../hook.js).
const isOurs = (entry) => {
  const s = JSON.stringify(entry);
  return s.includes(URL) || /(claude-pet|agent-buddy)\/hook\.js/.test(s);
};

// SessionStart only takes command hooks, so it isn't here; the first prompt registers a session.
const EVENTS = [
  ['SessionEnd', null, 5],
  ['UserPromptSubmit', null, 5],
  ['PreToolUse', '*', 60],      // 60s so AskUserQuestion can wait for an answer
  ['PostToolUse', '*', 5],
  ['PostToolUseFailure', '*', 5],
  ['StopFailure', null, 5],
  ['Notification', null, 5],
  ['Stop', null, 5],
  ['PermissionRequest', '*', 60],
];

const handler = (token, timeout) => ({
  type: 'http', url: URL, timeout,
  // which app the session runs in, and its desktop id (to open it from the bubble)
  headers: { 'x-pet-token': token, 'x-entrypoint': '$CLAUDE_CODE_ENTRYPOINT', 'x-host-session': '$CLAUDE_CODE_HOST_SESSION_ID' },
  allowedEnvVars: ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_HOST_SESSION_ID'],
});

const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
const readToken = () => fs.readFileSync(TOKEN_FILE, 'utf8').trim();

function write(install, token) {
  const settings = read();
  if (fs.existsSync(file)) fs.copyFileSync(file, BACKUP);
  else fs.mkdirSync(path.dirname(file), { recursive: true });
  settings.hooks = settings.hooks || {};
  const allEvents = new Set([...Object.keys(settings.hooks), ...EVENTS.map(([e]) => e)]);
  for (const event of allEvents) {
    const list = (settings.hooks[event] || []).filter((e) => !isOurs(e));
    const spec = EVENTS.find(([e]) => e === event);
    if (install && spec) {
      const entry = { hooks: [handler(token || readToken(), spec[2])] };
      if (spec[1]) entry.matcher = spec[1];
      list.push(entry);
    }
    if (list.length) settings.hooks[event] = list;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

// 'installed' (current hooks with this token on every event), 'partial' (some, old-style or an
// old token: reconnect fixes it), 'missing', or 'error' (settings.json can't be read).
function status(token) {
  try {
    const hooks = read().hooks || {};
    const current = (e) => (hooks[e] || []).some((x) => (x.hooks || []).some((h) => h.type === 'http' && h.url === URL && h.headers?.['x-pet-token'] === token));
    if (EVENTS.every(([e]) => current(e))) return 'installed';
    return Object.values(hooks).some((list) => list.some(isOurs)) ? 'partial' : 'missing';
  } catch { return 'error'; }
}

module.exports = { install: (token) => write(true, token), uninstall: () => write(false), status, settingsFile: file };

if (require.main === module) {
  const uninstall = process.argv.includes('--uninstall');
  write(!uninstall);
  console.log(uninstall ? 'Agent Buddy hooks removed.' : 'Agent Buddy hooks installed.', 'Backup:', BACKUP);
}
