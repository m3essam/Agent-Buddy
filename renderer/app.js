// Renderer: animates the user's character, reflects the combined session state, and hosts
// the speech bubble used to answer permission prompts and questions.

const DEFAULT_HEIGHT = 220;  // on-screen character height when character.json doesn't set one
const ONE_SHOT_MS = 1400;    // how long a picture character's hello / done / error move lasts
const $ = (s) => document.querySelector(s);
const avatar = $('#avatar'), bubble = $('#bubble'), badge = $('#badge'), statusText = $('#status span');

let state = { sessions: [], pending: [] };
let showList = false;      // session list opened by clicking the pet
let bubbleKey = '';        // what the bubble currently shows, so re-renders don't wipe input
let doneTimer = null, lastPetState = 'idle', lastNeed = 0;

// ---------- settings (from the settings window) ----------
let prefs = { theme: 'system', confetti: true, sound: false, doneSeconds: 9 };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyPrefs(p) {
  prefs = p;
  document.body.dataset.theme = p.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : p.theme;
}
darkQuery.addEventListener('change', () => applyPrefs(prefs));
window.pet.getSettings().then(applyPrefs);
window.pet.onSettings(applyPrefs);

// A soft two-note chime when a session starts needing you.
function chime() {
  const ctx = new AudioContext();
  [660, 880].forEach((hz, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.16;
    o.frequency.value = hz; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.4);
  });
  setTimeout(() => ctx.close(), 1000);
}

// ---------- avatar ----------
// States: idle, thinking, checking, running, waiting (looping) and hello, done, error (once).
// A "frames" character has a clip of frames per state; a missing state falls back to idle.
// An "image" character is one picture that CSS moves per state (style.css, body.image).
let srcs = [], clips = {}, base = 'idle', oneShot = null, oneShotTimer = null;
const player = clipPlayer(); // clips.js
let character = null;
window.pet.character().then((c) => {
  character = c;
  const height = c.height || DEFAULT_HEIGHT;
  avatar.style.height = height + 'px';
  document.body.style.setProperty('--pet-h', height + 30 + 'px');
  document.body.classList.toggle('image', c.kind === 'image');
  if (c.kind === 'image') {
    avatar.src = c.base + c.image;
    drawTrayIcon(c.base + c.image);
    return;
  }
  const f = c.frames, digits = (f.file.match(/#+/) || ['###'])[0];
  srcs = Array.from({ length: f.count }, (_, i) => {
    const img = new Image(); // keep a reference so every frame stays decoded in memory
    img.crossOrigin = 'anonymous';
    img.src = c.base + f.file.replace(digits, String(i).padStart(digits.length, '0'));
    return img;
  });
  clips = c.clips || {};
  const idle = clips.idle || Object.values(clips)[0] || { frames: [0, f.count - 1], mode: 'loop' };
  clips.idle = idle;
  drawTrayIcon(srcs[idle.frames[0]].src);
  setInterval(tick, 1000 / (f.fps || 10));
});

function playOnce(name) {
  if (character && character.kind === 'image') {
    document.body.dataset.once = name;
    clearTimeout(oneShotTimer);
    oneShotTimer = setTimeout(() => delete document.body.dataset.once, ONE_SHOT_MS);
  } else if (clips[name]) { oneShot = name; player.reset(); }
}

function tick() {
  const step = player.next(clips[oneShot || base] || clips.idle);
  if (step.finished) { // a one-shot ended (or a looping state has a "once" clip: hold its last frame)
    if (oneShot) { oneShot = null; return tick(); }
  }
  avatar.src = srcs[step.frame].src;
  avatar.style.marginLeft = step.offset + 'px';
}

// Tray icon: a square around the character's head, found from the top of the opaque pixels.
function drawTrayIcon(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const w = img.naturalWidth || 256, h = img.naturalHeight || 256;
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    let px;
    try { px = g.getImageData(0, 0, w, h).data; } catch { return; }
    const opaque = (x, y) => px[(y * w + x) * 4 + 3] > 40;
    let top = 0;
    while (top < h && ![...Array(w).keys()].some((x) => opaque(x, top))) top++;
    let minX = w, maxX = 0;
    for (let y = top; y < Math.min(h, top + h * 0.2); y++) for (let x = 0; x < w; x++) if (opaque(x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if (maxX < minX) { minX = 0; maxX = w - 1; top = 0; }
    const side = Math.min(w, h, Math.max(maxX - minX, h * 0.18) * 1.15);
    const sx = Math.max(0, Math.min(w - side, (minX + maxX) / 2 - side / 2)), sy = Math.max(0, top - side * 0.04);
    const out = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    const o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    o.drawImage(c, sx, sy, side, side, 0, 0, 64, 64);
    window.pet.trayIcon(out.toDataURL('image/png'));
  };
  img.src = src;
}

function baseClip(ps) {
  if (ps === 'waiting') return 'waiting';
  if (ps === 'done') return 'idle';
  if (ps === 'working') {
    const s = state.sessions.find((x) => x.state === 'working');
    return { running: 'running', checking: 'checking' }[s && s.activity] || 'thinking';
  }
  return 'idle';
}

// ---------- click-through: only the pet and bubble catch the mouse ----------
let overHit = false;
document.addEventListener('mousemove', (e) => {
  const hit = !!e.target.closest('.hit') || dragging;
  if (hit !== overHit) { overHit = hit; window.pet.setIgnoreMouse(!hit); }
});
document.addEventListener('mouseleave', () => { if (!dragging) { overHit = false; window.pet.setIgnoreMouse(true); } });

// ---------- drag the pet; a click without movement toggles the session list ----------
let dragging = false, downAt = null;
avatar.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true; downAt = { x: e.screenX, y: e.screenY, moved: false };
  window.pet.drag('start', e.screenX, e.screenY);
  avatar.style.cursor = 'grabbing';
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  if (Math.abs(e.screenX - downAt.x) + Math.abs(e.screenY - downAt.y) > 4) downAt.moved = true;
  window.pet.drag('move', e.screenX, e.screenY);
});
// Single click toggles the session list; double click brings the Claude app forward as it is.
let clickTimer = null;
document.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false; avatar.style.cursor = '';
  window.pet.drag('end');
  if (downAt.moved) return;
  clearTimeout(clickTimer);
  if (e.detail >= 2) window.pet.focusClaude();
  else clickTimer = setTimeout(onPetClick, 260);
});
$('#status').addEventListener('click', () => onPetClick());
// Right-click the pet for the same menu as the tray icon.
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('#pet')) return;
  e.preventDefault();
  window.pet.showMenu();
});

function onPetClick() {
  if (state.pending.length) return; // the ask stays up until answered
  showList = !showList;
  render();
}

// The done bubble times out: the pet calms down, the session stays unread in the list.
function endLinger() {
  state.sessions.filter((s) => s.state === 'done').forEach((s) => window.pet.lingerEnd(s.id));
}

// Sessions that need an answer, and finished sessions not opened yet.
function needsYou() {
  const asking = new Set(state.pending.map((p) => p.sessionId));
  return state.sessions.filter((s) => asking.has(s.id) || s.state === 'waiting');
}
function unread() {
  const need = new Set(needsYou().map((s) => s.id));
  return state.sessions.filter((s) => s.unread && !need.has(s.id));
}

// ---------- state ----------
function petState() {
  const ss = state.sessions;
  if (state.pending.length || ss.some((s) => s.state === 'waiting')) return 'waiting';
  if (ss.some((s) => s.state === 'working')) return 'working';
  if (ss.some((s) => s.state === 'done')) return 'done';
  return 'idle';
}

function render() {
  const ps = petState();
  document.body.dataset.state = ps;
  base = baseClip(ps);
  document.body.dataset.clip = base;
  if (ps === 'done' && lastPetState !== 'done' && !state.sessions.some((s) => s.state === 'done' && s.failed)) {
    if (prefs.confetti) celebrate();
    playOnce('done');
  }
  if (ps === 'done') {
    clearTimeout(doneTimer);
    doneTimer = setTimeout(endLinger, prefs.doneSeconds * 1000);
  }
  lastPetState = ps;

  const need = needsYou().length, unreadCount = unread().length;
  if (need > lastNeed && prefs.sound) chime();
  lastNeed = need;
  badge.className = need ? 'warn' : unreadCount ? 'ok' : 'hidden';
  badge.textContent = need ? '!' : ps === 'done' && unreadCount === 1 ? '✓' : unreadCount || '';

  const focus = state.sessions.find((s) => s.state === ps);
  const extra = [need > 1 && `${need} need you`, unreadCount && `${unreadCount} unread`].filter(Boolean).join(' · ');
  const main = focus && ps !== 'idle' ? focus.detail : extra ? '' : 'All caught up';
  statusText.textContent = [main, extra].filter(Boolean).join('  ·  ');

  renderBubble(ps);
}

function renderBubble(ps) {
  let key, build;
  if (state.pending.length) {
    const p = state.pending[0];
    key = 'ask:' + p.id + ':' + state.pending.length;
    build = () => ({ permission: permissionView, mirror: mirrorView }[p.kind] || questionView)(p);
  } else if (showList) {
    key = 'list:' + JSON.stringify(state.sessions.filter((s) => s.state !== 'idle' || s.unread).map((s) => [s.id, s.state, s.detail, s.title, s.unread]));
    build = listView;
  } else if (ps === 'done') {
    const s = state.sessions.find((x) => x.state === 'done');
    key = 'done:' + s.id + ':' + s.detail;
    build = () => doneView(s);
  } else {
    key = '';
  }
  if (key === bubbleKey) return;
  bubbleKey = key;
  bubble.classList.toggle('hidden', !key);
  bubble.replaceChildren();
  if (build) bubble.append(...build().filter((n) => n != null));
}

// ---------- bubble views ----------
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}

function who(p) {
  const more = state.pending.length > 1 ? `1 of ${state.pending.length}` : '';
  return el('div', { className: 'who' }, el('b', { textContent: p.sessionTitle || 'Claude' }), more);
}

function permissionView(p) {
  const verb = { Bash: 'run this command', PowerShell: 'run this command', Edit: 'edit this file', Write: 'write this file',
    WebFetch: 'open this page', Read: 'read this file' }[p.toolName] || `use ${p.toolName}`;
  return [
    who(p),
    el('h4', { textContent: `Claude wants to ${verb}` }),
    p.summary ? el('code', { textContent: p.summary }) : null,
    el('div', { className: 'row' },
      el('button', { className: 'primary', textContent: 'Allow', onclick: () => window.pet.answer(p.id, { type: 'allow' }) }),
      el('button', { className: 'danger', textContent: 'Deny', onclick: () => window.pet.answer(p.id, { type: 'deny' }) }),
      el('button', { className: 'link', textContent: 'Open Claude', onclick: () => window.pet.answer(p.id, { type: 'open' }) })),
  ];
}

function questionView(p) {
  const picks = p.questions.map(() => new Set());
  const others = p.questions.map(() => '');
  const submit = el('button', { className: 'primary', textContent: 'Send', disabled: true });
  const refresh = () => {
    submit.disabled = !p.questions.every((_, i) => picks[i].size || others[i].trim());
  };
  const blocks = p.questions.map((q, i) => {
    const opts = (q.options || []).map((o) => {
      const b = el('button', { className: 'opt' }, o.label, o.description ? el('small', { textContent: o.description }) : null);
      b.onclick = () => {
        if (!q.multiSelect) { picks[i].clear(); b.parentElement.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel')); }
        if (picks[i].has(o.label)) { picks[i].delete(o.label); b.classList.remove('sel'); }
        else { picks[i].add(o.label); b.classList.add('sel'); }
        // a single-question, single-choice ask sends on the first click
        if (p.questions.length === 1 && !q.multiSelect) return send();
        refresh();
      };
      return b;
    });
    const other = el('input', { type: 'text', placeholder: 'Other…' });
    other.oninput = () => { others[i] = other.value; refresh(); };
    other.onkeydown = (e) => { if (e.key === 'Enter' && !submit.disabled) send(); };
    return el('div', { className: 'q' },
      q.header ? el('div', { className: 'hdr', textContent: q.header }) : null,
      el('h4', { textContent: q.question }),
      el('div', { className: 'row' }, ...opts),
      other);
  });
  function send() {
    const answers = {};
    p.questions.forEach((q, i) => {
      const vals = [...picks[i]];
      if (others[i].trim()) vals.push(others[i].trim());
      answers[q.question] = q.multiSelect ? vals : vals.join(', ');
    });
    window.pet.answer(p.id, { type: 'answers', answers });
  }
  submit.onclick = send;
  const needsSend = p.questions.length > 1 || p.questions.some((q) => q.multiSelect);
  return [
    who(p),
    ...blocks,
    el('div', { className: 'row' },
      needsSend ? submit : null,
      el('button', { className: 'link', textContent: 'Answer in Claude', onclick: () => window.pet.answer(p.id, { type: 'open' }) })),
  ];
}

// A question Claude is asking in its own dialog: shown here so you notice, answered in Claude.
function mirrorView(p) {
  return [
    who(p),
    ...p.questions.map((q) => el('div', { className: 'q' },
      q.header ? el('div', { className: 'hdr', textContent: q.header }) : null,
      el('h4', { textContent: q.question }),
      el('ul', { className: 'opts' }, ...(q.options || []).map((o) => el('li', { textContent: o.label }))))),
    el('div', { className: 'row' },
      el('button', { className: 'primary', textContent: 'Answer in Claude', onclick: () => window.pet.answer(p.id, { type: 'open' }) }),
      el('button', { className: 'link', textContent: 'Dismiss', onclick: () => window.pet.answer(p.id, { type: 'dismiss' }) })),
  ];
}

function doneView(s) {
  return [
    el('div', { className: 'who' }, el('b', { textContent: s.title || 'Claude' }), 'Done'),
    el('p', { textContent: s.detail }),
    el('div', { className: 'row' },
      s.hostId ? el('button', { className: 'primary', textContent: 'Open session', onclick: () => window.pet.openSession(s.id) }) : null,
      el('button', { className: 'link', textContent: 'Dismiss', onclick: () => window.pet.markRead(s.id) })),
  ];
}

function listView() {
  const need = needsYou(), fresh = unread();
  const shown = new Set([...need, ...fresh].map((s) => s.id));
  const busy = state.sessions.filter((s) => s.state === 'working' && !shown.has(s.id));
  if (!need.length && !fresh.length && !busy.length) return [el('p', { textContent: 'Nothing running, and nothing needs you.' })];
  // Clicking a row opens that session in Claude; an unread row can also be dismissed with its ×.
  const dismiss = (s) => el('button', { className: 'x', title: 'Dismiss', textContent: '×',
    onclick: (e) => { e.stopPropagation(); window.pet.markRead(s.id); } });
  const row = (s, kind) => el('div', { className: 'sess', title: 'Open in Claude', onclick: () => { showList = false; window.pet.openSession(s.id); } },
    el('i', { className: kind }),
    el('div', {}, el('b', { textContent: s.title || 'Untitled session' }), el('span', { textContent: s.detail || '' })),
    kind === 'done' ? dismiss(s) : null);
  return [
    need.length ? el('div', { className: 'group', textContent: 'Needs you' }) : null,
    ...need.map((s) => row(s, 'waiting')),
    fresh.length ? el('div', { className: 'group' }, 'Unread',
      el('button', { className: 'link', textContent: 'Clear all', onclick: () => fresh.forEach((s) => window.pet.markRead(s.id)) })) : null,
    ...fresh.map((s) => row(s, 'done')),
    busy.length ? el('div', { className: 'group', textContent: 'Working' }) : null,
    ...busy.map((s) => row(s, 'working')),
  ];
}

// ---------- confetti ----------
function celebrate() {
  const box = $('#sparkles');
  const colors = ['#d97757', '#3f9b62', '#5b7fd6', '#e0b13a', '#c45fa0'];
  for (let i = 0; i < 18; i++) {
    const c = el('i');
    const a = (Math.PI * 2 * i) / 18;
    c.style.cssText = `left:60px;top:70px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * (50 + Math.random() * 30)}px;--dy:${Math.sin(a) * 60 - 30}px;animation-delay:${Math.random() * .15}s`;
    box.append(c);
    setTimeout(() => c.remove(), 1800);
  }
}

// ---------- wiring ----------
window.pet.onEffect((name) => playOnce(name));
window.pet.onState((s) => {
  state = s;
  if (s.pending.length) showList = false;
  render();
});
window.pet.getState().then((s) => { state = s; render(); });
