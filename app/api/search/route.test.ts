import { beforeEach, describe, expect, it, vi } from "vitest";
import { findVideos } from "@/lib/search";
import { YouTubeError } from "@/lib/youtube";
import { POST } from "./route";

vi.mock("@/lib/search", () => ({ findVideos: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

function post(body: unknown): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/search", () => {
  it("returns the search results with defaults filled in", async () => {
    vi.mocked(findVideos).mockResolvedValue({ videos: [], queries: ["q"] });

    const res = await POST(post({ description: "  cat piano  " }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ videos: [], queries: ["q"] });
    expect(findVideos).toHaveBeenCalledWith({ description: "cat piano", feedback: [], exclude: [], round: 0 });
  });

  it("rejects an empty description", async () => {
    const res = await POST(post({ description: "   " }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(findVideos).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(new Request("http://localhost/api/search", { method: "POST", body: "{" }));

    expect(res.status).toBe(400);
  });

  it("caps refinement rounds", async () => {
    const res = await POST(post({ description: "cat", round: 6 }));

    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("round_limit");
    expect(findVideos).not.toHaveBeenCalled();
  });

  it("maps a YouTube quota error to 503", async () => {
    vi.mocked(findVideos).mockRejectedValue(new YouTubeError("quota", 403, "quotaExceeded"));

    const res = await POST(post({ description: "cat" }));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("quota");
  });

  it("reports a missing API key as a config error", async () => {
    vi.mocked(findVideos).mockRejectedValue(new YouTubeError("missing", 500, "missingKey"));

    const res = await POST(post({ description: "cat" }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("config");
  });

  it("maps anything else to 502", async () => {
    vi.mocked(findVideos).mockRejectedValue(new Error("boom"));

    const res = await POST(post({ description: "cat" }));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream");
  });
});
