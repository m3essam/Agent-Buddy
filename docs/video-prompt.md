# Make your avatar video with AI

You don't have to film yourself. Upload a photo of yourself (or anyone who agreed to it) to an AI video
generation tool, such as Google Gemini (Veo), Seedance, Kling, Runway, Sora or similar, together with the prompt
below. Then turn the video into your buddy with **Character → New character from a video…**.

The prompt asks for everything the video wizard needs: one character, a plain background, the whole body in
frame, and one clearly separate move for each state.

## The prompt

Copy it as is, then change the details in the last line (blazer, beard, glasses) to match your photo.

```text
Traditional stop-motion puppet animation (shot at 8-12 fps with choppy, stepped keyframes and zero smooth interpolation), featuring a photorealistic 3D bobblehead caricature avatar based strictly on the reference image. Oversized expressive head, compact body, realistic textures, centered against a solid chroma key green screen with no text, UI labels, or floor shadows.

The character must cycle through the following 8 states in this exact order, holding each pose firmly with an extended pause between transitions for easy frame cutting:

1. Idle: Centered neutral posture, subtle stepped breathing.
2. Thinking: One arm crossed, hand under chin, head tilted up with eyes sideways.
3. Running Right: Full profile facing right, choppy running-in-place.
4. Running Left: Full profile facing left, choppy running-in-place.
5. Waiting / Offering: Upright stance, one open hand extended forward invitingly.
6. Greeting: Facing forward, one hand raised in a snappy wave.
7. Celebrating: Cheerful hop/bounce with bent knees, tucked elbows, and pumped fists.
8. Error: Hands in pockets, head tilted down with a somber frown.

Vertical 9:16 portrait framing showing the full character from head to shoes with generous padding, sharp cutout silhouettes, consistent studio lighting, and strict fidelity to the reference image's facial features, glasses, hair, beard, and clothing across all frames.
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
