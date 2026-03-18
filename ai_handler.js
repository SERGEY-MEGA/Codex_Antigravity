/**
 * Poly-model AI routing: Ollama, Puter AI, OpenAI, Gemini, Anthropic.
 */

const OLLAMA_BASE = "http://localhost:11434";
const DEFAULT_BACKEND_BASE = "http://localhost:8787";

function getBackendBase() {
  try {
    return localStorage.getItem("ac_backend_url") || DEFAULT_BACKEND_BASE;
  } catch {
    return DEFAULT_BACKEND_BASE;
  }
}

/**
 * @param {string} provider
 * @param {object} keys - { openai, gemini, anthropic }
 * @param {string} ollamaModel
 * @param {Array<{role: string, content: string}>} messages
 * @param {{model?: string, taskProfile?: string, outputFormat?: string}} options
 * @returns {Promise<string>}
 */
export async function sendChat(provider, keys, ollamaModel, messages, options = {}) {
  const systemPrompt = buildSystemPrompt(options.taskProfile, options.outputFormat);
  const enrichedMessages = withSystemPrompt(messages, systemPrompt);

  switch (provider) {
    case "puter": {
      if (typeof puter === "undefined" || !puter.ai?.chat) {
        throw new Error("Puter AI недоступен в этой среде.");
      }
      const prompt = formatMessagesAsPrompt(enrichedMessages);
      const res = await puter.ai.chat(prompt, {
        model: options.model || "gpt-5-mini",
      });
      if (typeof res === "string") return res;
      if (res?.message?.content) return res.message.content;
      if (res?.text) return res.text;
      return JSON.stringify(res);
    }
    case "ollama":
      return chatViaBackend("ollama", {
        messages: enrichedMessages,
        ollamaModel: ollamaModel || "llama3.2",
        model: options.model || "",
      });
    case "openai":
      return chatViaBackend("openai", {
        messages: enrichedMessages,
        apiKey: keys.openai || "",
        model: options.model || "",
      });
    case "gemini":
      return chatViaBackend("gemini", {
        messages: enrichedMessages,
        apiKey: keys.gemini || "",
        model: options.model || "",
      });
    case "anthropic":
      return chatViaBackend("anthropic", {
        messages: enrichedMessages,
        apiKey: keys.anthropic || "",
        model: options.model || "",
      });
    case "openrouter":
      return chatViaBackend("openrouter", {
        messages: enrichedMessages,
        apiKey: keys.openrouter || "",
        model: options.model || "openai/gpt-4o-mini",
      });
    default:
      throw new Error("Неизвестный провайдер.");
  }
}

function formatMessagesAsPrompt(messages) {
  return messages
    .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content}`)
    .join("\n\n");
}

function withSystemPrompt(messages, systemText) {
  const normalized = Array.isArray(messages) ? [...messages] : [];
  if (!systemText) return normalized;
  if (normalized.some((m) => m.role === "system")) return normalized;
  return [{ role: "system", content: systemText }, ...normalized];
}

function buildSystemPrompt(taskProfile = "general", outputFormat = "full") {
  const profileMap = {
    general:
      "Ты senior AI-инженер и fullstack-разработчик. Отвечай практично, делай рабочие примеры кода.",
    website:
      "Ты senior frontend engineer. Создавай современные сайты: HTML/CSS/JS, адаптивность, accessibility, SEO-база.",
    landing:
      "Ты senior UI/UX и conversion specialist. Дай структуру лендинга, CTA-блоки, тексты, и готовый код секций.",
    program:
      "Ты senior software engineer. Пиши программы и скрипты с архитектурой, обработкой ошибок и инструкцией запуска.",
    refactor:
      "Ты software architect. Анализируй код, предлагай рефакторинг, улучшай читаемость, тестируемость и производительность.",
  };
  const formatMap = {
    full: "Верни готовое решение и краткое объяснение.",
    "code-first": "Сначала выдай код, затем коротко поясни.",
    steps: "Сначала дай пошаговый план, затем реализуй код по шагам.",
  };
  return `${profileMap[taskProfile] || profileMap.general} ${
    formatMap[outputFormat] || formatMap.full
  } Если в ответе есть код, обязательно оборачивай каждый файл в markdown-блок вида \`\`\`language ... \`\`\`. Для многофайлового ответа явно подпиши имя файла перед блоком. Всегда отвечай на русском языке.`;
}

async function chatViaBackend(provider, payload) {
  const base = getBackendBase();
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      ...payload,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Backend ${r.status}: ${t.slice(0, 240)}`);
  }
  const data = await r.json();
  return data?.text ?? JSON.stringify(data);
}

/**
 * Check Ollama /api/tags reachability.
 */
export async function checkOllama() {
  const infra = await checkInfrastructure();
  if (infra.backendAvailable) return Boolean(infra.ollama);
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function checkInfrastructure() {
  const base = getBackendBase();
  try {
    const r = await fetch(`${base}/api/infra`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`Backend ${r.status}`);
    const data = await r.json();
    return {
      backendAvailable: true,
      internet: Boolean(data.internet),
      ollama: Boolean(data.ollama),
    };
  } catch {
    return {
      backendAvailable: false,
      internet: navigator.onLine,
      ollama: false,
    };
  }
}
