import { describe, expect, it } from "vitest";
import { isPiccalilliLoginPage } from "./auth.js";

describe("Piccalilli auth", () => {
  it("recognizes the Piccalilli login endpoint", () => {
    expect(isPiccalilliLoginPage("https://piccalil.li/login")).toBe(true);
    expect(isPiccalilliLoginPage("https://piccalil.li/login?token=abc")).toBe(true);
    expect(isPiccalilliLoginPage("https://piccalil.li/mindful-design/lessons/2")).toBe(false);
    expect(isPiccalilliLoginPage("invalid")).toBe(false);
  });
});
