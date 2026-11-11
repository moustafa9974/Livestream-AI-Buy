import { describe, expect, it } from "vitest";
import { itemKind } from "./item-kind";

describe("itemKind", () => {
  it("merges the AI's different names for one object", () => {
    expect(itemKind("laptop computer")).toBe(itemKind("black laptop computer"));
    expect(itemKind("computer mouse")).toBe(itemKind("black computer mouse"));
    expect(itemKind("white ceramic mug")).toBe("mug");
    expect(itemKind("Studio Over-Ear Headphones")).toBe("headphone");
  });

  it("keeps different kinds apart", () => {
    expect(itemKind("table lamp")).not.toBe(itemKind("glass dome rose"));
    expect(itemKind("drinking glass")).toBe("glass"); // not "glas"
  });
});
