// Drives a running Agent Buddy (npm start) with made-up Claude sessions, for trying changes
// and taking the README screenshots. Nothing touches Claude: events go straight to the buddy.
//
//   node tools/demo.js                 play the whole tour
//   node tools/demo.js <scene>         one scene: working | checking | question | permission | done | unread | clear
//   node tools/demo.js shots           play the tour and save screenshots to docs/images (source runs only)

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 47321;
const token = fs.readFileSync(path.join(os.homedir(), '.agent-buddy', 'token'), 'utf8').trim();
const IMAGES = path.join(__dirname, '..', 'docs', 'images');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function post(route, body, { raw = false } = {}) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: route, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-pet-token': token,
        'x-entrypoint': 'claude-desktop', 'x-host-session': '' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', () => { console.error('Agent Buddy is not running (start it with npm start).'); process.exit(1); });
    req.end(data);
  });
}

const ev = (session, name, extra = {}) => post('/hook', { session_id: session.id, session_title: session.title, cwd: session.cwd, hook_event_name: name, ...extra });

const A = { id: 'demo-a', title: 'Fix the login redirect', cwd: 'C:\\code\\webapp' };
const B = { id: 'demo-b', title: 'Write release notes', cwd: 'C:\\code\\docs' };
const C = { id: 'demo-c', title: 'Tidy the test suite', cwd: 'C:\\code\\api' };

const QUESTION = {
  questions: [{
    question: 'Which database should the new service use?', header: 'Database', multiSelect: false,
    options: [{ label: 'PostgreSQL', description: 'Matches the other services' }, { label: 'SQLite', description: 'Simplest to run locally' }],
  }],
};

const scenes = {
  async working() { await ev(A, 'UserPromptSubmit', { prompt: A.title }); await ev(A, 'PreToolUse', { tool_name: 'Edit' }); },
  async checking() { await ev(A, 'UserPromptSubmit', { prompt: A.title }); await ev(A, 'PreToolUse', { tool_name: 'Grep' }); },
  async question() { await ev(B, 'UserPromptSubmit', { prompt: B.title }); await ev(B, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: QUESTION }); },
  async permission() {
    await ev(C, 'UserPromptSubmit', { prompt: C.title });
    // blocks until answered in the bubble (if answering permissions is on), so don't wait for it
    ev(C, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test -- --coverage' } });
  },
  async done() {
    await ev(A, 'UserPromptSubmit', { prompt: A.title });
    await ev(A, 'Stop', { last_assistant_message: 'Fixed the redirect loop after sign-in and added a test for it.' });
  },
  async unread() {
    for (const [s, msg] of [[A, 'Fixed the redirect loop after sign-in.'], [B, 'Release notes drafted in CHANGELOG.md.'], [C, 'Removed 14 duplicate tests; all green.']]) {
      await ev(s, 'UserPromptSubmit', { prompt: s.title });
      await ev(s, 'Stop', { last_assistant_message: msg });
    }
  },
  async clear() { for (const s of [A, B, C]) await ev(s, 'SessionEnd'); },
};

// Screenshots need the source build's capture route (see main.js, devCapture).
async function shot(name, target = 'pet') {
  const png = await post('/dev/capture', { target }, { raw: true });
  if (png.length < 100) return console.warn(`  (no screenshot for ${name}: ${png.toString()})`);
  fs.mkdirSync(IMAGES, { recursive: true });
  fs.writeFileSync(path.join(IMAGES, name + '.png'), png);
  console.log('  saved docs/images/' + name + '.png');
}

async function tour(shots) {
  if (shots) await post('/dev/demo-only', { on: true }); // keep your real sessions out of the pictures
  const step = async (label, scene, shotName, ms = 1600) => {
    console.log(label);
    await scenes.clear();
    await scene();
    await wait(ms);
    if (shots && shotName) await shot(shotName);
  };
  await step('Working: editing code', scenes.working, null);
  await step('Checking: searching', scenes.checking, null);
  await step('A question, shown in the bubble and in Claude', scenes.question, 'question');
  await step('A finished turn', scenes.done, 'done', 900);
  await step('Three finished sessions waiting to be read', scenes.unread, null, 9500);
  if (shots) { await post('/dev/toggle-list', {}); await wait(600); await shot('unread'); await post('/dev/toggle-list', {}); }
  if (shots) { await shot('settings', 'settings'); }
  await scenes.clear();
  if (shots) await post('/dev/demo-only', { on: false });
}

(async () => {
  const arg = process.argv[2];
  if (!arg) return tour(false);
  if (arg === 'shots') return tour(true);
  if (!scenes[arg]) { console.error('Unknown scene. Try: ' + Object.keys(scenes).join(', ')); process.exit(1); }
  await scenes[arg]();
})();
