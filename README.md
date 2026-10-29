# What Was That Video?

An AechTech demo: describe a half-remembered video out loud, and a voice agent finds it. See [SPEC.md](SPEC.md).

## How it works

1. **Voice** ([ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents/overview)) asks one question, "What do you remember?", and calls a `search_videos` tool the moment you answer. You can also just type.
2. **Query expansion**: Claude Haiku turns the vague description into a few YouTube-style queries (`lib/llm.ts`).
3. **Search**: the queries run in parallel against the YouTube Data API, then one `videos.list` call adds tags and full descriptions (`lib/youtube.ts`).
4. **Re-ranking**: Claude Haiku picks the best 4 and gives a one-line reason for each (`lib/search.ts`).
5. **Refinement**: "Closer…" pivots the next search on that video's wording and tags; "no, it was a cat" adds a correction. Videos already shown are excluded.

If Claude is unavailable, search falls back to your own words and YouTube's order, so the demo keeps working.

```
browser (app/finder.tsx)
  ├─ ElevenLabs agent ──client tools──▶ search_videos / refine_search / show_video
  ├─ GET  /api/voice-token  → short-lived WebRTC token (agent has auth on)
  └─ POST /api/search       → expand → YouTube ×N → details → rank
```

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the keys
npm run setup:agent          # creates the ElevenLabs agent + tools; prints ELEVENLABS_AGENT_ID
npm run dev
```

Voice is optional: without the ElevenLabs keys the mic button says so, and typed search still works.

To deploy, follow [DEPLOY.md](DEPLOY.md).

## Cost guards

The spec's priority is keeping a free demo cheap.

| Cost | Guard |
| --- | --- |
| YouTube quota (10,000 units/day free; a search costs 100) | 3 queries per round (`YOUTUBE_MAX_QUERIES_PER_ROUND`), about 33 rounds a day on the free quota. Results are cached for days with `'use cache: remote'`, keyed by normalized query, and query expansion is cached too, so a repeated description costs nothing. The remote cache is shared across instances where the host provides one (see Next's [`cacheHandlers`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers)); locally it lives in memory. |
| Refinement loops | 5 refinements per session (`MAX_REFINEMENTS_PER_SESSION`). |
| ElevenLabs voice minutes | Sessions end after 3 minutes, with a cap of 100 conversations a day and 5 at once. These are set on the agent by `setup:agent`. |
| LLM | Claude Haiku with thinking off and low effort: a few thousand tokens per round, well under a tenth of a cent. |

When the quota runs out, users see "I've used up today's YouTube searches." To go further, [request a quota increase](https://support.google.com/youtube/contact/yt_api_form).

## Scripts

- `npm run dev` / `build` / `start`
- `npm test` runs the unit tests (Vitest).
- `npm run lint` / `typecheck`
- `npm run setup:agent` creates or updates the voice agent. Set `ELEVENLABS_AGENT_ID` to update an existing agent.

## Known gaps

- **Transcripts**: the spec ranks on transcripts too, but the YouTube Data API only serves captions to a video's owner. Ranking uses titles, descriptions and tags for now.
- **TikTok / Instagram Reels**: later, per the spec.
- **Abuse**: `/api/search` and `/api/voice-token` have no per-user rate limits. YouTube's daily quota is a hard ceiling (search stops rather than bills), and the agent's daily and concurrency caps bound voice cost.
- **Voice swap**: Block's Dessa is worth a look once it leaves research preview.
