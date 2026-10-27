import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { cacheLife } from "next/cache";
import { z } from "zod";
import type { Anchor, RankedVideo, Video } from "./types";

// The spec asks for a small, cheap model for query expansion and re-ranking.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  return (client ??= new Anthropic());
}

export type Refinement = {
  feedback: string[];
  anchor?: Anchor;
};

const QueriesSchema = z.object({ queries: z.array(z.string()) });

const RankingSchema = z.object({
  picks: z.array(z.object({ number: z.number().int(), reason: z.string() })),
});

/** Returns null on a refusal or an unparseable answer so callers can fall back. */
async function ask<Schema extends z.ZodType>(
  system: string,
  prompt: string,
  schema: Schema,
  maxTokens: number,
): Promise<z.infer<Schema> | null> {
  const response = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    // Short structured answers on the voice path: skip thinking, keep effort low.
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: zodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason !== "end_turn") return null;
  return response.parsed_output ?? null;
}

function renderRefinement({ feedback, anchor }: Refinement): string {
  const parts: string[] = [];
  if (feedback.length > 0) {
    parts.push(`Corrections so far, newest last:\n${feedback.map((f) => `- ${f}`).join("\n")}`);
  }
  if (anchor) {
    parts.push(
      [
        "They said this result was close, but not it:",
        `Title: ${anchor.title}`,
        `Channel: ${anchor.channel}`,
        anchor.tags.length > 0 ? `Tags: ${anchor.tags.slice(0, 15).join(", ")}` : "",
        anchor.description ? `Description: ${anchor.description.slice(0, 300)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return parts.join("\n\n");
}

const EXPAND_SYSTEM = `You turn someone's half-remembered description of an online video into YouTube search queries.

People misremember details, so spread your bets. Mix literal keywords from their description with the wording the real title probably uses, the name of the meme or trend if you recognize it, and other ways of describing the key moment. Write each query the way someone types into YouTube: 2 to 8 words, no quotes, no years or channel names unless they mentioned them.

When they say a result was close, work out what that video has in common with their memory (the subject, setting, or moment, not incidental words) and steer the queries toward videos like it. When they correct a detail, the correction wins over the original description.`;

export function cleanQueries(raw: string[], count: number): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const query of raw) {
    const text = query.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    queries.push(text);
    if (queries.length === count) break;
  }
  return queries;
}

/**
 * Cached so a repeated description produces the same queries, which in turn
 * hit the cached YouTube results instead of spending quota.
 */
export async function expandQueries(
  description: string,
  refinement: Refinement,
  count: number,
): Promise<string[] | null> {
  "use cache: remote";
  cacheLife("days");

  const context = renderRefinement(refinement);
  const prompt = [
    `What they remember: ${description}`,
    context,
    `Write exactly ${count} different search queries.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const answer = await ask(EXPAND_SYSTEM, prompt, QueriesSchema, 1024);
  if (!answer) return null;
  const queries = cleanQueries(answer.queries, count);
  return queries.length > 0 ? queries : null;
}

const RANK_SYSTEM = `You pick which YouTube search results best match someone's half-remembered description of a video.

Judge each candidate's title, tags and description against what they remember. Corrections override the original description where they conflict. When they said a result was close, favor videos like it in subject and setting. Prefer the original upload, and skip reuploads of a video you already picked. Skip compilations unless they describe one.

Each pick gets a reason shown under the video: at most 8 words saying what's in the video that fits what they remember. Describe the video, not your judgment, and never mention candidates, matches, the description or corrections.
Good: "Husky howling along to Adele"
Good: "Cat in a blue shirt, filmed in 1984"
Bad: "Matches the correction about breed and song"`;

export function resolvePicks(
  picks: { number: number; reason: string }[],
  candidates: Video[],
  count: number,
): RankedVideo[] {
  const used = new Set<number>();
  const ranked: RankedVideo[] = [];
  for (const pick of picks) {
    const index = pick.number - 1;
    if (index < 0 || index >= candidates.length || used.has(index)) continue;
    used.add(index);
    ranked.push({ ...candidates[index], reason: pick.reason.trim() });
    if (ranked.length === count) break;
  }
  return ranked;
}

export async function rankVideos(
  description: string,
  refinement: Refinement,
  candidates: Video[],
  count: number,
): Promise<RankedVideo[] | null> {
  const list = candidates
    .map((video, i) =>
      [
        `[${i + 1}] ${video.title} (${video.channel})`,
        video.tags.length > 0 ? `    Tags: ${video.tags.slice(0, 10).join(", ")}` : "",
        video.description ? `    Description: ${video.description.slice(0, 200).replace(/\s+/g, " ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");

  const prompt = [
    `What they remember: ${description}`,
    renderRefinement(refinement),
    `Candidates:\n${list}`,
    `Pick up to ${count} candidates by number, best match first. Leave out any that clearly don't match.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const answer = await ask(RANK_SYSTEM, prompt, RankingSchema, 2048);
  return answer ? resolvePicks(answer.picks, candidates, count) : null;
}
