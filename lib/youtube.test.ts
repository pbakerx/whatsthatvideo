import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeError, decodeEntities, getVideoDetails, searchVideos } from "./youtube";

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("decodeEntities", () => {
  it("decodes the entities search.list returns", () => {
    expect(decodeEntities("Tom &amp; Jerry &#39;81 &quot;live&quot; &lt;3 &#x1F431;")).toBe(
      `Tom & Jerry '81 "live" <3 🐱`,
    );
  });
});

describe("searchVideos", () => {
  it("maps results and skips items without a video ID", async () => {
    const fetchMock = respond(200, {
      items: [
        {
          id: { videoId: "abc123def45" },
          snippet: {
            title: "Cat &amp; piano",
            channelTitle: "Keyboard Cat",
            description: "classic",
            publishedAt: "2009-01-01T00:00:00Z",
            thumbnails: { medium: { url: "https://i.ytimg.com/m.jpg" } },
          },
        },
        { id: { channelId: "UC123" }, snippet: { title: "A channel" } },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const videos = await searchVideos("cat piano");

    expect(videos).toEqual([
      {
        id: "abc123def45",
        title: "Cat & piano",
        channel: "Keyboard Cat",
        description: "classic",
        thumbnail: "https://i.ytimg.com/m.jpg",
        publishedAt: "2009-01-01T00:00:00Z",
        tags: [],
      },
    ]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/youtube/v3/search");
    expect(url.searchParams.get("q")).toBe("cat piano");
    expect(url.searchParams.get("type")).toBe("video");
    expect(url.searchParams.get("key")).toBe("test-key");
  });

  it("throws a quota error the route can recognize", async () => {
    vi.stubGlobal(
      "fetch",
      respond(403, { error: { message: "quota exceeded", errors: [{ reason: "quotaExceeded" }] } }),
    );

    const error = await searchVideos("anything").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(YouTubeError);
    expect((error as YouTubeError).isQuota).toBe(true);
    expect((error as YouTubeError).status).toBe(403);
  });

  it("fails without calling YouTube when the key is missing", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchVideos("anything")).rejects.toMatchObject({ reason: "missingKey" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreachable API as a YouTubeError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(searchVideos("anything")).rejects.toMatchObject({ name: "YouTubeError", status: 0 });
  });
});

describe("getVideoDetails", () => {
  it("requests sorted IDs and returns tags by ID", async () => {
    const fetchMock = respond(200, {
      items: [{ id: "b", snippet: { title: "B", description: "full", tags: ["x", "y"] } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const details = await getVideoDetails(["b", "a"]);

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("id")).toBe("a,b");
    expect(details).toEqual({ b: { title: "B", description: "full", tags: ["x", "y"] } });
  });

  it("skips the call for an empty list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getVideoDetails([])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
