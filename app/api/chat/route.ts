import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type IncomingChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const MARKDOWN_SYSTEM_PROMPT =
  "You are a helpful reading assistant. Respond using GitHub-flavored Markdown (GFM).\n" +
  "- Use headings, bullet lists, and tables when helpful.\n" +
  "- Use short section headings (e.g. ###) to break up the answer.\n" +
  "- Bold the key terms and the most meaningful phrases.\n" +
  "- Use fenced code blocks with a language tag for code.\n" +
  "- Do NOT wrap the entire response in a single code block.\n" +
  "- Avoid raw HTML; prefer Markdown.\n";

function shouldLogAiPrompts(): boolean {
  const v = process.env.LOG_AI_PROMPTS;
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function truncateForLog(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars]`;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key is not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const { messages } = (await req.json()) as { messages?: unknown };

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Messages array is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Convert messages to OpenAI format
    const openaiMessagesFromClient: OpenAI.Chat.ChatCompletionMessageParam[] = (
      messages as IncomingChatMessage[]
    ).map((msg) => ({
      role:
        msg.role === "assistant"
          ? "assistant"
          : msg.role === "system"
            ? "system"
            : "user",
      content: String(msg.content ?? ""),
    }));

    // Always enforce Markdown-capable output (ChatGPT-like formatting).
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: MARKDOWN_SYSTEM_PROMPT },
      ...openaiMessagesFromClient,
    ];

    // Get model from environment variable, default to gpt-4o-mini
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (shouldLogAiPrompts()) {
      const maxCharsPerMessage = Number.parseInt(
        process.env.LOG_AI_PROMPTS_MAX_CHARS_PER_MESSAGE || "6000",
        10
      );
      const safeMax = Number.isFinite(maxCharsPerMessage) ? Math.max(0, maxCharsPerMessage) : 6000;

      console.log("[ai] Outgoing chat request", {
        model,
        messageCount: openaiMessages.length,
      });

      openaiMessages.forEach((m, idx) => {
        const role = "role" in m ? (m.role as string) : "unknown";
        const content =
          typeof (m as { content?: unknown }).content === "string"
            ? ((m as { content: string }).content ?? "")
            : JSON.stringify((m as { content?: unknown }).content ?? "");
        console.log(
          `[ai] message[${idx}] role=${role}\n${truncateForLog(content, safeMax)}`
        );
      });
    }

    // Create a streaming response
    const stream = await openai.chat.completions.create({
      model,
      messages: openaiMessages,
      stream: true,
    });

    // Create a ReadableStream to send the response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("OpenAI API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An error occurred",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
