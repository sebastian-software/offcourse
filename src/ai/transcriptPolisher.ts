import { prompt, isConfigured } from "./openRouter.js";

export interface PolishedTranscript {
  tldr: string;
  content: string;
  markdown: string;
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
- Halte die TLDR auf Deutsch`;

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
 */
export async function polishTranscript(rawTranscript: string): Promise<PolishedTranscript> {
  if (!isConfigured()) {
    // Return unpolished version if no API key
    return {
      tldr: "",
      content: rawTranscript,
      markdown: rawTranscript,
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

  const tldr = tldrMatch?.[1]?.trim() ?? "";
  const content = transcriptMatch?.[1]?.trim() ?? result;

  // Build the final markdown
  const markdown = tldr
    ? `## Zusammenfassung\n\n${tldr}\n\n---\n\n${content}`
    : content;

  return {
    tldr,
    content,
    markdown,
  };
}

/**
 * Generate just a TLDR summary.
 */
export async function generateTldr(transcript: string): Promise<string> {
  if (!isConfigured()) {
    return "";
  }

  const result = await prompt(
    `Fasse dieses Video-Transkript in 2-3 prägnanten Sätzen zusammen:\n\n${transcript}`,
    "Du bist ein Experte für prägnante Zusammenfassungen. Antworte auf Deutsch.",
    { maxTokens: 256, temperature: 0.3 }
  );

  return result.trim();
}

