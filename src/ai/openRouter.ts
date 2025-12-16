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

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number | undefined; // USD, if available
}

export interface ChatResult {
  content: string;
  usage: UsageInfo;
  model: string;
}

// Track cumulative usage across calls
let cumulativeUsage: UsageInfo = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: undefined,
};

/**
 * Get cumulative usage stats for the current session.
 */
export function getCumulativeUsage(): UsageInfo {
  return { ...cumulativeUsage };
}

/**
 * Reset cumulative usage stats.
 */
export function resetCumulativeUsage(): void {
  cumulativeUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: undefined,
  };
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

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  // OpenRouter sometimes includes cost directly
  total_cost?: number;
}

/**
 * Send a chat completion request to OpenRouter.
 * Returns full result with usage info.
 */
export async function chatWithUsage(
  messages: ChatMessage[],
  options: OpenRouterOptions = {}
): Promise<ChatResult> {
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

  const data = (await response.json()) as OpenRouterResponse;

  const usage: UsageInfo = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    cost: data.total_cost,
  };

  // Accumulate usage
  cumulativeUsage.promptTokens += usage.promptTokens;
  cumulativeUsage.completionTokens += usage.completionTokens;
  cumulativeUsage.totalTokens += usage.totalTokens;
  if (usage.cost !== undefined) {
    cumulativeUsage.cost = (cumulativeUsage.cost ?? 0) + usage.cost;
  }

  return {
    content: data.choices[0]?.message?.content ?? "",
    usage,
    model: data.model ?? model,
  };
}

/**
 * Send a chat completion request to OpenRouter.
 * Simple version that just returns the content string.
 */
export async function chat(
  messages: ChatMessage[],
  options: OpenRouterOptions = {}
): Promise<string> {
  const result = await chatWithUsage(messages, options);
  return result.content;
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

