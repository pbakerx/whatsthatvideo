# What Was That Video? — Spec

> Source: Google Doc "What Was That Video? — Spec" (created 2026-10-27).
> https://docs.google.com/document/d/1WBcfKZSwPnSZ8GhFlSCKqMlaazZQyZ7Oz6h-RSQbQas/edit

A fun AechTech demo: a voice agent that finds half-remembered videos you saw but didn't bookmark.

## Concept

- User describes a video vaguely, out loud. The agent does the magic.
- Searches the open web, not the user's local history.
- Purpose: AechTech demo with a "wow" moment in the first ten seconds. Possibly offered free.

## Platform

- Web app (not native iOS): shareable link, no install, no App Store review.
- Voice: ElevenLabs Conversational AI.
- Note: when creating the agent via API, include "audio" in `client_events` or it won't stream audio back.
- Keep an eye on Block's Dessa (research preview) as a possible future voice swap.

## Experience

- Frictionless. One question only: "What do you remember?"
- The agent takes a vague answer and runs with it. No interrogation.
- Shows 3–4 likely videos on screen immediately.
- Learns from selection: "closer" / "no, it was a cat" refines the search instantly.
- Personality: friendly, slightly cheeky, confident.

## Search engine

- An LLM expands the description into many query variations.
- Runs them in parallel (V1: YouTube Data API).
- Ranks results by matching titles, descriptions and transcripts to what the user said.
- On "closer", pivots on that video's tags and wording and searches again.
- Later: TikTok / Instagram Reels (harder, walled gardens).

## Cost (priority: keep costs low, especially if free)

- Use a small, cheap model for query expansion and re-ranking.
- Biggest cost drivers are likely ElevenLabs voice minutes and YouTube API quota, not the LLM.
- YouTube Data API free quota is 10,000 units/day; each search costs 100 units (~100 searches/day). Request a quota increase or limit query fan-out.
- Cap session length and refinement rounds per session.
- Cache common queries and results.
- Keep the voice conversation short by design.

## Domain

- Not a priority right now. Function first.
- Working name: What Was That Video? Candidate: whatwasthatvideo.com
- Have the Vercel agent check domain availability. Do not use Wix.
