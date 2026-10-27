import { MAX_CANDIDATES, MAX_QUERIES_PER_ROUND, RESULTS_SHOWN } from "./limits";
import { expandQueries, rankVideos, type Refinement } from "./llm";
import type { RankedVideo, SearchRequest, SearchResponse, Video } from "./types";
import { getVideoDetails, searchVideos, type VideoDetails } from "./youtube";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Used when the model is unavailable or declines: search the user's own words,
 * pivoting on the "closer" video's title and top tags when there is one.
 */
export function fallbackQuery({ description, feedback, anchor }: SearchRequest): string {
  const base = anchor ? [anchor.title, ...anchor.tags.slice(0, 3)] : [description];
  return [...base, ...feedback].join(" ").slice(0, 200);
}

/** Round-robin across queries so every query's top hits make the cut. */
export function interleave(lists: Video[][], exclude: Set<string>, limit: number): Video[] {
  const seen = new Set(exclude);
  const merged: Video[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest && merged.length < limit; i++) {
    for (const list of lists) {
      const video = list[i];
      if (!video || seen.has(video.id)) continue;
      seen.add(video.id);
      merged.push(video);
      if (merged.length === limit) break;
    }
  }
  return merged;
}

/** Fills empty slots with the next unpicked candidates in search order. */
export function topUp(ranked: RankedVideo[], candidates: Video[], count: number): RankedVideo[] {
  const picked = new Set(ranked.map((video) => video.id));
  const filled = [...ranked];
  for (const video of candidates) {
    if (filled.length >= count) break;
    if (!picked.has(video.id)) filled.push({ ...video, reason: "" });
  }
  return filled;
}

export async function findVideos(request: SearchRequest): Promise<SearchResponse> {
  const description = normalize(request.description);
  const refinement: Refinement = {
    feedback: request.feedback.map(normalize),
    anchor: request.anchor,
  };

  const expanded = await expandQueries(description, refinement, MAX_QUERIES_PER_ROUND).catch(
    (error: unknown) => {
      console.error("Query expansion failed; searching the raw description", error);
      return null;
    },
  );
  const queries = expanded ?? [fallbackQuery(request)];

  const settled = await Promise.allSettled(queries.map((query) => searchVideos(normalize(query))));
  const lists = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (lists.length === 0) {
    // Every query failed (bad key, quota, outage); surface the first reason.
    throw (settled[0] as PromiseRejectedResult).reason;
  }

  const candidates = interleave(lists, new Set(request.exclude), MAX_CANDIDATES);
  if (candidates.length === 0) return { videos: [], queries };

  const details: Record<string, VideoDetails> = await getVideoDetails(
    candidates.map((video) => video.id),
  ).catch((error: unknown) => {
    console.error("videos.list failed; ranking without tags", error);
    return {};
  });
  const enriched = candidates.map((video) => {
    const extra = details[video.id];
    return extra ? { ...video, ...extra, title: extra.title || video.title } : video;
  });

  const ranked = await rankVideos(description, refinement, enriched, RESULTS_SHOWN).catch(
    (error: unknown) => {
      console.error("Re-ranking failed; keeping YouTube's order", error);
      return null;
    },
  );

  return { videos: topUp(ranked ?? [], enriched, RESULTS_SHOWN), queries };
}
