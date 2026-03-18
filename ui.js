/**
 * Theme switching and modal management for Antigravity Codex.
 */

const THEME_KEY = "antigravity_theme";
const WELCOME_KEY = "antigravity_welcome_seen";

export const THEMES = {
  "antigravity-blue": "Antigravity Blue",
  "cyberpunk-red": "Cyberpunk Red",
  "deep-space": "Deep Space",
  paper: "Paper",
};

/**
 * @param {string} themeId
 */
export function applyTheme(themeId) {
  const id = THEMES[themeId] ? themeId : "antigravity-blue";
  document.documentElement.setAttribute("data-theme", id);
  return id;
}

/** @param {{ set?: (k: string, v: unknown) => Promise<unknown> } | null} kv */
export async function persistTheme(kv, themeId) {
  try {
    if (kv?.set) await kv.set(THEME_KEY, themeId);
  } catch {
    /* caller may use localStorage via hybrid KV */
  }
}

export async function loadTheme(kv) {
  try {
    if (kv?.get) {
      const v = await kv.get(THEME_KEY);
      if (v && THEMES[v]) return applyTheme(v);
    }
  } catch {
    /* ignore */
  }
  return applyTheme("antigravity-blue");
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("ag-open");
  el.setAttribute("aria-hidden", "false");
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("ag-open");
  el.setAttribute("aria-hidden", "true");
}

export function bindModalClosers() {
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
  });
  document.querySelectorAll(".ag-modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.remove("ag-open");
    });
  });
}

/** @param {{ get?: (k: string) => Promise<unknown> } | null} kv */
export async function shouldShowWelcome(kv) {
  try {
    if (kv?.get) {
      const seen = await kv.get(WELCOME_KEY);
      if (seen === true || seen === "true") return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}

/** @param {{ set?: (k: string, v: unknown) => Promise<unknown> } | null} kv */
export async function markWelcomeSeen(kv) {
  try {
    if (kv?.set) await kv.set(WELCOME_KEY, true);
  } catch {
    try {
      localStorage.setItem("ac_" + WELCOME_KEY, JSON.stringify(true));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Welcome via <dialog>.showModal() — top layer above Puter UI.
 */
export function showWelcomeOverlay(show) {
  const dlg = document.getElementById("welcome-native-dialog");
  if (!dlg) return;
  if (show) {
    if (typeof dlg.showModal === "function") {
      try {
        if (!dlg.open) dlg.showModal();
      } catch {
        dlg.setAttribute("open", "");
        dlg.classList.add("ag-native-welcome--polyfill");
      }
    } else {
      dlg.setAttribute("open", "");
      dlg.classList.add("ag-native-welcome--polyfill");
    }
  } else {
    if (typeof dlg.close === "function" && dlg.open) dlg.close();
    else {
      dlg.removeAttribute("open");
      dlg.classList.remove("ag-native-welcome--polyfill");
    }
  }
}
