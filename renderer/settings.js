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
$('#import').onclick = () => act('importCharacter');
$('#open-folder').onclick = () => act('openCharacters');

window.buddy.onChanged(refresh);
window.addEventListener('focus', refresh);
refresh();
