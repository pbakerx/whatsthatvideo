# Deploying to Vercel

Instructions for whoever (or whichever agent) sets up hosting. The app is a standard Next.js 16 project with no database. It needs four environment variables and one ElevenLabs agent.

Ground rules:

- Never commit API keys, paste them into chat, or print them in logs.
- Don't buy anything (domain, plan upgrade) without Philip's OK.
- Don't use Wix (per [SPEC.md](SPEC.md)).

## 1. What you need from Philip

| Variable | What it is |
| --- | --- |
| `YOUTUBE_API_KEY` | The YouTube Data API v3 key made for this project (Google Cloud project "what-was-that-video"). |
| `ANTHROPIC_API_KEY` | A Claude API key. Used for query expansion and re-ranking. |
| `ELEVENLABS_API_KEY` | An ElevenLabs API key with Conversational AI access. |
| `ELEVENLABS_AGENT_ID` | Not given; you create it in step 2. |

## 2. Create the ElevenLabs voice agent (once)

Run this on any machine that can reach `api.elevenlabs.io` (Node.js 22 or newer):

```bash
git clone https://github.com/pbakerx/whatsthatvideo
cd whatsthatvideo
git checkout main
npm install
printf 'ELEVENLABS_API_KEY=%s\n' "<the key>" > .env.local
npm run setup:agent
rm .env.local
```

It creates three client tools and an agent, then prints `ELEVENLABS_AGENT_ID=agent_…`. Keep that value for step 4.

- Leave `ELEVENLABS_AGENT_ID` unset on this first run so a new agent is created. When it is set, the script overwrites that agent's prompt and tools, so never point it at an agent another project uses.
- Optional: add `ELEVENLABS_VOICE_ID=<voice id>` to `.env.local` before running to pick the voice.
- The agent is created with auth on, 3-minute sessions, and limits of 100 conversations a day and 5 at once. See `scripts/setup-agent.mjs` to change them.

## 3. Create the Vercel project

1. Import `pbakerx/whatsthatvideo` from GitHub as a new project.
2. Framework preset: **Next.js** (auto-detected). Leave the root directory, install command and build command at their defaults.
3. Node.js version: 22.x or newer.
4. Production branch: `main`. If Vercel picked another branch on import, change it in the project's Git settings.
5. Plan: Vercel's Hobby plan is for non-commercial use only. Since this is an AechTech demo, ask Philip which team or plan to use.

The CLI equivalent is `vercel link`, then `vercel env add` for each variable, then `vercel --prod`.

## 4. Environment variables

Add these to the **Production** and **Preview** environments, marked Sensitive:

| Variable | Required | Value |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | yes | from Philip |
| `ANTHROPIC_API_KEY` | yes | from Philip |
| `ELEVENLABS_API_KEY` | for voice | from Philip |
| `ELEVENLABS_AGENT_ID` | for voice | from step 2 |

Optional tuning, with defaults: `ANTHROPIC_MODEL` (`claude-haiku-5-5`), `YOUTUBE_MAX_QUERIES_PER_ROUND` (`3`), `MAX_REFINEMENTS_PER_SESSION` (`5`). Don't set `YOUTUBE_API_BASE`; it exists only for local testing.

Environment variable changes only apply to new deployments, so redeploy after adding them.

## 5. Check the YouTube key's restrictions

In the Google Cloud console, the key should be restricted to the **YouTube Data API v3** only. Don't add website (HTTP referrer) or IP restrictions. The calls come from Vercel's servers, which send no referrer and change IPs.

## 6. Smoke test

On the production URL:

1. The page shows "What do you remember?".
2. Type `that cat in a blue shirt playing a keyboard, super old` and press **Find it**. Within about 10 seconds, four videos appear with "Keyboard Cat! - THE ORIGINAL!" at or near the top. Each card has a short reason under it.
3. Press **Closer…** on a card. You get four new videos with no repeats.
4. Type `no, it was a dog` in the "Not it?" box and press **Try again**. You get new results.
5. Press **That's it!** The video plays in a popup.
6. Tap the mic and allow microphone access. The agent says "What do you remember?". Describe a video out loud; results appear on screen and the agent comments in a short line.
7. Repeat step 2. It should return noticeably faster, because the queries and YouTube results are cached. If it isn't faster, note it in your report; it's not a blocker.

| Symptom | Likely cause |
| --- | --- |
| "Search isn't configured yet: YOUTUBE_API_KEY is missing." | Variable missing, or no redeploy after adding it. |
| Results appear, but no card has a reason | Claude calls failing. Check `ANTHROPIC_API_KEY`; the function logs show "Query expansion failed" or "Re-ranking failed". |
| "I've used up today's YouTube searches." | Daily YouTube quota (10,000 units) used up. It resets at midnight Pacific time. |
| "Voice isn't set up here yet." | `ELEVENLABS_API_KEY` or `ELEVENLABS_AGENT_ID` missing. |
| "Couldn't wake the voice up." | ElevenLabs rejected the token request: wrong key or agent ID. The function logs show "ElevenLabs token request failed". |
| Voice connects but the agent never speaks | The agent is missing `"audio"` in its client events. Re-run step 2 with `ELEVENLABS_AGENT_ID` set to this app's agent. |

## 7. Domain (check only)

Check whether `whatwasthatvideo.com` is available and what it costs, and report back. Don't buy it without Philip's OK. Once approved, add it under the project's Domains settings.

## 8. Report back

Send Philip:

- the production URL
- pass or fail for each smoke-test step, with the error text for any failure
- domain availability and price
- anything unexpected in the function logs
