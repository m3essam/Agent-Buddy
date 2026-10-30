// Finds the character's head in a frame, for the tray icon. Shared by the buddy (app.js) and the
// tray-icon crop editor in Settings. A crop is { x, y, size } as fractions of the frame's width
// (x, size) and height (y), so it fits every frame of a character whatever their pixel size.

// The head runs from the top of the opaque pixels down to the neck: the first row, past the widest
// part, that is much narrower than the head.
function findHead(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  let px;
  try { px = g.getImageData(0, 0, w, h).data; } catch { return { x: 0, y: 0, size: 1 }; }
  const rows = [];
  for (let y = 0; y < h * 0.7; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) { if (a < 0) a = x; b = x; }
    rows.push(a < 0 ? null : [a, b]);
  }
  const top = rows.findIndex(Boolean);
  if (top < 0) return { x: 0, y: 0, size: 1 };
  let widest = 0, bottom = -1, minX = w, maxX = 0;
  for (let y = top; y < rows.length; y++) {
    const r = rows[y];
    const width = r ? r[1] - r[0] : 0;
    if (y - top > h * 0.06 && width < widest * 0.6) { bottom = y; break; } // the neck
    if (r) { widest = Math.max(widest, width); minX = Math.min(minX, r[0]); maxX = Math.max(maxX, r[1]); }
  }
  if (bottom < 0) bottom = Math.min(rows.length, top + Math.round(h * 0.25)); // no neck found: the top quarter
  const side = Math.min(w, h, Math.max(maxX - minX, bottom - top) * 1.12);
  const cx = (minX + maxX) / 2, cy = (top + bottom) / 2;
  const x = Math.max(0, Math.min(w - side, cx - side / 2)), y = Math.max(0, Math.min(h - side, cy - side / 2));
  return { x: x / w, y: y / h, size: side / w };
}

// Draws the crop of img into a size x size canvas and returns it.
function drawCrop(img, crop, size = 64) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const out = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const o = out.getContext('2d');
  o.imageSmoothingQuality = 'high';
  const s = crop.size * w;
  o.drawImage(img, crop.x * w, crop.y * h, s, s, 0, 0, size, size);
  return out;
}
