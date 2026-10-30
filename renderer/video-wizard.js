// Video wizard: cuts a character out of one video (extract-core.js), then lets you mark which
// frames play for each state (clips.js) and saves a frames character. In "edit" mode it opens
// straight on the second step for the active character.

const FPS = 10;          // frames kept per second of video
const WORK_H = 960;      // videos are processed at most this tall
const OUT_H = 512;       // saved frames are at most this tall (about twice the on-screen size)
const THUMB_W = 28;      // px per frame on the timeline at most, and the width of a filmstrip thumbnail
const COLOURS = ['#7d8a99', '#5b7fd6', '#3d9bb3', '#d97757', '#e0892f', '#c45fa0', '#3f9b62', '#c4473a'];
const $ = (s) => document.querySelector(s);

let mode = 'new', editCharacter = null;
let video = null, videoInfo = null;    // the chosen video (an element on a blob URL)
let frameUrls = [], frameBlobs = [];    // the cut-out frames
let clips = {}, selected = 'idle';
let fps = FPS;                          // the frames' rate (an edited character keeps its own)
let cancelled = false;

// ---------- step switching ----------
function show(step) {
  $('#cut').hidden = step !== 'cut';
  $('#states').hidden = step !== 'states';
  document.querySelectorAll('#steps li').forEach((li) => li.classList.toggle('on', li.dataset.step === step));
}

// ---------- step 1: the video ----------
const seek = (t) => new Promise((r) => { video.onseeked = r; video.currentTime = Math.min(t, video.duration - 0.01); });
const bgMode = () => document.querySelector('input[name=mode]:checked').value;
const trim = () => ({ start: Number($('#trim-start').value) || 0, end: Number($('#trim-end').value) || video.duration });

$('#pick').onclick = async () => {
  const r = await window.wizard.pickVideo();
  if (!r) return;
  if (r.error) return showCutError(r.error);
  showCutError('');
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto';
  v.src = URL.createObjectURL(new Blob([r.bytes], { type: r.type }));
  try {
    await new Promise((ok, fail) => { v.onloadeddata = ok; v.onerror = fail; });
  } catch {
    return showCutError('This video can’t be read. Export it as an MP4 (H.264) and try again.');
  }
  if (video) URL.revokeObjectURL(video.src);
  video = v;
  const scale = Math.min(1, WORK_H / v.videoHeight);
  videoInfo = { name: r.name, W: Math.round(v.videoWidth * scale), H: Math.round(v.videoHeight * scale) };
  $('#video-info').textContent = `${r.name} · ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(1)} s`;
  for (const id of ['#trim-start', '#trim-end', '#scrub']) $(id).disabled = false;
  $('#trim-start').max = $('#trim-end').max = v.duration.toFixed(1);
  $('#trim-start').value = 0; $('#trim-end').value = v.duration.toFixed(1);
  $('#scrub').max = v.duration.toFixed(2); $('#scrub').value = Math.min(1, v.duration / 3).toFixed(2);
  $('#extract').disabled = false;
  $('#cut-empty').hidden = true;
  $('#name').value = r.name.replace(/[-_]+/g, ' ').slice(0, 40);
  bg = null;
  previewCut();
};

function showCutError(msg) { $('#cut-error').textContent = msg; $('#cut-error').hidden = !msg; }

// AI mode: MediaPipe's person segmenter, loaded on first use from the app's own files.
let segmenter = null;
async function getSegmenter() {
  if (segmenter) return segmenter;
  const { FilesetResolver, ImageSegmenter } = await import('../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('buddy://app/node_modules/@mediapipe/tasks-vision/wasm');
  segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: 'buddy://app/assets/vision/selfie_segmenter.tflite', delegate: 'CPU' },
    runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
  });
  return segmenter;
}

// The person mask at the canvas's size (the segmenter may answer at another size).
async function personMask(canvas) {
  const seg = await getSegmenter();
  const res = seg.segment(canvas);
  const m = res.confidenceMasks[0], mw = m.width, mh = m.height, src = m.getAsFloat32Array();
  const { width: W, height: H } = canvas;
  let out = src;
  if (mw !== W || mh !== H) {
    out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = src[((y * mh / H) | 0) * mw + ((x * mw / W) | 0)];
  }
  res.close();
  return out;
}

const work = document.createElement('canvas');
const wx = work.getContext('2d', { willReadFrequently: true });
let bg = null; // plain-colour mode: the background colour, taken from the first frame of the trim

// Draw the video at time t and remove its background; leaves the result on the work canvas.
async function cutFrame(t) {
  const { W, H } = videoInfo;
  if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
  await seek(t);
  wx.clearRect(0, 0, W, H);
  wx.drawImage(video, 0, 0, W, H);
  const im = wx.getImageData(0, 0, W, H), tol = Number($('#tolerance').value), m = bgMode();
  if (m === 'colour') {
    if (!bg) bg = cornerBackground(im);
    const mask = $('#shadow').checked ? await personMask(work) : null; // before keying: the AI sees the original
    keyColour(im, bg, tol);
    if (mask) clearShadows(im, mask, bg);
  }
  else if (m === 'green') keyGreen(im, tol);
  else applyMask(im, await personMask(work));
  wx.putImageData(im, 0, 0);
  return im;
}

// Show the cut-out at the scrub position; quick changes only redraw once.
let previewBusy = false, previewAgain = false;
async function previewCut() {
  if (!video) return;
  if (previewBusy) { previewAgain = true; return; }
  previewBusy = true;
  try {
    if (bgMode() === 'colour' && !bg) { await cutBackground(); }
    await cutFrame(Number($('#scrub').value));
    const c = $('#cut-preview');
    c.width = work.width; c.height = work.height;
    c.getContext('2d').drawImage(work, 0, 0);
    $('#scrub-value').textContent = Number($('#scrub').value).toFixed(1) + ' s';
  } catch (e) {
    showCutError(bgMode() === 'ai' ? 'The AI background remover couldn’t start: ' + e.message : String(e.message || e));
  }
  previewBusy = false;
  if (previewAgain) { previewAgain = false; previewCut(); }
}

// The background colour comes from the first frame of the trimmed clip.
async function cutBackground() {
  const { W, H } = videoInfo;
  work.width = W; work.height = H;
  await seek(trim().start + 0.02);
  wx.drawImage(video, 0, 0, W, H);
  bg = cornerBackground(wx.getImageData(0, 0, W, H));
}

document.querySelectorAll('input[name=mode]').forEach((r) => {
  r.onchange = () => {
    $('#tolerance-field').hidden = bgMode() === 'ai';
    $('#shadow-field').hidden = bgMode() !== 'colour';
    showCutError(''); previewCut();
  };
});
$('#tolerance').oninput = previewCut;
$('#shadow').onchange = previewCut;
$('#scrub').oninput = previewCut;
$('#trim-start').onchange = () => { bg = null; previewCut(); };

function progress(done, total, label) {
  $('#progress').hidden = false;
  $('#progress .bar i').style.width = Math.round((100 * done) / total) + '%';
  $('#progress-text').textContent = label;
}

$('#cancel').onclick = () => { cancelled = true; };

$('#extract').onclick = async () => {
  const { start, end } = trim();
  const count = Math.floor((end - start) * FPS);
  if (count < 2) return showCutError('The trimmed part is too short.');
  cancelled = false; showCutError('');
  $('#extract').disabled = $('#pick').disabled = true; $('#cancel').hidden = false;
  try {
    if (bgMode() === 'colour') await cutBackground();
    // Pass 1: cut out every frame and find the widest extent of the figure, so no pose is clipped.
    const keyed = [];
    let bounds = null;
    for (let i = 0; i < count; i++) {
      if (cancelled) throw new Error('cancelled');
      progress(i, count * 1.25, `Cutting out frame ${i + 1} of ${count}…`);
      bounds = unionBounds(bounds, alphaBounds(await cutFrame(start + i / FPS + 0.02)));
      keyed.push(await new Promise((r) => work.toBlob(r, 'image/webp', 0.95)));
    }
    if (!bounds) throw new Error('No character was found. Try another background option or a higher tolerance.');
    // Pass 2: crop to the figure and scale down.
    const crop = cropRect(bounds, videoInfo.W, videoInfo.H), OH = Math.min(OUT_H, crop.h), OW = Math.round((crop.w * OH) / crop.h);
    const out = Object.assign(document.createElement('canvas'), { width: OW, height: OH }), ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high';
    frameUrls.forEach((u) => URL.revokeObjectURL(u));
    frameBlobs = []; frameUrls = [];
    for (let i = 0; i < count; i++) {
      if (cancelled) throw new Error('cancelled');
      progress(count + i / 4, count * 1.25, 'Cropping…');
      const bmp = await createImageBitmap(keyed[i]);
      ox.clearRect(0, 0, OW, OH);
      ox.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, OW, OH);
      bmp.close();
      const blob = await new Promise((r) => out.toBlob(r, 'image/webp', 0.9));
      frameBlobs.push(blob); frameUrls.push(URL.createObjectURL(blob));
    }
    clips = evenSplit(count);
    openStates();
  } catch (e) {
    if (e.message !== 'cancelled') showCutError(String(e.message || e));
  } finally {
    $('#progress').hidden = true;
    $('#extract').disabled = $('#pick').disabled = false; $('#cancel').hidden = true;
  }
};

// ---------- step 2: states ----------
// Starting point: the video split evenly, one part per state in order.
function evenSplit(count) {
  const out = {}, n = STATES.length, len = Math.max(1, Math.floor(count / n));
  STATES.forEach((s, k) => {
    const a = Math.min(count - 1, k * len), b = k === n - 1 ? count - 1 : Math.min(count - 1, (k + 1) * len - 1);
    out[s.id] = { frames: [a, b], mode: s.mode };
  });
  out.running.stroll = Math.round((out.running.frames[0] + out.running.frames[1]) / 2);
  return out;
}

function openStates() {
  show('states');
  $('#back').hidden = mode === 'edit';
  buildLanes();
  layout();
}

// The whole video fits the timeline's width (scrolling only when frames would get thinner than 3px);
// the filmstrip shows every few frames so its thumbnails stay readable.
let tw = THUMB_W; // px per frame
function layout() {
  const n = frameCount();
  if (!n || $('#states').hidden) return;
  tw = Math.max(3, Math.min(THUMB_W, $('#scroller').clientWidth / n));
  const every = Math.ceil(THUMB_W / tw), thumbs = [];
  for (let i = 0; i < n; i += every) {
    thumbs.push(el('img', { src: frameUrls[i], title: `Frame ${i} · ${(i / fps).toFixed(1)} s`, draggable: false,
      style: `left:${i * tw}px;width:${every * tw}px` }));
  }
  $('#strip').replaceChildren(...thumbs);
  $('#lanes').style.width = $('#strip').style.width = n * tw + 'px';
  refresh();
}
window.addEventListener('resize', layout);

const frameCount = () => frameUrls.length;

function buildLanes() {
  const heads = [], tracks = [];
  STATES.forEach((s, k) => {
    const colour = COLOURS[k];
    const modeSel = Object.assign(document.createElement('select'), { title: 'How the frames play' });
    for (const [v, l] of [['loop', 'Loop'], ['pingpong', 'Back and forth'], ['once', 'Once']]) modeSel.append(new Option(l, v));
    modeSel.onchange = () => { if (clips[s.id]) { clips[s.id].mode = modeSel.value; refresh(); } };
    modeSel.onclick = (e) => e.stopPropagation();
    const head = el('div', { className: 'lane-head', title: s.hint },
      el('i', { style: `background:${colour}` }), el('b', { textContent: s.label }), modeSel);
    if (s.id === 'running') {
      const stroll = Object.assign(document.createElement('input'), { type: 'checkbox', title: 'Walk left and right while running' });
      stroll.onchange = () => { const c = clips.running; if (c) { if (stroll.checked) c.stroll = Math.round((c.frames[0] + c.frames[1]) / 2); else delete c.stroll; refresh(); } };
      stroll.onclick = (e) => e.stopPropagation();
      head.append(el('label', { title: 'Walk left and right while running' }, stroll, 'walk'));
      head._stroll = stroll;
    }
    head._mode = modeSel;
    head.onclick = () => select(s.id);
    const track = el('div', { className: 'track' });
    track.onpointerdown = (e) => onTrackDown(e, s, track);
    heads.push(head); tracks.push(track);
  });
  $('#lanes-head').replaceChildren(...heads);
  $('#lanes').replaceChildren(...tracks);
  refresh();
}

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  if (props.style) e.style.cssText = props.style;
  e.append(...kids.filter((k) => k != null));
  return e;
}

// Redraw every lane's bar from `clips`.
function refresh() {
  const heads = $('#lanes-head').children, tracks = $('#lanes').children;
  STATES.forEach((s, k) => {
    const c = clips[s.id], head = heads[k], track = tracks[k];
    head.classList.toggle('on', s.id === selected);
    track.classList.toggle('on', s.id === selected);
    head._mode.value = c ? c.mode : s.mode;
    head._mode.disabled = !c;
    if (head._stroll) { head._stroll.checked = !!(c && c.stroll != null); head._stroll.disabled = !c; }
    track.replaceChildren();
    if (!c) return;
    const [a, b] = c.frames, w = (b - a + 1) * tw, span = `${(a / fps).toFixed(1)}–${((b + 1) / fps).toFixed(1)} s`;
    // a narrow bar drops its label (kept as a tooltip), then its remove button
    const bar = el('div', { className: 'range', title: span, style: `left:${a * tw}px;width:${w}px;background:${COLOURS[k]}` },
      el('span', { className: 'h l' }), w >= 76 ? span : '', el('span', { className: 'h r' }),
      s.id === 'idle' || w < 44 ? null : el('span', { className: 'x', title: 'Remove', textContent: '×' }));
    track.append(bar);
  });
  const c = clips[selected];
  $('#player-state').textContent = STATES.find((s) => s.id === selected).label;
  $('#player-range').textContent = c ? `· frames ${c.frames[0]}–${c.frames[1]}` : '· no frames: uses Idle';
}

function select(id) { selected = id; player.reset(); refresh(); }

// Drag a bar to move it, its ends to resize it; press on an empty row to add a bar there.
function onTrackDown(e, s, track) {
  select(s.id);
  const n = frameCount(), at = (ev) => Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - track.getBoundingClientRect().left) / tw)));
  const f = at(e), t = e.target;
  if (t.classList.contains('x')) { delete clips[s.id]; return refresh(); }
  let c = clips[s.id], kind;
  if (t.classList.contains('h')) kind = t.classList.contains('l') ? 'l' : 'r';
  else if (t.closest('.range')) kind = 'move';
  else { c = clips[s.id] = { frames: [f, Math.min(n - 1, f + 9)], mode: c ? c.mode : s.mode }; kind = 'r'; refresh(); }
  const [a0, b0] = c.frames, grab = f;
  try { track.setPointerCapture(e.pointerId); } catch {} // keeps the drag going outside the row
  track.onpointermove = (ev) => {
    const g = at(ev);
    if (kind === 'l') c.frames = [Math.min(g, c.frames[1]), c.frames[1]];
    else if (kind === 'r') c.frames = [c.frames[0], Math.max(g, c.frames[0])];
    else { const d = Math.max(-a0, Math.min(n - 1 - b0, g - grab)); c.frames = [a0 + d, b0 + d]; }
    if (c.stroll != null) c.stroll = Math.round((c.frames[0] + c.frames[1]) / 2);
    player.reset();
    refresh();
  };
  track.onpointerup = () => { track.onpointermove = track.onpointerup = null; };
}

$('#even').onclick = () => { clips = evenSplit(frameCount()); player.reset(); refresh(); };
$('#back').onclick = () => show('cut');
$('#height').oninput = () => { $('#height-value').textContent = $('#height').value + ' px'; $('#player').style.height = Math.min(240, Number($('#height').value)) + 'px'; };

// Preview: plays the selected state the way the buddy will.
const player = clipPlayer();
(function play() {
  setTimeout(play, 1000 / fps);
  if ($('#states').hidden || !frameCount()) return;
  const step = player.next(clips[selected] || clips.idle);
  if (step.finished) player.reset(); // replay one-shot states
  $('#player').src = frameUrls[step.frame];
  $('#player').style.marginLeft = step.offset + 'px';
})();

$('#save').onclick = async () => {
  if (!clips.idle) return;
  const name = $('#name').value.trim() || 'My buddy';
  const keep = Object.fromEntries(Object.entries(clips).map(([k, c]) => [k, { ...c, frames: [...c.frames] }]));
  const character = { name, height: Number($('#height').value), clips: keep };
  $('#save').disabled = true;
  try {
    if (mode === 'edit') await window.wizard.save({ character, frames: null });
    else {
      character.frames = { fps: FPS };
      await window.wizard.save({ character, frames: await Promise.all(frameBlobs.map((b) => b.arrayBuffer())) });
    }
  } finally { $('#save').disabled = false; }
};

// ---------- start ----------
window.wizard.init().then((init) => {
  mode = init.mode;
  $('#height').oninput();
  if (mode !== 'edit') return show('cut');
  editCharacter = init.character;
  document.title = $('#title').textContent = 'Edit clips: ' + (editCharacter.name || 'character');
  $('#steps').hidden = true;
  const f = editCharacter.frames;
  fps = f.fps || FPS;
  const digits = (f.file.match(/#+/) || ['###'])[0];
  frameUrls = Array.from({ length: f.count }, (_, i) => editCharacter.base + f.file.replace(digits, String(i).padStart(digits.length, '0')));
  clips = JSON.parse(JSON.stringify(editCharacter.clips || {}));
  if (!clips.idle) clips.idle = { frames: [0, f.count - 1], mode: 'loop' };
  $('#name').value = editCharacter.name || '';
  // the built-in character keeps its name; its edits can be undone
  $('#name').disabled = init.builtIn;
  if (init.builtIn) document.title = $('#title').textContent = 'Edit clips: Default buddy';
  $('#restore').hidden = !(init.builtIn && init.edited);
  $('#height').value = editCharacter.height || 220; $('#height').oninput();
  openStates();
});

$('#restore').onclick = () => window.wizard.resetDefault();
