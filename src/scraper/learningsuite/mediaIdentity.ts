import { createHash } from "node:crypto";

/** Keep existing LearningSuite IDs; derive an identity for other playlist layouts. */
export function learningSuiteVideoId(source: string, firstSegment: string): string {
  const existing = /\/course\/([a-zA-Z0-9-]+)\//u.exec(source)?.[1];
  if (existing) return existing;
  const identity = [/^https?:\/\//iu.test(source) ? source : firstSegment, firstSegment].map(
    (value) => {
      const url = new URL(value);
      // Access signatures expire; content-identifying parameters remain part of the identity.
      for (const key of [...url.searchParams.keys()]) {
        if (
          /^(?:token|expires?|signature|sig|policy|key-pair-id|hdnts|auth|x-amz-.+|x-goog-.+)$/iu.test(
            key
          )
        )
          url.searchParams.delete(key);
      }
      url.hash = "";
      url.searchParams.sort();
      return url.href;
    }
  );
  return `source-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 20)}`;
}
