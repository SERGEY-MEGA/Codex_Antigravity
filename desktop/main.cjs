const path = require("path");
const fs = require("fs");
const http = require("http");
const { app, BrowserWindow, Menu, dialog } = require("electron");
const { spawn } = require("child_process");

let backendProc = null;
let webServer = null;
let webPort = null;
let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function startBackend() {
  const serverEntry = path.join(__dirname, "..", "server", "index.js");
  backendProc = spawn(process.execPath, [serverEntry], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: process.env.PORT || "8787" },
    stdio: "ignore",
    detached: false,
  });
}

function stopBackend() {
  if (!backendProc || backendProc.killed) return;
  try {
    backendProc.kill("SIGTERM");
  } catch {
    // ignore
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "text/plain; charset=utf-8";
}

function startFrontendServer() {
  return new Promise((resolve, reject) => {
    const root = path.join(__dirname, "..");
    webServer = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url, "http://127.0.0.1");
        const safePath = decodeURIComponent(reqUrl.pathname.replace(/^\/+/, ""));
        const target = path.join(root, safePath || "index.html");
        const normalized = path.normalize(target);
        if (!normalized.startsWith(root)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        let filePath = normalized;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.setHeader("Content-Type", getContentType(filePath));
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err?.message || err));
      }
    });
    webServer.once("error", reject);
    webServer.listen(0, "127.0.0.1", () => {
      webPort = webServer.address().port;
      resolve(webPort);
    });
  });
}

function stopFrontendServer() {
  if (!webServer) return;
  try {
    webServer.close();
  } catch {
    // ignore
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    title: "Antigravity Codex",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const url = `http://127.0.0.1:${webPort}/index.html?v=desktop6`;
  mainWindow.loadURL(url);
}

async function boot() {
  try {
    Menu.setApplicationMenu(null);
    startBackend();
    await startFrontendServer();
    createWindow();
  } catch (err) {
    await dialog.showErrorBox(
      "Antigravity Codex — Startup error",
      `Не удалось запустить приложение:\n${String(err?.message || err)}`
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && webPort) createWindow();
  });
}

app.whenReady().then(boot);

app.on("before-quit", () => {
  stopFrontendServer();
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
