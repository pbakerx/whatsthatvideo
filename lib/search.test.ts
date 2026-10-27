import { beforeEach, describe, expect, it, vi } from "vitest";
import { expandQueries, rankVideos } from "./llm";
import { fallbackQuery, findVideos, interleave, topUp } from "./search";
import type { SearchRequest, Video } from "./types";
import { YouTubeError, getVideoDetails, searchVideos } from "./youtube";

vi.mock("./llm", () => ({ expandQueries: vi.fn(), rankVideos: vi.fn() }));
vi.mock("./youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./youtube")>()),
  searchVideos: vi.fn(),
  getVideoDetails: vi.fn(),
}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

function video(id: string): Video {
  return { id, title: `title ${id}`, channel: "c", description: "", thumbnail: "", publishedAt: "", tags: [] };
}

const request: SearchRequest = { description: "Cat  Piano", feedback: [], exclude: [], round: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getVideoDetails).mockResolvedValue({});
});

describe("interleave", () => {
  it("round-robins across queries, dedupes, excludes and limits", () => {
    const lists = [
      [video("a"), video("b"), video("c")],
      [video("b"), video("d")],
    ];
    expect(interleave(lists, new Set(["c"]), 10).map((v) => v.id)).toEqual(["a", "b", "d"]);
    expect(interleave(lists, new Set(), 2).map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("topUp", () => {
  it("fills missing slots from candidates in order without repeats", () => {
    const ranked = [{ ...video("c"), reason: "best" }];
    const filled = topUp(ranked, [video("a"), video("c"), video("d")], 3);
    expect(filled.map((v) => [v.id, v.reason])).toEqual([
      ["c", "best"],
      ["a", ""],
      ["d", ""],
    ]);
  });

  it("drops reuploads that repeat an earlier title", () => {
    const original = { ...video("a"), title: "Baby Laughing (Original)", reason: "r" };
    const reupload = { ...video("b"), title: "baby laughing — original!", reason: "r" };
    const filled = topUp([original, reupload], [{ ...reupload }, video("c")], 3);
    expect(filled.map((v) => v.id)).toEqual(["a", "c"]);
  });
});

describe("fallbackQuery", () => {
  it("searches the description plus corrections", () => {
    expect(fallbackQuery({ ...request, feedback: ["it was a dog"] })).toBe("Cat  Piano it was a dog");
  });

  it("pivots on the closer video's title and tags", () => {
    const anchor = { title: "Keyboard Cat", channel: "c", description: "", tags: ["meme", "piano", "cat", "2009"] };
    expect(fallbackQuery({ ...request, anchor })).toBe("Keyboard Cat meme piano cat");
  });
});

describe("findVideos", () => {
  it("searches each expanded query and returns the ranked picks", async () => {
    vi.mocked(expandQueries).mockResolvedValue(["q1", "q2"]);
    vi.mocked(searchVideos).mockImplementation(async (q) => (q === "q1" ? [video("a")] : [video("b")]));
    vi.mocked(rankVideos).mockResolvedValue([{ ...video("b"), reason: "matches" }]);

    const result = await findVideos(request);

    expect(expandQueries).toHaveBeenCalledWith("cat piano", { feedback: [], anchor: undefined }, 3);
    expect(searchVideos).toHaveBeenCalledTimes(2);
    expect(result.queries).toEqual(["q1", "q2"]);
    expect(result.videos.map((v) => [v.id, v.reason])).toEqual([
      ["b", "matches"],
      ["a", ""],
    ]);
  });

  it("falls back to the raw description when expansion fails", async () => {
    vi.mocked(expandQueries).mockRejectedValue(new Error("no key"));
    vi.mocked(searchVideos).mockResolvedValue([video("a")]);
    vi.mocked(rankVideos).mockResolvedValue(null);

    const result = await findVideos(request);

    expect(searchVideos).toHaveBeenCalledWith("cat piano");
    expect(result.videos.map((v) => v.id)).toEqual(["a"]);
  });

  it("keeps YouTube's order when ranking fails", async () => {
    vi.mocked(expandQueries).mockResolvedValue(["q"]);
    vi.mocked(searchVideos).mockResolvedValue([video("a"), video("b")]);
    vi.mocked(rankVideos).mockRejectedValue(new Error("overloaded"));

    const result = await findVideos(request);

    expect(result.videos.map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("drops already-shown videos and merges in tags", async () => {
    vi.mocked(expandQueries).mockResolvedValue(["q"]);
    vi.mocked(searchVideos).mockResolvedValue([video("a"), video("b")]);
    vi.mocked(getVideoDetails).mockResolvedValue({ b: { title: "Full B", description: "d", tags: ["t"] } });
    vi.mocked(rankVideos).mockImplementation(async (_d, _r, candidates) =>
      candidates.map((v) => ({ ...v, reason: "" })),
    );

    const result = await findVideos({ ...request, exclude: ["a"], round: 1 });

    expect(result.videos).toEqual([{ ...video("b"), title: "Full B", description: "d", tags: ["t"], reason: "" }]);
  });

  it("returns no videos without ranking when everything was excluded", async () => {
    vi.mocked(expandQueries).mockResolvedValue(["q"]);
    vi.mocked(searchVideos).mockResolvedValue([video("a")]);

    const result = await findVideos({ ...request, exclude: ["a"] });

    expect(result.videos).toEqual([]);
    expect(rankVideos).not.toHaveBeenCalled();
  });

  it("surfaces the YouTube error when every search fails", async () => {
    vi.mocked(expandQueries).mockResolvedValue(["q1", "q2"]);
    vi.mocked(searchVideos).mockRejectedValue(new YouTubeError("quota", 403, "quotaExceeded"));

    await expect(findVideos(request)).rejects.toMatchObject({ isQuota: true });
  });

  it("uses whatever searches succeeded", async () => {
    vi.mocked(expandQueries).mockResolvedValue(["q1", "q2"]);
    vi.mocked(searchVideos).mockImplementation(async (q) => {
      if (q === "q1") throw new YouTubeError("boom", 500);
      return [video("b")];
    });
    vi.mocked(rankVideos).mockResolvedValue(null);

    expect((await findVideos(request)).videos.map((v) => v.id)).toEqual(["b"]);
  });
});
