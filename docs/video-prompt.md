# Make your avatar video with AI

You don't have to film yourself. Upload a photo of yourself (or anyone who agreed to it) to an AI video
generation tool, such as Google Gemini (Veo), Seedance, Kling, Runway, Sora or similar, together with the prompt
below. Then turn the video into your buddy with **Character → New character from a video…**.

The prompt asks for everything the video wizard needs: one character, a plain background, the whole body in
frame, and one clearly separate move for each state.

## The prompt

Copy it as is, then change the details in the last line (blazer, beard, glasses) to match your photo.

```text
Photorealistic 3D bobblehead caricature avatar based on the reference image, featuring an oversized expressive head, compact body, and realistic textures, centered against a solid, plain, clean chroma key green screen background with no text or UI labels. The character cycles through distinct, isolated assistant states using stepped, low frame rate animation (animating on twos/threes at 8–12 fps, stop-motion / choppy sprite playback, avoiding smooth easing, fluid interpolation, or soft blending). Each state is held for an extended duration with a clear, deliberate pause between transitions to provide ample time for cutting individual frame sequences:

1. Relaxed: Standing centered with an extended holding period, hands tucked comfortably inside blazer pockets, subtle stepped breathing idle.
2. Moving right: Full profile facing right, brisk stepped running-in-place animation held in a distinct block.
3. Moving left: Full profile facing left, matching the stepped running-in-place animation held clearly.
4. Greeting: Facing forward, one hand raised giving a snappy, friendly waving gesture held as an isolated pose.
5. Celebration: Cheerful celebratory hop/bounce with bent knees, elbows tucked, and pumped fists, held as a distinct segment.
6. Error / Disappointed: Hands in pockets, head tilted slightly down with a somber, frowning expression held steadily.
7. Waiting / Offering: Standing upright, one open hand extended forward toward the camera in an inviting gesture held as a distinct pose.
8. Thinking: One arm crossed, hand resting under the chin, head tilted up with eyes directed sideways in thought, held for an extended pause.
9. Inspecting: Neutral standing posture, hands in pockets, looking directly forward with a calm, focused gaze held steadily at the end.

Vertical full-body portrait framing (9:16) completely showing the entire character from top of head to shoes with generous padding at the top and bottom, photo-puppet cutout aesthetic, sharp silhouette edges against the green screen background, consistent studio lighting, no floor shadows, and strict adherence to the facial fidelity, bald head, dark glasses, beard, and wardrobe details from the reference image across all frames.
```

## Tips

- **Short clips:** many tools make 5–10 second clips. Generate a few (for example states 1–3, 4–6 and 7–9), then join
  them in any video editor, or the Windows Clipchamp app, before opening the result in the wizard.
- **Background:** in the wizard, keep **Plain colour**. The off-white background cuts out cleanly. If bits of
  background remain around the edges, raise *Tolerance* a little. Tools often add a soft floor shadow despite the
  prompt; tick **Remove floor shadow** to clear it.
- **One person only:** some tools cut to a different character partway through. Leave those frames out of every
  state's bar.
- **Same person every time:** if a clip drifts from your face or outfit, regenerate it rather than mixing in a
  different-looking one. The buddy switches between clips constantly, so any difference shows.

## Which move goes with which state

In the wizard's **States** step, drag each bar onto the matching move in your video:

| Move in the video | Agent Buddy state | Suggested playback |
| --- | --- | --- |
| 1. Relaxed | **Idle** | Back and forth |
| 2 + 3. Moving right, then left | **Running** (one bar over both) | Loop, with *walk* ticked |
| 4. Greeting | **Hello** | Once |
| 5. Celebration | **Done** | Once |
| 6. Error / Disappointed | **Error** | Once |
| 7. Waiting / Offering | **Waiting** | Back and forth |
| 8. Thinking | **Thinking** | Back and forth |
| 9. Inspecting | **Checking** | Back and forth |

For Running, one bar covering both "moving right" and "moving left" makes the buddy run to the right, turn
around, and run back while Claude works.

See [characters.md](characters.md) for more on the wizard and the character format.
