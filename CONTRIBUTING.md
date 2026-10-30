# Contributing to Agent Buddy

Thanks for helping! Bug reports, ideas, characters and pull requests are all welcome.

## Run it from source

You need Windows and Node.js 20 or newer.

```
git clone https://github.com/m3essam/Agent-Buddy.git
cd Agent-Buddy
npm install
npm start
```

Quit any installed copy first: only one Agent Buddy can run at a time (they share port 47321).
In Settings, choose **Connect** so Claude Code sends its events to the copy you're running.

## Try changes without Claude

`tools/demo.js` plays made-up sessions on the running buddy, so you can see every state without waiting for Claude:

```
npm run demo                     # the whole tour
node tools/demo.js question      # one scene: working | checking | question | permission | done | unread | clear
node tools/demo.js shots         # the tour, saving the README screenshots to docs/images (source runs only)
```

When run from source (not installed), the app also accepts a few `/dev/…` requests that the demo uses for
screenshots. `AGENT_BUDDY_TEST_VIDEO=<path>` makes the video wizard skip its file dialog.

## How it fits together

| File | What it does |
| --- | --- |
| `main.js` | Main process: the local HTTP server that Claude Code's hooks post to, session state, the tray, and the windows |
| `install-hooks.js` | Adds or removes the HTTP hooks in `~/.claude/settings.json` |
| `renderer/app.js`, `style.css` | The buddy window: animation, badge and speech bubble |
| `renderer/clips.js` | Clip playback, shared by the buddy and the wizard preview |
| `renderer/settings.*` | The settings window |
| `renderer/video-wizard.*` | The "New character from a video" wizard |
| `renderer/extract-core.js` | Background removal (plain colour, green screen, AI mask helpers), shared with `tools/extract.html` |
| `assets/placeholder/` | The built-in robot |
| `assets/vision/` | The person-segmentation model the wizard's AI mode uses (MediaPipe selfie segmenter, Apache-2.0) |

The hook flow, events and character format are described in the [README](README.md) and [docs/characters.md](docs/characters.md).

## Pull requests

- Keep changes focused, and match the style around them: plain JavaScript, no framework, short comments that say *why*.
- `node --check` each changed file. CI does this too and also packages the app.
- For anything you can see, attach a before/after screenshot. The demo script makes this easy.
- Never commit a token, your `~/.agent-buddy` folder, or a character made from someone else's likeness without their OK.

## Releases (maintainers)

1. Bump `version` in `package.json` and commit.
2. `git tag v<version>` and `git push origin v<version>`.
3. The **Release** workflow builds `Agent-Buddy-Setup-<version>.exe` and publishes it. Installed copies pick it up automatically.
