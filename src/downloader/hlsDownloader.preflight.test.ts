import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkFfmpeg: vi.fn(),
  downloadWithFfmpeg: vi.fn(),
  fetchWithAuthRedirects: vi.fn(),
}));

vi.mock("./shared/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared/index.js")>()),
  checkFfmpeg: mocks.checkFfmpeg,
  downloadWithFfmpeg: mocks.downloadWithFfmpeg,
  fetchWithAuthRedirects: mocks.fetchWithAuthRedirects,
}));

import { downloadHLSVideo } from "./hlsDownloader.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("downloadHLSVideo HEAD preflight", () => {
  beforeEach(() => {
    mocks.checkFfmpeg.mockResolvedValue(true);
    mocks.downloadWithFfmpeg.mockResolvedValue({ success: true });
  });

  it.each([403, 405, 501])("falls back to GET when HEAD returns %s", async (status) => {
    mocks.fetchWithAuthRedirects
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response("#EXTM3U", { status: 200 }));

    const result = await downloadHLSVideo(
      "https://cdn.example.com/video.m3u8",
      "/tmp/video.mp4",
      undefined,
      "session=abc",
      "https://course.example.com/lesson",
      "token"
    );

    expect(result).toMatchObject({ success: true, outputPath: "/tmp/video.mp4" });
    expect(mocks.fetchWithAuthRedirects).toHaveBeenNthCalledWith(
      1,
      "https://cdn.example.com/video.m3u8",
      expect.objectContaining({ method: "HEAD" })
    );
    expect(mocks.fetchWithAuthRedirects).toHaveBeenNthCalledWith(
      2,
      "https://cdn.example.com/video.m3u8",
      expect.objectContaining({ method: "GET" })
    );
    expect(mocks.downloadWithFfmpeg).toHaveBeenCalledOnce();
  });

  it("keeps other HEAD failures fatal", async () => {
    mocks.fetchWithAuthRedirects.mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(
      downloadHLSVideo("https://cdn.example.com/video.m3u8", "/tmp/video.mp4")
    ).resolves.toMatchObject({
      success: false,
      errorCode: "FETCH_FAILED",
      error: "HLS URL returned 500: https://cdn.example.com/video.m3u8",
    });
    expect(mocks.fetchWithAuthRedirects).toHaveBeenCalledOnce();
    expect(mocks.downloadWithFfmpeg).not.toHaveBeenCalled();
  });
});
