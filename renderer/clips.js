// Clip playback shared by the buddy (app.js) and the video wizard's preview.
// A clip is { frames: [first, last], mode: 'loop' | 'pingpong' | 'once', stroll?: turnFrame }.

const WALK_RANGE = 36; // px the character strolls each way while running tools

// The states a character can have a clip for, in the order the wizard lays them out.
const STATES = [
  { id: 'idle', label: 'Idle', mode: 'pingpong', hint: 'Standing by, breathing. Required.' },
  { id: 'thinking', label: 'Thinking', mode: 'pingpong', hint: 'Between steps.' },
  { id: 'checking', label: 'Checking', mode: 'pingpong', hint: 'Reading or searching.' },
  { id: 'running', label: 'Running', mode: 'loop', hint: 'Running commands and edits; can stroll.' },
  { id: 'waiting', label: 'Waiting', mode: 'pingpong', hint: 'Needs your answer.' },
  { id: 'hello', label: 'Hello', mode: 'once', hint: 'A wave when a session starts or asks you.' },
  { id: 'done', label: 'Done', mode: 'once', hint: 'Celebrates a finished turn.' },
  { id: 'error', label: 'Error', mode: 'once', hint: 'Something failed.' },
];

// A player steps through one clip at a time; it restarts when the clip changes.
// next() returns { frame, offset, finished } where finished is true once a "once" clip ends.
function clipPlayer() {
  let current = null, fi = 0, dir = 1;
  return {
    next(clip) {
      const [a, b] = clip.frames;
      if (clip !== current) { current = clip; fi = a; dir = 1; }
      else if (clip.mode === 'pingpong') {
        if (fi + dir > b || fi + dir < a) dir = -dir;
        fi = Math.min(b, Math.max(a, fi + dir));
      } else if (fi < b) fi++;
      else if (clip.mode === 'loop') fi = a;
      else return { frame: fi, offset: 0, finished: true };
      return { frame: fi, offset: clip.stroll ? strollOffset(clip, fi) : 0, finished: false };
    },
    reset() { current = null; },
  };
}

// A clip with "stroll": <frame> walks right until that frame, then back left.
function strollOffset(clip, f) {
  const [r, end] = clip.frames, turn = clip.stroll;
  return f < turn ? -WALK_RANGE + (2 * WALK_RANGE * (f - r)) / Math.max(1, turn - 1 - r)
    : WALK_RANGE - (2 * WALK_RANGE * (f - turn)) / Math.max(1, end - turn);
}
