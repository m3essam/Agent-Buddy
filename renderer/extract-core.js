// Background removal for the video cutter, shared by the video wizard and tools/extract.html.
// Every function works on canvas ImageData in place: RGB stays, alpha becomes the figure's mask.

const PAD = 12; // px of margin kept around the figure when cropping

// The background colour: the median of small patches in the four corners.
function cornerBackground(img) {
  const { data, width: w, height: h } = img, P = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const ch = [[], [], []];
  for (const [x0, y0] of [[0, 0], [w - P, 0], [0, h - P], [w - P, h - P]]) {
    for (let y = y0; y < y0 + P; y++) for (let x = x0; x < x0 + P; x++) {
      const i = (y * w + x) * 4;
      ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]);
    }
  }
  return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
}

// Tolerance 0..1 maps to the flood-fill thresholds (sum of RGB distance from the background).
const thresholds = (tolerance) => {
  const lo = Math.round(4 + tolerance * 24);
  return { lo, hi: lo + Math.round(20 + tolerance * 50), ring: 120 };
};

// Plain background: flood-fill it in from the edges, so light clothing inside the figure survives.
function keyColour(img, bg, tolerance = 0.3) {
  const { data: d, width: W, height: H } = img, N = W * H, { lo: LO, hi: HI, ring: RING_HI } = thresholds(tolerance);
  const diff = new Float32Array(N), seen = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    diff[p] = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
  }
  const st = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const p = st.pop();
    if (seen[p] || diff[p] > HI) continue;
    seen[p] = 1;
    if (diff[p] <= LO) {
      const x = p % W, y = (p / W) | 0;
      if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1);
      if (y > 0) st.push(p - W); if (y < H - 1) st.push(p + W);
    }
  }
  // Remove the background's share of a part-transparent pixel's colour (no light halo).
  const unblend = (p, a) => {
    for (let c = 0; c < 3; c++) d[p * 4 + c] = Math.max(0, Math.min(255, (d[p * 4 + c] - bg[c] * (1 - a)) / a));
    d[p * 4 + 3] = Math.round(255 * a);
  };
  for (let p = 0; p < N; p++) {
    if (!seen[p]) continue;
    if (diff[p] <= LO) { d[p * 4 + 3] = 0; continue; }
    unblend(p, (diff[p] - LO) / (HI - LO));
  }
  // The figure's outermost ring still blends into the background: soften it with a wider range.
  for (let p = 0; p < N; p++) {
    if (seen[p]) continue;
    const x = p % W, y = (p / W) | 0;
    const edge = (x > 0 && seen[p - 1]) || (x < W - 1 && seen[p + 1]) || (y > 0 && seen[p - W]) || (y < H - 1 && seen[p + W]);
    if (!edge || diff[p] >= RING_HI) continue;
    unblend(p, Math.max(0.05, (diff[p] - LO) / (RING_HI - LO)));
  }
  return img;
}

// Green screen: transparency from how much green outweighs red and blue, then the green spill is removed.
function keyGreen(img, tolerance = 0.3) {
  const d = img.data, t0 = 10 + tolerance * 30, t1 = t0 + 40;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], other = Math.max(r, b), spill = g - other;
    const a = spill <= t0 ? 1 : spill >= t1 ? 0 : 1 - (spill - t0) / (t1 - t0);
    if (spill > 0) d[i + 1] = other;
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  return img;
}

// AI mode: a person mask (0..1 per pixel, same size as img) from the segmenter, with a soft edge.
function applyMask(img, mask, edge = 0.25) {
  const d = img.data, lo = 0.5 - edge / 2;
  for (let p = 0; p < mask.length; p++) {
    const a = Math.max(0, Math.min(1, (mask[p] - lo) / edge));
    d[p * 4 + 3] = Math.round(d[p * 4 + 3] * a);
  }
  return img;
}

// Plain colour plus the person mask: a floor shadow, or background trapped between the legs, is close to
// the background colour but outside the person, so it goes; the figure keeps the plain-colour cut's crisp
// edges, and dark details the mask misses (shoes, fingers) stay because they are far from the background.
function clearShadows(img, mask, bg, maxDiff = 130) {
  const d = img.data;
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (mask[p] >= 0.35 || !d[i + 3]) continue;
    const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    if (diff < maxDiff) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (mask[p] - 0.15) / 0.2));
  }
  return img;
}

// Box around the opaque pixels, or null when the frame is empty.
function alphaBounds(img, threshold = 40) {
  const { data: d, width: W, height: H } = img;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (d[(y * W + x) * 4 + 3] > threshold) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

const unionBounds = (a, b) => (!a ? b : !b ? a : {
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
});

// The crop rectangle (with padding) for a figure's bounds inside a W x H frame.
function cropRect(bounds, W, H) {
  const x = Math.max(0, bounds.minX - PAD), y = Math.max(0, bounds.minY - PAD);
  return { x, y, w: Math.min(W, bounds.maxX + PAD) - x, h: Math.min(H, bounds.maxY + PAD) - y };
}
