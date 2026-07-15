import { describe, expect, it } from "vitest";
import { isPiccalilliLoginPage, PICCALILLI_LOGIN_URL } from "./auth.js";

describe("Piccalilli auth", () => {
  it("recognizes the Piccalilli login endpoint", () => {
    expect(PICCALILLI_LOGIN_URL).toBe("https://piccalil.li/login");
    expect(isPiccalilliLoginPage(PICCALILLI_LOGIN_URL)).toBe(true);
    expect(isPiccalilliLoginPage("https://piccalil.li/login/")).toBe(true);
    expect(isPiccalilliLoginPage("https://piccalil.li/login?token=abc")).toBe(true);
    expect(isPiccalilliLoginPage("https://piccalil.li/mindful-design/lessons/2")).toBe(false);
    expect(isPiccalilliLoginPage("invalid")).toBe(false);
  });
});
