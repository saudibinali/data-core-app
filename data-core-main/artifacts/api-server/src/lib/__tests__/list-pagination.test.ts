import { describe, expect, it } from "vitest";
import { parseListPagination, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "../list-pagination";

describe("parseListPagination", () => {
  it("defaults to 50 offset 0", () => {
    expect(parseListPagination({})).toEqual({ limit: LIST_DEFAULT_LIMIT, offset: 0 });
  });

  it("caps limit at 200", () => {
    expect(parseListPagination({ limit: "999" }).limit).toBe(LIST_MAX_LIMIT);
  });

  it("parses offset", () => {
    expect(parseListPagination({ limit: "10", offset: "20" })).toEqual({ limit: 10, offset: 20 });
  });
});
