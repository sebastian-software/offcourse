import { prompt, isConfigured } from "./openRouter.js";

export interface PolishedTranscript {
  summary: string;      // TLDR summary
  transcript: string;   // Formatted transcript with markdown
}

/**
 * Convert folder name to readable title.
 * "01-1-herzlich-willkommen" → "Herzlich Willkommen"
 * "02-onboarding-social-leads-academy" → "Onboarding Social Leads Academy"
 */
export function folderNameToTitle(folderName: string): string {
  return folderName
    // Remove leading numbers and separators (e.g., "01-1-", "02-")
    .replace(/^[\d]+-[\d]*-?/, "")
    // Replace remaining dashes with spaces
    .replace(/-/g, " ")
    // Capitalize each word
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim();
}

const SYSTEM_PROMPT = `Du bist ein Experte für die Aufbereitung von Video-Transkripten.

Deine Aufgabe:
1. Erstelle eine kurze TLDR-Zusammenfassung (2-3 Sätze)
2. Strukturiere den Text in sinnvolle Absätze
3. Füge Markdown-Formatierung hinzu:
   - **Fettschrift** für wichtige Begriffe und Kernaussagen
   - *Kursiv* für Betonungen
   - Überschriften (## oder ###) für klare Themenwechsel
   - Aufzählungen wo es Sinn macht

Regeln:
- Behalte den Originaltext bei, ändere keine Wörter
- Korrigiere nur offensichtliche Transkriptionsfehler
- Füge Absätze an natürlichen Sprechpausen ein
- Halte alles auf Deutsch`;

const USER_PROMPT_TEMPLATE = `Hier ist ein Video-Transkript das aufbereitet werden soll:

---
{transcript}
---

Antworte in folgendem Format:

## TLDR
[2-3 Sätze Zusammenfassung]

## Transkript

[Aufbereiteter Text mit Markdown-Formatierung]`;

/**
 * Polish a transcript using an LLM.
 * Returns separate summary and transcript.
 */
export async function polishTranscript(rawTranscript: string): Promise<PolishedTranscript> {
  if (!isConfigured()) {
    return {
      summary: "",
      transcript: rawTranscript,
    };
  }

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{transcript}", rawTranscript);

  const result = await prompt(userPrompt, SYSTEM_PROMPT, {
    maxTokens: 8192,
    temperature: 0.2,
  });

  // Parse the response
  const tldrMatch = result.match(/## TLDR\s*\n+([\s\S]*?)(?=\n## Transkript|$)/i);
  const transcriptMatch = result.match(/## Transkript\s*\n+([\s\S]*?)$/i);

  const summary = tldrMatch?.[1]?.trim() ?? "";
  const transcript = transcriptMatch?.[1]?.trim() ?? result;

  return {
    summary,
    transcript,
  };
}

/**
 * Generate a module summary from multiple lesson summaries.
 */
export async function generateModuleSummary(
  moduleName: string,
  lessonSummaries: Array<{ name: string; title: string; summary: string }>
): Promise<string> {
  if (!isConfigured() || lessonSummaries.length === 0) {
    return "";
  }

  const moduleTitle = folderNameToTitle(moduleName);

  const summariesText = lessonSummaries
    .map((l, i) => `### ${i + 1}. ${l.title}\n${l.summary}`)
    .join("\n\n");

  const result = await prompt(
    `Hier sind die Zusammenfassungen aller Lektionen des Moduls "${moduleTitle}":\n\n${summariesText}\n\nErstelle eine übergreifende Zusammenfassung des gesamten Moduls (5-8 Sätze). Fasse die wichtigsten Lernziele und Kernkonzepte zusammen.`,
    "Du bist ein Experte für Kurszusammenfassungen. Antworte auf Deutsch in klarem, präzisem Stil.",
    { maxTokens: 512, temperature: 0.3 }
  );

  return `# Zusammenfassung: ${moduleTitle}\n\n${result.trim()}\n\n---\n\n## Lektionen\n\n${summariesText}`;
}

