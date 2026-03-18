/**
 * Antigravity Codex local backend
 * - /api/health
 * - /api/infra
 * - /api/chat
 */

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

app.use(
  cors({
    origin: true,
    credentials: false,
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "antigravity-backend", port: PORT });
});

app.get("/api/infra", async (_req, res) => {
  const [internet, ollama] = await Promise.all([checkInternet(), checkOllama()]);
  res.json({
    ok: true,
    internet,
    ollama,
    ts: Date.now(),
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { provider, messages, ollamaModel, apiKey, model } = req.body || {};
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }

    let text;
    switch (provider) {
      case "ollama":
        text = await chatOllama(ollamaModel || model || "llama3.2", messages);
        break;
      case "openai":
        text = await chatOpenAI(apiKey || process.env.OPENAI_API_KEY, messages, model || "gpt-4o-mini");
        break;
      case "gemini":
        text = await chatGemini(apiKey || process.env.GEMINI_API_KEY, messages, model || "gemini-1.5-flash");
        break;
      case "anthropic":
        text = await chatAnthropic(
          apiKey || process.env.ANTHROPIC_API_KEY,
          messages,
          model || "claude-3-5-haiku-20241022"
        );
        break;
      case "openrouter":
        text = await chatOpenRouter(
          apiKey || process.env.OPENROUTER_API_KEY,
          messages,
          model || "openai/gpt-4o-mini"
        );
        break;
      default:
        return res.status(400).json({ error: "Unsupported provider for backend route" });
    }

    return res.json({ ok: true, text });
  } catch (error) {
    console.error("POST /api/chat failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Antigravity backend listening on http://localhost:${PORT}`);
});

async function checkInternet() {
  try {
    const r = await fetch("https://api.github.com/zen", {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "antigravity-codex-backend" },
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function checkOllama() {
  try {
    const r = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function formatMessagesAsPrompt(messages) {
  return messages
    .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content}`)
    .join("\n\n");
}

async function chatOllama(model, messages) {
  const body = {
    model,
    messages: normalizeMessages(messages, true),
    stream: false,
  };
  const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Ollama: ${r.status} ${t.slice(0, 220)}`);
  }
  const data = await r.json();
  return data.message?.content || JSON.stringify(data);
}

async function chatOpenAI(apiKey, messages, model) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: normalizeMessages(messages, true),
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI: ${r.status} ${t.slice(0, 220)}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function chatGemini(apiKey, messages, model) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: formatMessagesAsPrompt(messages) }] }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini: ${r.status} ${t.slice(0, 220)}`);
  }
  const data = await r.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);
}

async function chatAnthropic(apiKey, messages, model) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing");
  const system = messages.find((m) => m.role === "system")?.content || "";
  const conv = messages.filter((m) => m.role !== "system");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: system || undefined,
      messages: normalizeMessages(conv, false),
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic: ${r.status} ${t.slice(0, 220)}`);
  }
  const data = await r.json();
  const block = data.content?.find((c) => c.type === "text");
  return block?.text || JSON.stringify(data);
}

async function chatOpenRouter(apiKey, messages, model) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "http://localhost:8765",
      "X-Title": "Antigravity Codex",
    },
    body: JSON.stringify({
      model,
      messages: normalizeMessages(messages, true),
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenRouter: ${r.status} ${t.slice(0, 220)}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

function normalizeMessages(messages, allowSystem) {
  return messages.map((m) => {
    const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
    if (!allowSystem && role === "system") return null;
    return { role, content: m.content };
  }).filter(Boolean);
}
