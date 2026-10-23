# Agent Buddy

**A desktop companion for Claude Code.** Your own character stands on your desktop and shows what your
Claude desktop (Code tab) sessions are doing. When a session needs you, it can take your answer to a
permission prompt or a question straight from its speech bubble.

Agent Buddy is an independent project. It is not made by or affiliated with Anthropic.

## Install

Download `Agent-Buddy-Setup-<version>.exe` and run it. It installs for your user only (no admin rights)
and starts with Windows by default; untick that in the tray menu or Settings.

The installer isn't code-signed yet, so Windows SmartScreen may warn the first time:
choose **More info → Run anyway**.

## Use

- **Connect to Claude Code once:** Settings → *Connect*. This adds HTTP hooks to `~/.claude/settings.json`
  (a backup is kept); Claude Code then posts each session event to Agent Buddy on `127.0.0.1`.
  Nothing else is installed: no Node.js needed. New Claude sessions pick the hooks up; restart open ones.
- **Drag** the buddy anywhere; **click** it for the session list; **right-click** it (or the tray icon) for the menu.

## Settings

Tray or right-click → **Settings…** (it also opens on first run):

| Section | What you can change |
| --- | --- |
| Connection | Connect or disconnect the Claude Code hooks |
| Character | Pick, create or import your character |
| Look | Size (60–160%), bubble theme (match Windows, light, dark) |
| Behaviour | Show or hide the buddy, quiet mode (only appear when a session needs you or finishes), a chime when Claude needs you, confetti, how long the "done" bubble stays, reset position |
| Answering from the bubble | Answer Claude's questions; allow or deny commands and edits (**off by default**: when off, the buddy tells you Claude needs your OK and you answer in Claude) |
| Sessions | Also follow Claude Code in a terminal or editor, not only the desktop app |
| System | Start with Windows |

Settings are saved in `~/.agent-buddy/config.json`.

## Your character

Agent Buddy ships without a character, only a placeholder robot. Make your own from the
**Character** menu:

- **New character from a picture…** One image (PNG with a transparent background works best).
  The buddy gives it a movement for each state: breathing, pondering, strolling, hopping, a jump when done.
- **Import a character folder…** A folder someone shared with you that holds a `character.json`.
- **From a video:** `node_modules\electron\dist\electron.exe tools\extract.js <video.mp4>` cuts the
  figure out of a video on a plain background into frames, then you set which frames play for each state.

Characters live in `~/.agent-buddy/characters/<name>/`. The tray icon is drawn from your character's head.

### character.json

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
- `mode`: `loop`, `pingpong` (forward then back) or `once`.
- `stroll`: for a walking clip, the frame where the character turns around; it walks right until then and back after.
- Any state you leave out uses `idle`.

## States

| Claude is… | State |
| --- | --- |
| Idle | `idle` |
| Starting a session | `hello` (once) |
| Thinking between steps | `thinking` + thinking dots |
| Running commands, editing, other tools | `running` |
| Reading or searching | `checking` |
| Waiting on you | `hello`, then `waiting` + orange `!` + bubble (Allow / Deny / answer / *Open Claude*) |
| Finished a turn | `done` (once) + confetti + green ✓, summary bubble for ~9s |
| A tool or the turn failed | `error` (once) |

If you don't answer within ~55s, or click *Open Claude*, Claude falls back to its normal dialog.
If Agent Buddy isn't running, the hooks do nothing.

## How it works

Claude Code's HTTP hooks post each event to `http://127.0.0.1:47321/hook`, with a random token kept in
`~/.agent-buddy/token` and two headers filled from Claude Code's environment: which app the session runs
in (`CLAUDE_CODE_ENTRYPOINT`, so terminal sessions can be skipped) and the desktop session id (to open it
from the bubble). For permission prompts and questions, Agent Buddy holds the request until you answer
in the bubble and replies with the hook decision; with no answer, Claude asks you as usual.
If Agent Buddy isn't running, Claude Code carries on normally. Nothing leaves your computer.

## Build from source

```
npm install
npm start            # run from source
npm run dist         # build dist/Agent-Buddy-Setup-<version>.exe
```

`npm run icon` re-renders `build/icon.png` from the placeholder robot.
