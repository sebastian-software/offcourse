/** Convert WebVTT cues into readable text while retaining the original VTT separately. */
export function learningSuiteCaptionText(vtt: string): string {
  return vtt
    .replaceAll("\r\n", "\n")
    .split(/\n\s*\n/)
    .flatMap((block) => {
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(block.trim())) return [];
      const lines = block.split("\n");
      const timing = lines.findIndex((line) => line.includes(" --> "));
      if (timing < 0) return [];
      const text = lines
        .slice(timing + 1)
        .join(" ")
        .replace(/<[^>]*>/g, "")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&nbsp;", " ")
        .trim();
      return text ? [text] : [];
    })
    .join("\n\n");
}
