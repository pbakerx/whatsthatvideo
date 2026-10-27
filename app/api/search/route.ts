import { z } from "zod";
import { MAX_REFINEMENTS } from "@/lib/limits";
import { findVideos } from "@/lib/search";
import type { SearchError, SearchErrorCode } from "@/lib/types";
import { YouTubeError } from "@/lib/youtube";

const RequestSchema = z.object({
  description: z.string().trim().min(1).max(500),
  feedback: z.array(z.string().trim().min(1).max(200)).max(MAX_REFINEMENTS).default([]),
  anchor: z
    .object({
      title: z.string().max(200),
      channel: z.string().max(100),
      description: z.string().max(500),
      tags: z.array(z.string().max(60)).max(20),
    })
    .optional(),
  exclude: z.array(z.string().max(20)).max(100).default([]),
  round: z.number().int().min(0).default(0),
});

function fail(status: number, error: SearchErrorCode, message: string): Response {
  return Response.json({ error, message } satisfies SearchError, { status });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, "bad_request", "Tell me something about the video first.");
  }
  if (parsed.data.round > MAX_REFINEMENTS) {
    return fail(429, "round_limit", "That's all my guesses for this one. Start fresh with a new description?");
  }

  try {
    return Response.json(await findVideos(parsed.data));
  } catch (error) {
    if (error instanceof YouTubeError && error.isQuota) {
      return fail(503, "quota", "I've used up today's YouTube searches. Try again tomorrow!");
    }
    if (error instanceof YouTubeError && error.reason === "missingKey") {
      return fail(500, "config", "Search isn't configured yet: YOUTUBE_API_KEY is missing.");
    }
    console.error("Search failed", error);
    return fail(502, "upstream", "Search hit a snag. Try that again?");
  }
}
