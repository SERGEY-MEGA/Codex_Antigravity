/**
 * Antigravity Codex — Puter SDK init, git clone, zip, infrastructure monitor.
 */

/* ?v=6 forces fresh ui/ai_handler after deploy */
import { sendChat, checkInfrastructure } from "./ai_handler.js?v=6";
import {
  applyTheme,
  persistTheme,
  loadTheme,
  openModal,
  closeModal,
  bindModalClosers,
  shouldShowWelcome,
  markWelcomeSeen,
  showWelcomeOverlay,
} from "./ui.js?v=6";

const KV_KEYS = {
  theme: "antigravity_theme",
  provider: "antigravity_provider",
  keys: "antigravity_api_keys",
  ollamaModel: "antigravity_ollama_model",
  model: "antigravity_model",
  taskProfile: "antigravity_task_profile",
  outputFormat: "antigravity_output_format",
};

const LS_PREFIX = "ac_";

function lsGet(k) {
  try {
    const s = localStorage.getItem(LS_PREFIX + k);
    if (s == null) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function lsSet(k, v) {
  try {
    localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
  } catch {
    /* ignore quota */
  }
}

/**
 * Puter KV when available; on reject (e.g. localhost / no session) fall back to localStorage
 * so init never throws and UI bindings always run.
 */
function createKV() {
  const localOnly = {
    get: async (k) => lsGet(k),
    set: async (k, v) => lsSet(k, v),
  };
  if (typeof puter === "undefined" || !puter.kv?.get || !puter.kv?.set) {
    return localOnly;
  }
  return {
    get: async (k) => {
      try {
        const v = await puter.kv.get(k);
        if (v !== null && v !== undefined) return v;
      } catch {
        /* Puter KV unavailable outside app context */
      }
      return lsGet(k);
    },
    set: async (k, v) => {
      try {
        await puter.kv.set(k, v);
      } catch {
        lsSet(k, v);
      }
    },
  };
}

async function safeKvGet(kv, key) {
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

let kv = null;
let apiKeys = { openai: "", gemini: "", anthropic: "", openrouter: "" };
let chatMessages = [];
let codeStudio = {
  code: "",
  language: "",
  fileName: "generated.txt",
  previewOpen: false,
  minimized: false,
  fullscreen: false,
};

function $(id) {
  return document.getElementById(id);
}

function appendChat(role, text) {
  const log = $("chat-log");
  if (!log) return;
  const wrap = document.createElement("div");
  wrap.className = "rounded-lg p-3 ag-glass text-left";
  wrap.style.borderLeft = `3px solid var(--ag-${role === "user" ? "accent" : "accent-secondary"})`;
  const label = role === "user" ? "Вы" : "ИИ";
  wrap.innerHTML = `<div class="text-xs font-bold mb-1" style="color:var(--ag-accent)">${label}</div><div class="whitespace-pre-wrap break-words">${escapeHtml(text)}</div>`;
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function setChatCellText(msgEl, text) {
  const cell = msgEl?.querySelector?.(".whitespace-pre-wrap");
  if (cell) cell.textContent = text;
}

function startAssistantProgress(msgEl) {
  const steps = [
    "Анализирую задачу…",
    "Планирую структуру решения…",
    "Генерирую код в Code Studio…",
    "Проверяю совместимость и детали…",
  ];
  let i = 0;
  setChatCellText(msgEl, steps[0]);
  const timer = setInterval(() => {
    i = (i + 1) % steps.length;
    setChatCellText(msgEl, steps[i]);
  }, 1300);
  return () => clearInterval(timer);
}

function getCodeStudioEl() {
  return {
    root: $("code-studio"),
    status: $("code-status"),
    body: $("code-window-body"),
    output: $("code-output"),
    preview: $("code-preview-frame"),
  };
}

function openCodeStudio() {
  const ui = getCodeStudioEl();
  if (!ui.root) return;
  ui.root.classList.remove("hidden");
  ui.root.setAttribute("aria-hidden", "false");
}

function closeCodeStudio() {
  const ui = getCodeStudioEl();
  if (!ui.root) return;
  ui.root.classList.add("hidden");
  ui.root.setAttribute("aria-hidden", "true");
}

function toggleCodeStudioMinimize() {
  const ui = getCodeStudioEl();
  if (!ui.root || !ui.body) return;
  codeStudio.minimized = !codeStudio.minimized;
  ui.root.classList.toggle("ag-minimized", codeStudio.minimized);
  ui.body.style.display = codeStudio.minimized ? "none" : "";
}

function toggleCodeStudioFullscreen() {
  const ui = getCodeStudioEl();
  if (!ui.root) return;
  codeStudio.fullscreen = !codeStudio.fullscreen;
  ui.root.classList.toggle("ag-fullscreen", codeStudio.fullscreen);
}

function toggleCodePreview() {
  const ui = getCodeStudioEl();
  if (!ui.body || !ui.preview) return;
  codeStudio.previewOpen = !codeStudio.previewOpen;
  ui.body.classList.toggle("ag-preview-open", codeStudio.previewOpen);
  ui.preview.classList.toggle("hidden", !codeStudio.previewOpen);
  if (codeStudio.previewOpen) {
    const html = buildPreviewHTML(codeStudio.code, codeStudio.language);
    ui.preview.srcdoc = html;
  }
}

function buildPreviewHTML(code, language) {
  if (language === "html" || /<!doctype html>|<html[\s>]/i.test(code)) return code;
  if (language === "css") {
    return `<!doctype html><html><head><style>${code}</style></head><body><h2>CSS предпросмотр</h2><p>Добавьте HTML для полного рендера.</p></body></html>`;
  }
  if (language === "javascript" || language === "js") {
    return `<!doctype html><html><body><h2>JS предпросмотр</h2><div id="app">Скрипт выполнен.</div><script>${code}<\/script></body></html>`;
  }
  return `<!doctype html><html><body><pre>${escapeHtml(code)}</pre></body></html>`;
}

function extractCodeBlocks(text) {
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push({
      language: (m[1] || "").toLowerCase(),
      code: m[2] || "",
    });
  }
  return blocks;
}

function textWithoutCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function extractPlainCodeCandidate(text) {
  const byLabel = text.match(/(?:Файл|File)\s*:\s*([^\n]+)\n([\s\S]+)/i);
  if (!byLabel) return null;
  const fileName = byLabel[1].trim();
  const code = byLabel[2].trim();
  if (!code || code.length < 40) return null;
  const language = fileName.split(".").pop()?.toLowerCase() || "";
  return { fileName, language, code };
}

async function streamCodeToStudio(code, language) {
  const ui = getCodeStudioEl();
  if (!ui.output || !ui.status) return;
  openCodeStudio();
  if (codeStudio.minimized) toggleCodeStudioMinimize();
  codeStudio.code = "";
  codeStudio.language = language || "";
  codeStudio.fileName = suggestFileName(language, code);
  ui.output.textContent = "";
  ui.status.textContent = `Генерация: ${codeStudio.fileName}`;

  const chunkSize = Math.max(12, Math.floor(code.length / 260));
  for (let i = 0; i < code.length; i += chunkSize) {
    codeStudio.code += code.slice(i, i + chunkSize);
    ui.output.textContent = codeStudio.code;
    await new Promise((r) => setTimeout(r, 12));
  }
  ui.status.textContent = `Готово: ${codeStudio.fileName}`;

  if (codeStudio.previewOpen && ui.preview) {
    ui.preview.srcdoc = buildPreviewHTML(codeStudio.code, codeStudio.language);
  }
}

function suggestFileName(language, code) {
  const lang = (language || "").toLowerCase();
  if (lang === "html" || /<!doctype html>|<html[\s>]/i.test(code)) return "index.html";
  if (lang === "css") return "styles.css";
  if (lang === "javascript" || lang === "js") return "app.js";
  if (lang === "typescript" || lang === "ts") return "app.ts";
  if (lang === "python" || lang === "py") return "main.py";
  return "generated.txt";
}

async function downloadStudioZip() {
  if (!codeStudio.code) {
    alert("Сначала сгенерируйте код.");
    return;
  }
  const mod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  const JSZip = mod.default;
  const zip = new JSZip();
  zip.file(codeStudio.fileName, codeStudio.code);
  zip.file(
    "README.txt",
    `Generated by Antigravity Code Studio\nFile: ${codeStudio.fileName}\nLanguage: ${codeStudio.language || "plain"}\n`
  );
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "antigravity-code-studio.zip";
  a.click();
  URL.revokeObjectURL(a.href);
}

function updateProviderUI() {
  const prov = $("ai-provider")?.value || "puter";
  const ollamaBlock = $("ollama-block");
  const keysBlock = $("keys-block");
  const keyInput = $("api-key-input");
  if (ollamaBlock) ollamaBlock.classList.toggle("hidden", prov !== "ollama");
  if (keysBlock) keysBlock.classList.toggle("hidden", !["openai", "gemini", "anthropic", "openrouter"].includes(prov));
  if (keyInput) {
    if (prov === "openai") keyInput.value = apiKeys.openai || "";
    else if (prov === "gemini") keyInput.value = apiKeys.gemini || "";
    else if (prov === "anthropic") keyInput.value = apiKeys.anthropic || "";
    else if (prov === "openrouter") keyInput.value = apiKeys.openrouter || "";
    else keyInput.value = "";
  }
}

async function saveKeysToKV() {
  if (kv) await kv.set(KV_KEYS.keys, apiKeys);
}

async function cloneRepository(gitUrl) {
  const status = $("clone-status");
  if (!gitUrl?.trim()) {
    if (status) status.textContent = "Укажите URL репозитория.";
    return;
  }
  if (typeof puter === "undefined" || !puter.fs?.write) {
    if (status) status.textContent = "Клонирование доступно только в среде Puter (виртуальная ФС).";
    return;
  }

  const parsed = parseGitHubRepoUrl(gitUrl.trim());
  if (!parsed) {
    if (status) status.textContent = "Нужен валидный URL GitHub репозитория.";
    return;
  }

  try {
    if (status) status.textContent = `Скачивание репозитория ${parsed.owner}/${parsed.repo}…`;
    const { buffer, branch } = await fetchGithubZip(parsed.owner, parsed.repo);

    if (status) status.textContent = "Распаковка архива…";
    const JSZipMod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const JSZip = JSZipMod.default;
    const zip = await JSZip.loadAsync(buffer);

    const rootPrefix = `${parsed.repo}-${branch}/`;
    const destRoot = `AntigravityProjects/${parsed.repo}`;
    const entries = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
    if (entries.length === 0) throw new Error("Архив пустой или недоступный.");

    if (status) status.textContent = `Запись ${entries.length} файлов в Puter…`;
    let written = 0;
    for (const fullPath of entries) {
      const rel = fullPath.startsWith(rootPrefix) ? fullPath.slice(rootPrefix.length) : fullPath;
      if (!rel || rel.startsWith(".git/")) continue;
      const file = zip.files[fullPath];
      const content = await file.async("uint8array");
      const data = toPuterWriteData(content);
      await puter.fs.write(`${destRoot}/${rel}`, data, { createMissingParents: true });
      written += 1;
    }

    await puter.fs.write(
      `${destRoot}/.codex-meta.json`,
      JSON.stringify(
        {
          source: `${parsed.owner}/${parsed.repo}`,
          branch,
          files: written,
          clonedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { createMissingParents: true }
    );

    if (status) status.textContent = `Готово: ${destRoot} (${written} файлов)`;
    const zipPath = $("zip-path");
    if (zipPath) zipPath.value = destRoot;
    appendChat("assistant", `Репозиторий ${parsed.owner}/${parsed.repo} загружен в ${destRoot}.`);
  } catch (e) {
    console.error(e);
    if (status)
      status.textContent =
        "Ошибка: " +
        (e.message || String(e)) +
        " Проверьте URL репозитория и доступ к GitHub.";
  }
}

function parseGitHubRepoUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

async function fetchGithubZip(owner, repo) {
  const branches = ["main", "master"];
  for (const branch of branches) {
    const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
    try {
      const r = await fetch(zipUrl, { method: "GET", signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const buffer = await r.arrayBuffer();
      return { buffer, branch };
    } catch {
      // try next branch
    }
  }
  throw new Error("Не удалось скачать ZIP (ветки main/master).");
}

function toPuterWriteData(uint8) {
  const u = uint8 instanceof Uint8Array ? uint8 : new Uint8Array(uint8);
  for (let i = 0; i < Math.min(u.length, 8000); i++) {
    if (u[i] === 0) return new Blob([u]);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u);
  } catch {
    return new Blob([u]);
  }
}

async function zipProjectFolder(folderPath) {
  if (typeof puter === "undefined" || !puter.fs?.readdir) {
    alert("Скачивание ZIP доступно в Puter.");
    return;
  }
  let JSZip;
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    JSZip = mod.default;
  } catch (e) {
    alert("Не удалось загрузить JSZip: " + e.message);
    return;
  }
  const zip = new JSZip();
  const base = folderPath?.trim() || ".";
  try {
    await addDirToZip(base, zip, "");
  } catch (e) {
    alert("Ошибка чтения папки: " + (e.message || e));
    return;
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `antigravity-${(base.split("/").pop() || "project").replace(/[^a-z0-9-_]/gi, "_")}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * @param {string} puterPath
 * @param {import('jszip')} zip
 * @param {string} prefix
 */
async function addDirToZip(puterPath, zip, prefix) {
  const items = await puter.fs.readdir(puterPath);
  for (const item of items) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.is_dir) {
      await addDirToZip(item.path, zip, rel);
    } else {
      const data = await puter.fs.read(item.path);
      if (typeof data === "string") zip.file(rel, data);
      else if (data instanceof Blob) zip.file(rel, data);
      else if (data instanceof ArrayBuffer) zip.file(rel, data);
      else zip.file(rel, String(data));
    }
  }
}

async function createNewProject() {
  if (typeof puter === "undefined" || !puter.fs?.mkdir) {
    alert("Создание проекта доступно в Puter.");
    return;
  }
  const name = `AntigravityProjects/Проект-${Date.now()}`;
  await puter.fs.mkdir(name, { createMissingParents: true });
  await puter.fs.write(
    `${name}/README.md`,
    "# Новый проект\n\nСоздано в **Кодексе Антигравитации** (MEGA FUTURE AI).\n",
    { createMissingParents: true }
  );
  const zipPath = $("zip-path");
  if (zipPath) zipPath.value = name;
  alert(`Проект создан: ${name}`);
}

function startInfrastructureMonitor() {
  const elMode = $("mon-mode");
  const elNet = $("mon-internet");
  const elOll = $("mon-ollama");

  async function tick() {
    const infra = await checkInfrastructure();
    const online = Boolean(infra.internet);
    const ollamaOk = Boolean(infra.ollama);
    const backendOk = Boolean(infra.backendAvailable);

    if (elMode) {
      elMode.innerHTML = backendOk
        ? `<span class="w-2 h-2 rounded-full inline-block" style="background:var(--ag-success)"></span> Режим: <span class="ag-status-ok">Local backend connected</span>`
        : `<span class="w-2 h-2 rounded-full inline-block" style="background:var(--ag-danger)"></span> Режим: <span class="ag-status-bad">Puter-only / direct</span>`;
    }

    if (elNet) {
      elNet.innerHTML = online
        ? `<span class="w-2 h-2 rounded-full inline-block" style="background:var(--ag-success)"></span> Интернет: <span class="ag-status-ok">доступен</span>`
        : `<span class="w-2 h-2 rounded-full inline-block" style="background:var(--ag-danger)"></span> Интернет: <span class="ag-status-bad">недоступен</span>`;
    }
    if (elOll) {
      elOll.innerHTML = ollamaOk
        ? `<span class="w-2 h-2 rounded-full inline-block" style="background:var(--ag-success)"></span> Ollama: <span class="ag-status-ok">localhost:11434</span>`
        : `<span class="w-2 h-2 rounded-full inline-block" style="background:var(--ag-danger)"></span> Ollama: <span class="ag-status-bad">недоступен</span>`;
    }
  }

  tick();
  setInterval(tick, 8000);
}

/**
 * Welcome: HTMLDialogElement + simple click handlers (browser top-layer).
 */
function bindWelcomePanel() {
  const nativeDlg = document.getElementById("welcome-native-dialog");
  const fill = document.getElementById("welcome-fill");
  let lastWelcomeMs = 0;

  async function runWelcomeAction(action) {
    const now = performance.now();
    if (now - lastWelcomeMs < 400) return;
    lastWelcomeMs = now;

    if (action === "dismiss") {
      try {
        await markWelcomeSeen(kv);
      } catch {
        lsSet("antigravity_welcome_seen", true);
      }
      showWelcomeOverlay(false);
      return;
    }
    if (action === "new") {
      try {
        await createNewProject();
      } catch (err) {
        alert("Не удалось создать проект: " + (err?.message || err));
      }
      try {
        await markWelcomeSeen(kv);
      } catch {
        lsSet("antigravity_welcome_seen", true);
      }
      showWelcomeOverlay(false);
      return;
    }
    if (action === "git") {
      showWelcomeOverlay(false);
      requestAnimationFrame(() => $("git-url")?.focus());
      return;
    }
    if (action === "ai") {
      showWelcomeOverlay(false);
      requestAnimationFrame(() => $("ai-provider")?.focus());
    }
  }

  fill?.addEventListener("click", (e) => {
    if (e.target === fill) void runWelcomeAction("dismiss");
  });

  nativeDlg?.querySelectorAll("[data-welcome-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = btn.getAttribute("data-welcome-action");
      if (action) void runWelcomeAction(action);
    });
  });

  nativeDlg?.addEventListener("cancel", (e) => {
    e.preventDefault();
    showWelcomeOverlay(false);
  });
}

async function openInstructionsInPuterWindow() {
  if (typeof puter === "undefined" || !puter.ui?.createWindow) return false;
  try {
    await puter.ui.createWindow({
      title: "Инструкции — Кодекс Антигравитации",
      content: `<div style="padding:1rem;font-family:system-ui;line-height:1.5;color:#111"><strong>Ollama:</strong> OLLAMA_ORIGINS="*"<br><strong>Ключи:</strong> OpenAI, Google AI Studio, Anthropic<br><strong>Vibe Coding:</strong> редактор и puter.ai в Puter</div>`,
      disable_parent_window: true,
      width: 420,
      height: 220,
      center: true,
      has_head: true,
      is_resizable: true,
    });
    return true;
  } catch {
    return false;
  }
}

function bindAllUI() {
  bindModalClosers();

  $("btn-theme")?.addEventListener("click", () => openModal("modal-theme"));
  $("btn-instructions")?.addEventListener("click", () => openModal("modal-instructions"));
  $("btn-code-studio")?.addEventListener("click", () => openCodeStudio());
  $("btn-welcome")?.addEventListener("click", () => {
    showWelcomeOverlay(true);
  });
  $("btn-code-preview")?.addEventListener("click", () => toggleCodePreview());
  $("btn-code-fullscreen")?.addEventListener("click", () => toggleCodeStudioFullscreen());
  $("btn-code-minimize")?.addEventListener("click", () => toggleCodeStudioMinimize());
  $("btn-code-close")?.addEventListener("click", () => closeCodeStudio());
  $("btn-code-zip")?.addEventListener("click", () => downloadStudioZip());

  document.querySelectorAll(".theme-pick").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const t = btn.getAttribute("data-theme");
      if (t) {
        applyTheme(t);
        try {
          await persistTheme(kv, t);
        } catch {
          /* ignore */
        }
        if ($("theme-quick")) $("theme-quick").value = t;
        closeModal("modal-theme");
      }
    });
  });

  $("ai-provider")?.addEventListener("change", async () => {
    updateProviderUI();
    if (kv) {
      try {
        await kv.set(KV_KEYS.provider, $("ai-provider").value);
      } catch {
        /* ignore */
      }
    }
  });

  $("btn-save-key")?.addEventListener("click", async () => {
    const prov = $("ai-provider")?.value;
    const v = $("api-key-input")?.value?.trim() || "";
    if (prov === "openai") apiKeys.openai = v;
    else if (prov === "gemini") apiKeys.gemini = v;
    else if (prov === "anthropic") apiKeys.anthropic = v;
    else if (prov === "openrouter") apiKeys.openrouter = v;
    await saveKeysToKV();
    alert("Ключ сохранён (облако KV или локально).");
  });

  $("ollama-model")?.addEventListener("change", async () => {
    if (kv) {
      try {
        await kv.set(KV_KEYS.ollamaModel, $("ollama-model").value);
      } catch {
        /* ignore */
      }
    }
  });
  $("ollama-model")?.addEventListener("blur", async () => {
    if (kv) {
      try {
        await kv.set(KV_KEYS.ollamaModel, $("ollama-model").value);
      } catch {
        /* ignore */
      }
    }
  });

  $("model-input")?.addEventListener("change", async () => {
    if (!kv) return;
    try {
      await kv.set(KV_KEYS.model, $("model-input").value || "");
    } catch {
      /* ignore */
    }
  });
  $("task-profile")?.addEventListener("change", async () => {
    if (!kv) return;
    try {
      await kv.set(KV_KEYS.taskProfile, $("task-profile").value || "general");
    } catch {
      /* ignore */
    }
  });
  $("output-format")?.addEventListener("change", async () => {
    if (!kv) return;
    try {
      await kv.set(KV_KEYS.outputFormat, $("output-format").value || "full");
    } catch {
      /* ignore */
    }
  });
  $("theme-quick")?.addEventListener("change", async () => {
    const t = $("theme-quick")?.value;
    if (!t) return;
    applyTheme(t);
    await persistTheme(kv, t);
  });

  $("btn-clone")?.addEventListener("click", () => cloneRepository($("git-url")?.value));
  $("btn-zip")?.addEventListener("click", () => zipProjectFolder($("zip-path")?.value));

  bindWelcomePanel();

  $("btn-send")?.addEventListener("click", (e) => {
    e.preventDefault();
    onSend();
  });
  $("chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });

  document.getElementById("btn-puter-instructions-window")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    const ok = await openInstructionsInPuterWindow();
    if (!ok) alert("Окно Puter недоступно в этой среде. Используйте модальное окно ниже.");
  });
}

async function init() {
  kv = createKV();
  bindAllUI();
  startInfrastructureMonitor();

  try {
    await loadTheme(kv);

    const storedKeys = await safeKvGet(kv, KV_KEYS.keys);
    if (storedKeys && typeof storedKeys === "object") {
      apiKeys = {
        openai: storedKeys.openai || "",
        gemini: storedKeys.gemini || "",
        anthropic: storedKeys.anthropic || "",
        openrouter: storedKeys.openrouter || "",
      };
    }
    const prov = await safeKvGet(kv, KV_KEYS.provider);
    if ($("ai-provider") && prov) $("ai-provider").value = prov;
    const om = await safeKvGet(kv, KV_KEYS.ollamaModel);
    if ($("ollama-model") && om) $("ollama-model").value = om;
    const mdl = await safeKvGet(kv, KV_KEYS.model);
    if ($("model-input") && mdl) $("model-input").value = mdl;
    const profile = await safeKvGet(kv, KV_KEYS.taskProfile);
    if ($("task-profile") && profile) $("task-profile").value = profile;
    const format = await safeKvGet(kv, KV_KEYS.outputFormat);
    if ($("output-format") && format) $("output-format").value = format;

    updateProviderUI();
    const currentTheme =
      document.documentElement.getAttribute("data-theme") || "antigravity-blue";
    if ($("theme-quick")) $("theme-quick").value = currentTheme;

    const show = await shouldShowWelcome(kv);
    showWelcomeOverlay(show);
  } catch (err) {
    console.warn("Antigravity init (non-fatal):", err);
    showWelcomeOverlay(true);
  }
}

async function onSend() {
  const input = $("chat-input");
  const text = input?.value?.trim();
  if (!text) return;
  input.value = "";
  appendChat("user", text);
  chatMessages.push({ role: "user", content: text });
  appendChat("assistant", "Запускаю AI Studio…");

  const log = $("chat-log");
  const pending = log?.lastElementChild;
  const stopProgress = startAssistantProgress(pending);

  try {
    const provider = $("ai-provider")?.value || "puter";
    const ollamaModel = $("ollama-model")?.value || "llama3.2";
    const model = $("model-input")?.value?.trim() || "";
    const taskProfile = $("task-profile")?.value || "general";
    const outputFormat = $("output-format")?.value || "full";
    const reply = await sendChat(provider, apiKeys, ollamaModel, [...chatMessages], {
      model,
      taskProfile,
      outputFormat,
    });
    stopProgress();
    chatMessages.push({ role: "assistant", content: reply });

    const blocks = extractCodeBlocks(reply);
    const explanation = textWithoutCodeBlocks(reply);
    if (blocks.length > 0) {
      const primary = blocks[0];
      await streamCodeToStudio(primary.code, primary.language);
      setChatCellText(
        pending,
        explanation ||
          `Код сгенерирован в Code Studio (${suggestFileName(primary.language, primary.code)}). Вы можете открыть предпросмотр, полноэкранный режим и скачать ZIP.`
      );
    } else {
      const plain = extractPlainCodeCandidate(reply);
      if (plain) {
        codeStudio.fileName = plain.fileName;
        await streamCodeToStudio(plain.code, plain.language);
        setChatCellText(
          pending,
          explanation ||
            `Код выделен и отправлен в Code Studio (${plain.fileName}). Если нужно, попрошу ИИ форматировать ответ строго по файлам.`
        );
      } else {
        setChatCellText(pending, reply);
      }
    }
  } catch (e) {
    stopProgress();
    const msg = e.message || String(e);
    setChatCellText(pending, "Ошибка: " + msg);
    chatMessages.pop();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}