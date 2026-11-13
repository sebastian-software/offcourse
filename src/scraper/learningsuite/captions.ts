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
/** Prefer an explicit language, otherwise preserve the provider's default track/order. */
export function selectLearningSuiteCaption<T extends { language: string; isDefault?: boolean }>(
  captions: T[],
  preferredLanguage = "auto"
): T | undefined {
  const normalize = (language: string) => language.toLowerCase().replaceAll("_", "-");
  const language = normalize(preferredLanguage);
  if (language !== "auto") {
    const preferred =
      captions.find((caption) => normalize(caption.language) === language) ??
      captions.find(
        (caption) => normalize(caption.language).split("-")[0] === language.split("-")[0]
      );
    if (preferred) return preferred;
  }
  return captions.find((caption) => caption.isDefault) ?? captions[0];
}
