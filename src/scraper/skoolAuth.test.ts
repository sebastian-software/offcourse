import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { createSkoolSessionVerifier, isSkoolUrl, normalizeSkoolClassroomUrl } from "./skoolAuth.js";

describe("Skool auth", () => {
  it("recognizes only Skool hosts", () => {
    expect(isSkoolUrl("https://www.skool.com/cashflow-immobile/classroom")).toBe(true);
    expect(isSkoolUrl("https://skool.com/cashflow-immobile")).toBe(true);
    expect(isSkoolUrl("https://not-skool.com/cashflow-immobile")).toBe(false);
    expect(isSkoolUrl("invalid")).toBe(false);
  });

  it("normalizes community URLs but not global Skool pages", () => {
    expect(
      normalizeSkoolClassroomUrl(
        "https://www.skool.com/cashflow-immobile/classroom/abcdef12?md=lesson"
      )
    ).toBe("https://www.skool.com/cashflow-immobile/classroom");
    expect(normalizeSkoolClassroomUrl("https://skool.com/cashflow-immobile")).toBe(
      "https://www.skool.com/cashflow-immobile/classroom"
    );
    expect(normalizeSkoolClassroomUrl("https://www.skool.com/")).toBeNull();
    expect(normalizeSkoolClassroomUrl("https://www.skool.com/login")).toBeNull();
  });

  it("verifies access to the requested community classroom", async () => {
    let currentUrl = "https://www.skool.com/";
    const goto = vi.fn(async (url: string) => {
      currentUrl = url;
    });
    const page = {
      url: vi.fn(() => currentUrl),
      goto,
      waitForLoadState: vi.fn(async () => undefined),
      title: vi.fn(async () => "Classroom · Cashflow Quartier Family"),
    } as unknown as Page;

    const verify = createSkoolSessionVerifier("https://www.skool.com/cashflow-immobile/classroom");

    await expect(verify(page)).resolves.toBe(true);
    expect(goto).toHaveBeenCalledWith("https://www.skool.com/cashflow-immobile/classroom", {
      timeout: 30000,
    });
  });

  it("rejects a session redirected away from the requested classroom", async () => {
    const page = {
      url: vi
        .fn()
        .mockReturnValueOnce("https://www.skool.com/")
        .mockReturnValue("https://www.skool.com/cashflow-immobile/about"),
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      title: vi.fn(async () => "About · Cashflow Quartier Family"),
    } as unknown as Page;

    const verify = createSkoolSessionVerifier("https://www.skool.com/cashflow-immobile/classroom");

    await expect(verify(page)).resolves.toBe(false);
  });

  it("accepts a Skool alias redirect to its canonical classroom URL", async () => {
    let currentUrl = "https://www.skool.com/";
    const page = {
      url: vi.fn(() => currentUrl),
      goto: vi.fn(async () => {
        currentUrl = "https://www.skool.com/cashflow-immobilie/classroom";
      }),
      waitForLoadState: vi.fn(async () => undefined),
      title: vi.fn(async () => "Classroom · Cashflow Quartier Family"),
    } as unknown as Page;

    const verify = createSkoolSessionVerifier(
      "https://www.skool.com/cashflow-quartier-family-5331/classroom"
    );

    await expect(verify(page)).resolves.toBe(true);
  });

  it("retries a transient Skool 404 once", async () => {
    const goto = vi.fn(async () => undefined);
    const page = {
      url: vi.fn(() => "https://www.skool.com/cashflow-immobilie/classroom"),
      goto,
      waitForLoadState: vi.fn(async () => undefined),
      title: vi
        .fn()
        .mockResolvedValueOnce("404 Error")
        .mockResolvedValue("Classroom · Cashflow Quartier Family"),
    } as unknown as Page;

    const verify = createSkoolSessionVerifier("https://www.skool.com/cashflow-immobilie/classroom");

    await expect(verify(page)).resolves.toBe(true);
    expect(goto).toHaveBeenCalledOnce();
  });
});
