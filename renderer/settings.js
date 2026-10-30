// Settings window: shows the main process's settings state and sends each change straight back.

const $ = (s) => document.querySelector(s);
let state = null;

const HOOKS_TEXT = {
  installed: ['Connected to Claude Code', 'The buddy sees your sessions. Restart open Claude sessions after connecting.', 'Reconnect'],
  partial: ['Partly connected', 'Some hooks are missing or point to another copy of Agent Buddy.', 'Repair'],
  missing: ['Not connected', 'Connect so the buddy can see your Claude Code sessions. This adds hooks to ~/.claude/settings.json (a backup is kept).', 'Connect'],
  error: ['Can’t read Claude Code settings', '~/.claude/settings.json isn’t valid JSON. Fix it, then try again.', 'Try again'],
};

function render(s) {
  state = s;
  const [title, detail, button] = HOOKS_TEXT[s.hooks] || HOOKS_TEXT.error;
  $('#hooks-title').textContent = title;
  $('#hooks-title').className = s.hooks === 'installed' ? 'status-ok' : 'status-bad';
  $('#hooks-detail').textContent = detail;
  $('#hooks-install').textContent = button;
  $('#hooks-install').className = s.hooks === 'installed' ? '' : 'primary';
  $('#hooks-remove').hidden = s.hooks === 'missing';

  $('#characters').replaceChildren(...s.characters.map((c) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.id === s.character));
    b.append(c.name);
    const kind = c.id === null ? 'Built in' : c.kind === 'frames' ? 'Animated' : 'Picture';
    b.append(Object.assign(document.createElement('small'), { textContent: kind }));
    b.onclick = () => act('character', c.id);
    return b;
  }));
  $('#edit-clips').hidden = !s.characters.some((c) => c.id === s.character && c.kind === 'frames');
  drawIconPreview(s.icon);

  $('#scale').value = Math.round(s.settings.scale * 100);
  $('#scale-value').textContent = Math.round(s.settings.scale * 100) + '%';
  $('#theme').value = s.settings.theme;
  $('#doneSeconds').value = s.settings.doneSeconds;
  $('#done-value').textContent = s.settings.doneSeconds + ' seconds';
  document.querySelectorAll('[data-setting]').forEach((el) => { el.checked = !!s.settings[el.dataset.setting]; });
  $('#shown').checked = s.shown;
  $('#startWithWindows').checked = s.startWithWindows;
  $('#version').textContent = s.version;
}

const set = async (key, value) => render(await window.buddy.set(key, value));
const act = async (name, arg) => render(await window.buddy.action(name, arg));
const refresh = async () => render(await window.buddy.get());

document.querySelectorAll('[data-setting]').forEach((el) => { el.onchange = () => set(el.dataset.setting, el.checked); });
$('#scale').oninput = () => { $('#scale-value').textContent = $('#scale').value + '%'; };
$('#scale').onchange = () => set('scale', Number($('#scale').value) / 100);
$('#doneSeconds').oninput = () => { $('#done-value').textContent = $('#doneSeconds').value + ' seconds'; };
$('#doneSeconds').onchange = () => set('doneSeconds', Number($('#doneSeconds').value));
$('#theme').onchange = () => set('theme', $('#theme').value);
$('#shown').onchange = () => act('shown', $('#shown').checked);
$('#startWithWindows').onchange = () => act('startWithWindows', $('#startWithWindows').checked);
$('#reset-position').onclick = () => act('resetPosition');
$('#hooks-install').onclick = () => act('installHooks');
$('#hooks-remove').onclick = () => act('removeHooks');
$('#new-picture').onclick = () => act('newFromPicture');
$('#new-video').onclick = () => act('newFromVideo');
$('#edit-clips').onclick = () => act('editClips');
$('#import').onclick = () => act('importCharacter');
$('#open-folder').onclick = () => act('openCharacters');

// ---------- tray icon ----------
// The icon is a square crop of the character's first idle frame (head.js). Without a saved crop,
// the head is found automatically; the dialog lets you place the square yourself.

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

let iconImg = null, iconSrc = '';
async function drawIconPreview(icon) {
  if (!icon || !icon.src) return;
  if (icon.src !== iconSrc) { iconSrc = icon.src; iconImg = await loadImage(icon.src).catch(() => null); }
  if (!iconImg) return;
  const g = $('#icon-preview').getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.drawImage(drawCrop(iconImg, icon.crop || findHead(iconImg)), 0, 0);
}

let box = null, stage = { w: 0, h: 0 }; // the square in displayed pixels, and the shown image's size
function placeBox() {
  const b = $('#crop-box');
  Object.assign(b.style, { left: box.x + 'px', top: box.y + 'px', width: box.s + 'px', height: box.s + 'px' });
  const nw = iconImg.naturalWidth, k = nw / stage.w;
  const g = $('#crop-preview').getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.drawImage(iconImg, box.x * k, box.y * k, box.s * k, box.s * k, 0, 0, 64, 64);
}
const toBox = (crop) => ({ x: crop.x * stage.w, y: crop.y * stage.h, s: crop.size * stage.w });
const fromBox = () => ({ x: box.x / stage.w, y: box.y / stage.h, size: box.s / stage.w });

$('#icon-adjust').onclick = async () => {
  if (!iconImg) return;
  const img = $('#crop-img');
  img.src = iconImg.src;
  const scale = Math.min(360 / iconImg.naturalWidth, 340 / iconImg.naturalHeight);
  stage = { w: Math.round(iconImg.naturalWidth * scale), h: Math.round(iconImg.naturalHeight * scale) };
  Object.assign(img.style, { width: stage.w + 'px', height: stage.h + 'px' });
  box = toBox(state.icon.crop || findHead(iconImg));
  $('#crop').showModal();
  placeBox();
};

// Drag the square to move it, its corner to resize it; it stays square and inside the picture.
$('#crop-box').onpointerdown = (e) => {
  e.preventDefault();
  const resize = e.target.id === 'crop-corner', start = { ...box, px: e.clientX, py: e.clientY };
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  el.onpointermove = (ev) => {
    const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
    if (resize) {
      const s = Math.max(16, Math.min(start.s + Math.max(dx, dy), stage.w - start.x, stage.h - start.y));
      box = { ...box, s };
    } else {
      box = { ...box, x: Math.max(0, Math.min(stage.w - box.s, start.x + dx)), y: Math.max(0, Math.min(stage.h - box.s, start.y + dy)) };
    }
    placeBox();
  };
  el.onpointerup = () => { el.onpointermove = el.onpointerup = null; };
};

$('#crop-auto').onclick = () => { box = toBox(findHead(iconImg)); placeBox(); };
$('#crop-cancel').onclick = () => $('#crop').close();
$('#crop-save').onclick = async () => {
  const auto = findHead(iconImg), crop = fromBox();
  // a square left where the automatic one is counts as automatic, so it follows later changes
  const same = ['x', 'y', 'size'].every((k) => Math.abs(crop[k] - auto[k]) < 0.002);
  $('#crop').close();
  render(await window.buddy.action('iconCrop', same ? null : crop));
};

window.buddy.onChanged(refresh);
window.addEventListener('focus', refresh);
refresh();
