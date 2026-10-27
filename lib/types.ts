export type Video = {
  id: string;
  title: string;
  channel: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  tags: string[];
};

export type RankedVideo = Video & {
  /** Short, user-facing reason this video matches. Empty when ranking fell back. */
  reason: string;
};

/** The video the user said was "closer"; the next search pivots on its wording and tags. */
export type Anchor = Pick<Video, "title" | "channel" | "description" | "tags">;

export type SearchRequest = {
  description: string;
  feedback: string[];
  anchor?: Anchor;
  /** Video IDs already shown and rejected, so refinements surface something new. */
  exclude: string[];
  /** 0 for the first search, +1 for each refinement. */
  round: number;
};

export type SearchResponse = {
  videos: RankedVideo[];
  queries: string[];
};

export type SearchErrorCode = "bad_request" | "round_limit" | "quota" | "config" | "upstream";

export type SearchError = {
  error: SearchErrorCode;
  message: string;
};
