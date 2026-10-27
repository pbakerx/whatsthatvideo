import { cacheLife } from "next/cache";
import type { Video } from "./types";

const API_BASE = process.env.YOUTUBE_API_BASE ?? "https://www.googleapis.com/youtube/v3";
const RESULTS_PER_QUERY = 12;

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "YouTubeError";
  }

  get isQuota(): boolean {
    return this.reason === "quotaExceeded" || this.reason === "dailyLimitExceeded";
  }
}

// Cached functions return failures as values: production builds replace errors
// thrown across a `use cache` boundary with a generic one, losing the reason.
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; status: number; reason?: string };

function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new YouTubeError(result.message, result.status, result.reason);
}

type Thumbnails = Partial<Record<"default" | "medium" | "high", { url: string }>>;

type SearchListResponse = {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      publishedAt?: string;
      thumbnails?: Thumbnails;
    };
  }[];
};

type VideoListResponse = {
  items?: {
    id: string;
    snippet?: { title?: string; description?: string; tags?: string[] };
  }[];
};

export type VideoDetails = Pick<Video, "title" | "description" | "tags">;

async function get<T>(path: string, params: Record<string, string>): Promise<Result<T>> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, message: "YOUTUBE_API_KEY is not set", status: 500, reason: "missingKey" };

  const url = new URL(`${API_BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, value: body as T };
    const error = body?.error;
    return {
      ok: false,
      message: error?.message ?? `YouTube API returned ${res.status}`,
      status: res.status,
      reason: error?.errors?.[0]?.reason,
    };
  } catch (error) {
    return { ok: false, message: `YouTube API unreachable: ${String(error)}`, status: 0 };
  }
}

// search.list escapes HTML entities in titles and descriptions.
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function toVideos(body: SearchListResponse): Video[] {
  return (body.items ?? []).flatMap((item) => {
    const id = item.id?.videoId;
    const snippet = item.snippet;
    if (!id || !snippet) return [];
    const thumbs = snippet.thumbnails ?? {};
    return [
      {
        id,
        title: decodeEntities(snippet.title ?? ""),
        channel: decodeEntities(snippet.channelTitle ?? ""),
        description: decodeEntities(snippet.description ?? ""),
        thumbnail: (thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? "",
        publishedAt: snippet.publishedAt ?? "",
        tags: [],
      },
    ];
  });
}

/** One search.list call (100 quota units). Successes are cached for days across instances. */
async function cachedSearch(query: string): Promise<Result<Video[]>> {
  "use cache: remote";

  const result = await get<SearchListResponse>("search", {
    part: "snippet",
    type: "video",
    safeSearch: "moderate",
    maxResults: String(RESULTS_PER_QUERY),
    q: query,
  });
  if (!result.ok) {
    cacheLife("seconds");
    return result;
  }
  cacheLife("days");
  return { ok: true, value: toVideos(result.value) };
}

export async function searchVideos(query: string): Promise<Video[]> {
  return unwrap(await cachedSearch(query));
}

/** One videos.list call (1 quota unit) for the full descriptions and tags search.list omits. */
async function cachedDetails(ids: string[]): Promise<Result<Record<string, VideoDetails>>> {
  "use cache: remote";

  const result = await get<VideoListResponse>("videos", {
    part: "snippet",
    id: ids.join(","),
    maxResults: "50",
  });
  if (!result.ok) {
    cacheLife("seconds");
    return result;
  }
  cacheLife("days");
  const details: Record<string, VideoDetails> = {};
  for (const item of result.value.items ?? []) {
    details[item.id] = {
      title: item.snippet?.title ?? "",
      description: item.snippet?.description ?? "",
      tags: item.snippet?.tags ?? [],
    };
  }
  return { ok: true, value: details };
}

/** Sorts the IDs so the same set shares one cache entry. */
export async function getVideoDetails(ids: string[]): Promise<Record<string, VideoDetails>> {
  if (ids.length === 0) return {};
  return unwrap(await cachedDetails([...ids].sort().slice(0, 50)));
}
