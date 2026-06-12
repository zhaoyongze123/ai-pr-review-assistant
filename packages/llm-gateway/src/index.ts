import type { Client } from "langsmith";
import { traceable } from "langsmith/traceable";
import {
  ReviewTriageDecisionSchema,
  SecondPassReviewResultSchema,
  type ReviewTriageDecision,
  type SecondPassReviewResult,
} from "@ai-pr-review/shared-types";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionInput = {
  apiBase: string;
  apiKey: string;
  provider: string;
  model: string;
  fallbackApiBase?: string;
  fallbackApiKey?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  promptKind: string;
  messages: ChatMessage[];
  temperature?: number;
  langsmith?: LangsmithTraceOptions;
};

export type ChatCompletionResult<TParsed> = {
  parsed: TParsed;
  rawContent: string;
  responseId?: string;
  finishReason?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  provider: string;
  model: string;
  requestMetadata: Record<string, unknown>;
  responseMetadata: Record<string, unknown>;
};

export type LangsmithTraceOptions = {
  name?: string;
  client?: Client;
  project_name?: string;
  tracingEnabled?: boolean;
  metadata?: Record<string, unknown>;
  tags?: string[];
};

const tracedFirstPassTriage = traceable(
  async function runFirstPassTriageImpl(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult<ReviewTriageDecision>> {
    const completion = await requestChatCompletion(input);
    const parsed = ReviewTriageDecisionSchema.parse(
      normalizeReviewTriageDecisionPayload(extractJson(completion.rawContent)),
    );

    return {
      parsed,
      rawContent: completion.rawContent,
      responseId: completion.payload.id,
      finishReason: completion.payload.choices?.[0]?.finish_reason,
      inputTokens: completion.payload.usage?.prompt_tokens ?? 0,
      outputTokens: completion.payload.usage?.completion_tokens ?? 0,
      latencyMs: completion.latencyMs,
      provider: input.provider,
      model: completion.payload.model ?? input.model,
      requestMetadata: {
        promptKind: input.promptKind,
        messageCount: input.messages.length,
        temperature: input.temperature ?? 0,
        apiBase: stripTrailingSlash(input.apiBase),
      },
      responseMetadata: {
        responseId: completion.payload.id,
        finishReason: completion.payload.choices?.[0]?.finish_reason,
        usage: completion.payload.usage ?? {},
      },
    };
  },
  {
    name: "first-pass-triage",
    run_type: "llm",
    argsConfigPath: [0, "langsmith"],
    getInvocationParams: (input) => ({
      ls_provider: input.provider,
      ls_model_type: "chat",
      ls_model_name: input.model,
      ls_temperature: input.temperature ?? 0,
      ls_invocation_params: {
        prompt_kind: input.promptKind,
        api_base: stripTrailingSlash(input.apiBase),
      },
    }),
    processInputs: (input) => ({
      provider: input.provider,
      model: input.model,
      promptKind: input.promptKind,
      temperature: input.temperature ?? 0,
      apiBase: stripTrailingSlash(input.apiBase),
      messages: input.messages,
    }),
    processOutputs: (output) => ({
      responseId: output.responseId,
      finishReason: output.finishReason,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      latencyMs: output.latencyMs,
      parsed: output.parsed,
      rawContent: output.rawContent,
    }),
  },
);

const tracedSecondPassReview = traceable(
  async function runSecondPassReviewImpl(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult<SecondPassReviewResult>> {
    const completion = await requestChatCompletion(input);
    const parsed = SecondPassReviewResultSchema.parse(
      extractJson(completion.rawContent),
    );

    return {
      parsed,
      rawContent: completion.rawContent,
      responseId: completion.payload.id,
      finishReason: completion.payload.choices?.[0]?.finish_reason,
      inputTokens: completion.payload.usage?.prompt_tokens ?? 0,
      outputTokens: completion.payload.usage?.completion_tokens ?? 0,
      latencyMs: completion.latencyMs,
      provider: input.provider,
      model: completion.payload.model ?? input.model,
      requestMetadata: {
        promptKind: input.promptKind,
        messageCount: input.messages.length,
        temperature: input.temperature ?? 0,
        apiBase: stripTrailingSlash(input.apiBase),
      },
      responseMetadata: {
        responseId: completion.payload.id,
        finishReason: completion.payload.choices?.[0]?.finish_reason,
        usage: completion.payload.usage ?? {},
      },
    };
  },
  {
    name: "second-pass-review",
    run_type: "llm",
    argsConfigPath: [0, "langsmith"],
    getInvocationParams: (input) => ({
      ls_provider: input.provider,
      ls_model_type: "chat",
      ls_model_name: input.model,
      ls_temperature: input.temperature ?? 0,
      ls_invocation_params: {
        prompt_kind: input.promptKind,
        api_base: stripTrailingSlash(input.apiBase),
      },
    }),
    processInputs: (input) => ({
      provider: input.provider,
      model: input.model,
      promptKind: input.promptKind,
      temperature: input.temperature ?? 0,
      apiBase: stripTrailingSlash(input.apiBase),
      messages: input.messages,
    }),
    processOutputs: (output) => ({
      responseId: output.responseId,
      finishReason: output.finishReason,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      latencyMs: output.latencyMs,
      parsed: output.parsed,
      rawContent: output.rawContent,
    }),
  },
);

export async function runFirstPassTriage(
  input: ChatCompletionInput,
): Promise<ChatCompletionResult<ReviewTriageDecision>> {
  return tracedFirstPassTriage(input);
}

export async function runSecondPassReview(
  input: ChatCompletionInput,
): Promise<ChatCompletionResult<SecondPassReviewResult>> {
  return tracedSecondPassReview(input);
}

type LlmCompletionPayload = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

async function requestChatCompletion(input: ChatCompletionInput): Promise<{
  payload: LlmCompletionPayload;
  rawContent: string;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const response = await fetch(buildChatCompletionsUrl(input.apiBase), {
    ...buildCompletionRequest(input.apiKey, input.model, input.messages, input.temperature),
  });

  if (!response.ok && hasFallbackTarget(input)) {
    return requestFallbackChatCompletion(input, {
      primaryStatus: response.status,
    });
  }

  if (!response.ok) {
    throw new Error(`LLM 网关请求失败，状态码 ${response.status}`);
  }

  const payload = (await response.json()) as LlmCompletionPayload;
  const rawContent = payload.choices?.[0]?.message?.content?.trim();
  if (!rawContent) {
    throw new Error("LLM 未返回可解析内容");
  }

  return {
    payload,
    rawContent,
    latencyMs: Date.now() - startedAt,
  };
}

async function requestFallbackChatCompletion(
  input: ChatCompletionInput,
  context: {
    primaryStatus?: number;
    primaryError?: unknown;
  },
): Promise<{
  payload: LlmCompletionPayload;
  rawContent: string;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const response = await fetch(buildChatCompletionsUrl(input.fallbackApiBase!), {
    ...buildCompletionRequest(
      input.fallbackApiKey!,
      input.fallbackModel ?? input.model,
      input.messages,
      input.temperature,
    ),
  });

  if (!response.ok) {
    const primaryMessage =
      context.primaryStatus !== undefined
        ? `主上游状态码 ${context.primaryStatus}`
        : context.primaryError instanceof Error
          ? `主上游异常 ${context.primaryError.message}`
          : "主上游请求失败";
    throw new Error(
      `${primaryMessage}；备用上游状态码 ${response.status}`,
    );
  }

  const payload = (await response.json()) as LlmCompletionPayload;
  const rawContent = payload.choices?.[0]?.message?.content?.trim();
  if (!rawContent) {
    throw new Error("备用 LLM 上游未返回可解析内容");
  }

  return {
    payload: {
      ...payload,
      model: payload.model ?? input.fallbackModel ?? input.model,
    },
    rawContent,
    latencyMs: Date.now() - startedAt,
  };
}

function hasFallbackTarget(input: ChatCompletionInput): boolean {
  return Boolean(
    input.fallbackApiBase?.trim() &&
      input.fallbackApiKey?.trim(),
  );
}

function buildCompletionRequest(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature?: number,
) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: temperature ?? 0,
    }),
  };
}

function extractJson(content: string): unknown {
  const normalized = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(normalized);
}

function normalizeReviewTriageDecisionPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const normalized = structuredClone(payload) as {
    rationale?: unknown;
    contextRequest?: {
      reason?: unknown;
    };
  };
  const rationale =
    typeof normalized.rationale === "string" ? normalized.rationale.trim() : "";
  const contextReason =
    typeof normalized.contextRequest?.reason === "string"
      ? normalized.contextRequest.reason.trim()
      : undefined;

  // 真实模型偶发会返回空 reason，这类输出可安全回填，避免把有效 triage 误记成 error。
  if (normalized.contextRequest && contextReason === "") {
    normalized.contextRequest.reason =
      rationale || "需要补充更多上下文后再继续审查";
  }

  return normalized;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildChatCompletionsUrl(apiBase: string): string {
  const normalizedBase = stripTrailingSlash(apiBase);

  // 兼容两类配置：
  // 1. https://host
  // 2. https://host/v1
  // 避免 provider 已带版本前缀时被重复拼成 /v1/v1/chat/completions。
  if (normalizedBase.endsWith("/v1")) {
    return `${normalizedBase}/chat/completions`;
  }

  return `${normalizedBase}/v1/chat/completions`;
}
