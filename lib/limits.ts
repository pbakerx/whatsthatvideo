// Cost guards. The spec's priority is keeping a free demo cheap: YouTube's free
// quota is 10,000 units/day and every search.list call costs 100 units.

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** YouTube searches per round. Each costs 100 quota units. */
export const MAX_QUERIES_PER_ROUND = intFromEnv("YOUTUBE_MAX_QUERIES_PER_ROUND", 3);

/** Refinements allowed after the first search in one session. */
export const MAX_REFINEMENTS = intFromEnv("MAX_REFINEMENTS_PER_SESSION", 5);

/** Videos shown on screen per round. */
export const RESULTS_SHOWN = 4;

/** Candidates passed to the re-ranker. */
export const MAX_CANDIDATES = 30;
