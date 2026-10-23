const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BACKEND_DIR = path.join(__dirname, "backend");
const VENV_PYTHON = path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe");
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");

let win = null;
const jobs = new Map();
let nextJobId = 1;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#15171c",
    title: "Video Text Translator",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function pythonExecutable() {
  return fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python";
}

function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => {});
  } else {
    proc.kill("SIGKILL");
  }
}

ipcMain.handle("py:run", (_event, command, cfg) => {
  const jobId = nextJobId++;
  const cfgPath = path.join(os.tmpdir(), `vt-${process.pid}-${jobId}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf-8");

  return new Promise((resolve) => {
    const proc = spawn(pythonExecutable(), ["-m", "vt.cli", command, "--config", cfgPath], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    jobs.set(jobId, proc);
    win.webContents.send("py:started", { jobId, command });

    let buffer = "";
    let result = null;
    let error = null;
    let stderrTail = "";

    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "result") result = evt;
          else if (evt.type === "error") error = evt.message;
          else win.webContents.send("py:event", { jobId, command, ...evt });
        } catch {
          /* ignore non-JSON output */
        }
      }
    });
    proc.stderr.setEncoding("utf-8");
    proc.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
    });
    proc.on("error", (err) => {
      error = `Cannot start Python: ${err.message}`;
    });
    proc.on("close", (code, signal) => {
      jobs.delete(jobId);
      fs.rm(cfgPath, () => {});
      if (signal || (code !== 0 && !error && !result)) {
        resolve({ ok: false, cancelled: !!signal || code === null, error: error || stderrTail || `exit ${code}` });
      } else if (error) {
        resolve({ ok: false, error });
      } else {
        resolve({ ok: true, result });
      }
    });
  });
});

ipcMain.handle("py:cancel", () => {
  for (const proc of jobs.values()) killTree(proc);
});

ipcMain.handle("dialog:openVideo", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Chọn video",
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("dialog:pickFont", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Chọn font (.ttf/.otf)",
    defaultPath: "C:\\Windows\\Fonts",
    properties: ["openFile"],
    filters: [{ name: "Font", extensions: ["ttf", "otf", "ttc"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("dialog:saveVideo", async (_event, defaultPath) => {
  const r = await dialog.showSaveDialog(win, {
    title: "Lưu video đã dịch",
    defaultPath,
    filters: [{ name: "MP4", extensions: ["mp4"] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle("project:load", (_event, file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
});

ipcMain.handle("project:save", (_event, file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  return true;
});

ipcMain.handle("settings:load", () => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf-8"));
  } catch {
    return null;
  }
});

ipcMain.handle("settings:save", (_event, data) => {
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(data, null, 2), "utf-8");
  return true;
});

ipcMain.handle("app:previewPath", () => path.join(app.getPath("userData"), "preview.png"));
ipcMain.handle("app:proxyPath", () => path.join(app.getPath("userData"), "proxy.mp4"));
ipcMain.handle("shell:reveal", (_event, file) => shell.showItemInFolder(file));
ipcMain.handle("shell:open", (_event, file) => shell.openPath(file));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  for (const proc of jobs.values()) killTree(proc);
  app.quit();
});
