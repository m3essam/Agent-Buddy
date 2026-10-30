# Characters

A character is a folder in `~/.agent-buddy/characters/<name>/` holding a `character.json` and its images.
There are two kinds:

- **Picture**: one image. The buddy moves it with CSS for each state (breathing, pondering, strolling, hopping,
  a jump when done). Make one with **Character → New character from a picture…**.
- **Frames**: a sequence of images with a *clip* (a range of frames) for each state. Make one with
  **Character → New character from a video…**, which cuts the frames out of a video and lets you mark the clips.

To share a character, zip its folder. Someone else can unzip it and use **Character → Import a character folder…**.

## Making a good video

- **One character, filmed whole**, from head to feet, without walking out of the frame.
- **Do each move one after another**, a few seconds each, roughly in this order:
  standing → thinking → looking something up → walking → waiting → waving → celebrating → a "whoops".
  The wizard's first guess splits the video evenly in that order. You can adjust every range afterwards,
  so the order is only a convenience.
- **Background:**
  - *Plain colour* works best: a flat wall, a backdrop, or an AI-generated character on a flat colour.
    Keep the colour different from the character's clothes and hair.
  - *Green screen* is for footage filmed against green.
  - *Any background (AI)* finds a real person in an ordinary video. It is slower and only works on people,
    not cartoons or mascots.
- **Length**: 5–30 seconds is plenty. The wizard keeps 10 frames per second, so 20 seconds gives 200 frames.

## The video wizard

1. **Cut out**: choose the video and a background option. Move *Preview at* to check a few moments, and raise
   *Tolerance* if bits of background remain (or lower it if parts of the character disappear). Trim to the part
   you want, then **Cut out frames**.
2. **States**: each row is a state. Drag a bar to move it, drag its ends to resize it, and click an empty row to
   add a bar there. Click a row to preview it. Choose how each clip plays: *Loop*, *Back and forth* or *Once*.
   On *Running*, tick *walk* to make the character stroll left and right while Claude runs tools.
   Name the character, choose its size, and **Save character**.

**Edit clips…** (in the Character menu and in Settings) reopens step 2 for the active character, so you can
re-time it without cutting it out again.

## character.json

A picture character:

```json
{ "name": "Robo", "kind": "image", "image": "avatar.png", "height": 220 }
```

A frames character, with a clip per state (frame ranges are inclusive):

```json
{
  "name": "Me",
  "kind": "frames",
  "height": 250,
  "frames": { "count": 172, "fps": 10, "file": "frames/f###.webp" },
  "clips": {
    "idle":     { "frames": [122, 136], "mode": "pingpong" },
    "thinking": { "frames": [96, 107],  "mode": "pingpong" },
    "checking": { "frames": [108, 121], "mode": "pingpong" },
    "running":  { "frames": [10, 39],   "mode": "loop", "stroll": 24 },
    "waiting":  { "frames": [80, 95],   "mode": "pingpong" },
    "hello":    { "frames": [40, 49],   "mode": "once" },
    "done":     { "frames": [50, 63],   "mode": "once" },
    "error":    { "frames": [64, 79],   "mode": "once" }
  }
}
```

- `height`: on-screen height in pixels (default 220).
- `frames.file`: the frame file pattern; `###` is the zero-padded frame number.
- `mode`: `loop`, `pingpong` (forward then back) or `once`.
- `stroll`: for the running clip, the frame where the character turns around. It walks right until that frame and back after it.
- Any state you leave out uses `idle`.

## States

| Claude is… | State |
| --- | --- |
| Idle | `idle` |
| Starting a session | `hello` (once) |
| Thinking between steps | `thinking`, plus thinking dots |
| Running commands, editing, other tools | `running` |
| Reading or searching | `checking` |
| Waiting on you | `hello`, then `waiting`, plus an orange `!` and the bubble |
| Finished a turn | `done` (once), plus confetti, a green ✓ and a summary bubble for ~9 s |
| A tool or the turn failed | `error` (once) |

## From the command line

`tools/extract.js` cuts a plain-background video into frames without the wizard:

```
node_modules\electron\dist\electron.exe tools\extract.js <video.mp4> [characterDir]
```

It writes `frames/` and a starter `character.json` with only an idle clip. Add the other clips by hand, or open
the character and use **Edit clips…**.
