/** Shared Vimeo player-config types and stream selection rules. */

export interface VimeoCdnConfig {
  avc_url?: string;
  url?: string;
}

export interface VimeoHlsConfig {
  default_cdn?: string;
  cdns?: Record<string, VimeoCdnConfig>;
}

export interface VimeoProgressiveRendition {
  url?: string;
  quality?: string;
  width?: number;
  height?: number;
}

const PREFERRED_VIMEO_CDNS = [
  "akfire_interconnect_quic",
  "akamai_live",
  "fastly_skyfire",
  "fastly",
];

/** Selects Vimeo's preferred AVC HLS rendition, falling back to any CDN URL. */
export function selectVimeoHlsUrl(hls: VimeoHlsConfig | null | undefined): string | null {
  if (!hls?.cdns) return null;

  const preferred = [hls.default_cdn, ...PREFERRED_VIMEO_CDNS].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
  );
  for (const cdn of preferred) {
    const url = hls.cdns[cdn]?.avc_url ?? hls.cdns[cdn]?.url;
    if (url) return url;
  }

  for (const cdn of Object.values(hls.cdns)) {
    const url = cdn.avc_url ?? cdn.url;
    if (url) return url;
  }
  return null;
}

/** Selects the highest-resolution progressive Vimeo rendition. */
export function selectVimeoProgressiveUrl(
  progressive: VimeoProgressiveRendition[] | null | undefined
): string | null {
  return (
    [...(progressive ?? [])]
      .filter((rendition) => Boolean(rendition.url))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]?.url ?? null
  );
}
