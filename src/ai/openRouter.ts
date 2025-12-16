import { config } from "dotenv";

// Load .env file
config();

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Get the OpenRouter API key from environment.
 */
function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY not set. Add it to .env file or set as environment variable."
    );
  }
  return key;
}

/**
 * Get the default model from environment or use fallback.
 */
function getDefaultModel(): string {
  return process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-sonnet";
}

/**
 * Check if OpenRouter is configured.
 */
export function isConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Send a chat completion request to OpenRouter.
 */
export async function chat(
  messages: ChatMessage[],
  options: OpenRouterOptions = {}
): Promise<string> {
  const apiKey = getApiKey();
  const model = options.model ?? getDefaultModel();

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/course-grab",
      "X-Title": "course-grab",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? "";
}

/**
 * Simple prompt helper.
 */
export async function prompt(
  userPrompt: string,
  systemPrompt?: string,
  options?: OpenRouterOptions
): Promise<string> {
  const messages: ChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push({ role: "user", content: userPrompt });

  return chat(messages, options);
}

