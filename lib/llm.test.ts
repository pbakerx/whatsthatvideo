import { describe, expect, it, vi } from "vitest";
import { cleanQueries, resolvePicks } from "./llm";
import type { Video } from "./types";

vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

function video(id: string): Video {
  return { id, title: id, channel: "c", description: "", thumbnail: "", publishedAt: "", tags: [] };
}

describe("cleanQueries", () => {
  it("trims, collapses whitespace, drops blanks and case-insensitive duplicates", () => {
    expect(cleanQueries(["  cat  piano ", "", "Cat Piano", "keyboard cat"], 5)).toEqual([
      "cat piano",
      "keyboard cat",
    ]);
  });

  it("stops at the requested count", () => {
    expect(cleanQueries(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("resolvePicks", () => {
  const candidates = [video("v1"), video("v2"), video("v3")];

  it("maps 1-based numbers to candidates in the model's order", () => {
    const ranked = resolvePicks(
      [
        { number: 3, reason: " cat in a hat " },
        { number: 1, reason: "piano" },
      ],
      candidates,
      4,
    );
    expect(ranked.map((v) => [v.id, v.reason])).toEqual([
      ["v3", "cat in a hat"],
      ["v1", "piano"],
    ]);
  });

  it("ignores out-of-range and repeated numbers", () => {
    const ranked = resolvePicks(
      [
        { number: 0, reason: "" },
        { number: 9, reason: "" },
        { number: 2, reason: "a" },
        { number: 2, reason: "b" },
      ],
      candidates,
      4,
    );
    expect(ranked.map((v) => v.id)).toEqual(["v2"]);
  });

  it("stops at the requested count", () => {
    const picks = [1, 2, 3].map((number) => ({ number, reason: "" }));
    expect(resolvePicks(picks, candidates, 2)).toHaveLength(2);
  });
});
