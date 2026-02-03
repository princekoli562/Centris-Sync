
const { app, BrowserWindow, ipcMain,dialog, Tray, Menu,shell } = require('electron');
//const path = require('node:path');
const path = require("path");
const fs = require('fs');
const crypto = require('crypto');
const FormData = require('form-data'); 
const sudo = require("sudo-prompt");
const https = require("https");
const http = require("http");
const { pipeline,Readable } = require("stream");
const { promisify } = require("util");
const streamPipeline = promisify(pipeline);
const chokidar = require("chokidar");
let watcher = null;
let syncTimer = null;
let debounceTimer = null;
let autoExpireVal = false;
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

app.disableHardwareAcceleration();

//const dbPath = path.join(__dirname, "main", "db", "init-db.js");
//const { initDB, getDB } = require("./main/db/init-db");
const { initDB, getDB } = require("./main/db/init-db.js");
// console.log("DB PATH:", dbPath);
// const { initDB,getDB } = require(dbPath);
//const vhdxService = require(path.join(__dirname, "assets/js/vhdx-service.js"));
//const adminTasks  = require(path.join(__dirname, "assets/js/admin-task.js"));

//console.log(process.env.NODE_ENV);

console.log('PLATFORM - > ' + process.platform);
console.log("🔥 MAIN FILE PATH:", __filename);
console.log("🔥 CWD:", process.cwd());

process.on("uncaughtException", err => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", err => {
  console.error("❌ Unhandled Rejection:", err);
});



if (process.env.NODE_ENV === "development") {
  try {
    const path = require("path");
    const fs = require("fs");

    // Absolute path to Electron executable
    const electronBinary = path.join(__dirname, "node_modules", "electron", "dist", "electron.exe");
    const mainPath = path.join(__dirname, "main.js");

    if (!fs.existsSync(electronBinary)) {
      throw new Error(`Electron binary not found at ${electronBinary}`);
    }

    require("electron-reload")(mainPath, {
      electron: electronBinary,   // 🔥 must point to .exe
      usePolling: true,           // required for VHDX/mapped drives
      awaitWriteFinish: true,
      forceHardReset: true,
      hardResetMethod: "reload",
      ignored: /node_modules|[\/\\]\./,
    });

    console.log("✅ electron-reload enabled (polling mode)");
  } catch (err) {
    console.warn("⚠️ Electron reload not active:", err.message);
  }
}

// if (process.env.NODE_ENV === "development") {
//   try {
//     const path = require("path");
//     require("electron-reload")(__dirname, {
//       electron: path.join(__dirname, "node_modules", "electron", "dist", "electron.exe"),
//       usePolling: true,
//       awaitWriteFinish: true,
//       ignored: /node_modules|[\/\\]\./
//     });

//     console.log("🔄 electron-reload running");
//   } catch (err) {
//     console.warn("⚠ electron-reload failed:", err.message);
//   }
// }

const os = require('os');
const { execSync, exec,spawn } = require('child_process');
const SECRET_KEY = "25fHeqIXYAfa";
let win = null;
let tray;
const VHDX_NAME = "Centris-Drive.vhdx";
const VHDX_SIZE_MB = 10240; // 10 GB
const VOLUME_LABEL = "Centris-Drive";
const homeDir = os.homedir();
const VHDX_PATH = path.join(homeDir, VHDX_NAME);
let sessionData = null;
let syncCustomerId = null;
let syncDomainId = null;
let syncConfigData = null;
let redirectingToLogin = false;
let s2cPollingTimer = null;
let s2cSyncRunning = false;
//global.isSyncCancelled = false;

let syncData = {
  customer_data: null,
  domain_data: null,
  user_data: null,
  config_data: null,
  apiUrl: null,
};

const isDev = !app.isPackaged;

// const preloadPathgg = isDev
//     ? path.join(__dirname, "preload.js")
//     : path.join(process.resourcesPath, "app.asar.unpacked", "preload.js");

const preloadPath = isDev
    ? path.join(process.cwd(), "preload.js")
    : path.join(process.resourcesPath, "app.asar.unpacked", "preload.js");
    

// const iconPath = isDev
//     ? path.join(__dirname, "assets/images/favicon.ico")
//     : path.join(process.resourcesPath, "app.asar" ,"assets/images/favicon.ico");

const iconPath = isWindows
    ? (
        isDev
            ? path.join(__dirname, "assets/images/favicon.ico")
            : path.join(process.resourcesPath, "app.asar", "assets/images/favicon.ico")
      )
    : (
        isDev
            ? path.join(__dirname, "assets/images/favicon.icns")
            : path.join(process.resourcesPath, "app.asar", "assets/images/favicon.icns")
      );

// function sendLogToRenderer(message) {
//   win = BrowserWindow.getAllWindows()[0];
//   if (win && win.webContents) {
//     win.webContents.send('main-log', message);
//   }
// }

function sendLogToRenderer(message) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send('main-log', message);
  }
}

// Monkey-patch console.log to also send to renderer
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  try {
    sendLogToRenderer(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' '));
  } catch (err) {
    originalLog('Log mirror error:', err);
  }
};
//lll
const createWindow = async () => {
    
    win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false
            //webSecurity: false
        },
        icon: iconPath
    });

    // win = new BrowserWindow({
    //     width: 800,
    //     height: 600,
    //     webPreferences: {
    //         preload: preloadPath,
    //         contextIsolation: true,
    //         enableRemoteModule: false,
    //         nodeIntegration: false
    //     },
    //     ...(isWindows ? { icon: iconPath } : {icon: iconPath}) // mac ignores this
    // });

    // ✅ Use local session checker instead of win.electronAPI
    const sessionActive = isSessionActive({ autoExpire: autoExpireVal }); // function defined below
    console.log(sessionActive);
    if (sessionActive) {
        console.log("✅ Session active, redirecting to home...");
        await win.loadFile(getHtmlPath("home.html"));
    } else {
        console.log("🔒 Session expired or not logged in");
        await win.loadFile(getHtmlPath("index.html"));
    }

    //✅ Handle close — minimize to tray, not quit
    win.on('close', (event) => {
        if (!app.isQuiting) {
        event.preventDefault();
        win.hide(); // keep running in tray
        return false;
        }
    });

    win.webContents.on('did-finish-load', handleSessionCheck);
    //win.webContents.on('did-navigate', handleSessionCheck);

    // 🧩 Handle navigation from renderer
    // ipcMain.on('navigate', (event, page) => {
    //     if (page === 'home') {
    //         //win.loadFile('home.html')
    //         await win.loadFile(path.join(__dirname, 'home.html'))
    //             .then(() => console.log('🏠 Home page loaded'))
    //             .catch(err => console.error('Error loading home page:', err));
    //     } else if (page === 'login') {
    //         await win.loadFile(path.join(__dirname, 'index.html')
    //             .then(() => console.log('🔑 Login page loaded'))
    //             .catch(err => console.error('Error loading login page:', err));
    //     } else {
    //         console.error('Unknown page:', page);
    //     }
    // });

    ipcMain.on('navigate', async (event, page) => {
      try {
          if (page === 'home') {
              await win.loadFile(getHtmlPath('home.html'));
              console.log('🏠 Home page loaded');

          } else if (page === 'login') {
              await win.loadFile(getHtmlPath('index.html'));
              console.log('🔑 Login page loaded');

          } else {
              console.error('Unknown page:', page);
          }

        } catch (err) {
            console.error('Error during navigation:', err);
        }
    });

    ipcMain.handle("check-session-and-redirect", async (event, autoExpireVal) => {
  
        const sessionActive = isSessionActive({ autoExpire: autoExpireVal });
        console.log("Session Active:", sessionActive);

        if (sessionActive) {
            console.log("✅ Session active, redirecting to home...");
            await win.loadFile(getHtmlPath("home.html"));
            return { status: "active" };
        } else {
            console.log("🔒 Session expired or not logged in");
            await win.loadFile(getHtmlPath("index.html"));
            return { status: "expired" };
        }
    });

    // 🧩 Save session on login from renderer
    ipcMain.on('save-session', (event, sessionData) => {
        saveSession(sessionData);
    });

    // 🧩 Clear session on logout
    ipcMain.on('clear-session', () => {
        clearSession();
    });

    ipcMain.handle('load-session', async () => {
        return loadSession();
    });


    async function handleSessionCheck1() {
        if (!isSessionActive({ autoExpire: autoExpireVal }) && !redirectingToLogin) {
            redirectingToLogin = true;
            console.log("⚠️ Session expired — redirecting to login page...");

            try {
            await win.loadFile(getHtmlPath('index.html'));

            // ✅ wait for renderer to be ready
            win.webContents.once("did-finish-load", () => {
                console.log("🧪 fs-changed after redirect");
                win.webContents.openDevTools({ mode: 'detach' });

                setTimeout(() => {
                if (win && !win.isDestroyed()) {
                    win.webContents.send("fs-changed");
                }
                }, 1000);
            });

            } catch (err) {
            console.error("Error loading login page:", err);
            }

            redirectingToLogin = false;
        }
    }

    async function handleSessionCheck() {
        if (!isSessionActive({ autoExpire: autoExpireVal }) && !redirectingToLogin) {
            redirectingToLogin = true;
            console.log("⚠️ Session expired — redirecting to login page...");

            try {
            // Attach listener FIRST
            win.webContents.once("did-finish-load", () => {
                console.log("🧪 Renderer loaded after redirect");

                // Open DevTools (works in DMG + Guest)
                win.webContents.openDevTools({ mode: "detach" });

                setTimeout(() => {
                if (win && !win.isDestroyed()) {
                    win.webContents.send("fs-changed");
                }
                }, 500);
            });

            await win.loadFile(getHtmlPath("index.html"));

            } catch (err) {
            console.error("❌ Error loading login page:", err);
            } finally {
            redirectingToLogin = false;
            }
        }
    }



    function getHtmlPath1(file) {
        return isDev
            ? path.join(__dirname, file)                // Dev folder
            : path.join(process.resourcesPath, "app.asar", file); // Packaged EXE
    }

    function getHtmlPath(file) {
        if (isDev) {
            return path.join(process.cwd(), file);
        }
        return path.join(process.resourcesPath, "app.asar", file);
    }

};

function createTray() {
  //tray = new Tray(path.join(__dirname, 'assets/images/favicon.png'));
  const trayIconPath = isDev
    ? path.join(__dirname, "assets/images/favicon.png")                // dev
    : path.join(process.resourcesPath,"app.asar", "assets/images/favicon.png"); 

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Centris Drive',
      click: () => win.show(),
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('Centris Drive');
  tray.setContextMenu(contextMenu);
}



let watcherRunning = false;

async function startDriveWatcher(syncData) {
  try {
    if (!syncData?.config_data?.centris_drive) {
      console.warn("⚠️ Invalid syncData");
      return;
    }

    if (watcherRunning) {
      console.log("🟡 Drive watcher already running");
      return;
    }

    if (watcher) {
      await watcher.close();
      watcher = null;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const drive = cleanSegment(getMappedDriveLetter()); // "Z"
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);

    let DRIVE_ROOT = drive;//path.win32.normalize(`${drive}:\\${baseFolder}`);

    if (process.platform === "win32") {
        // Windows → add base folder
        DRIVE_ROOT = path.win32.normalize(`${drive}:\\${baseFolder}`);
    } else if (process.platform === "darwin") {
        // macOS → mount path is already correct
        DRIVE_ROOT = `${drive}/${baseFolder}`;
    }

    console.log("👀 Watching (polling):", DRIVE_ROOT);

    watcherRunning = true;

    watcher = chokidar.watch(DRIVE_ROOT, {
      persistent: true,
      ignoreInitial: true,
      depth: 10,

      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,

      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    const notifyRenderer = () => {
      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) {
          console.log("📤 fs-changed");
          win.webContents.send("fs-changed");
        }
      }, 6000);
    };

    watcher
      .on("add", notifyRenderer)
      .on("change", notifyRenderer)
      .on("unlink", notifyRenderer)
      .on("addDir", notifyRenderer)
      .on("unlinkDir", notifyRenderer)
      .on("ready", () => console.log("✅ Watcher ready"))
      .on("error", err => console.error("❌ Watcher error:", err));

  } catch (err) {
    console.error("❌ startDriveWatcher failed:", err);
    watcherRunning = false;
  }
}

async function stopDriveWatcher() {
    try {
        if (!watcher) {
            console.log("🟡 No watcher to stop");
            watcherRunning = false;
            return;
        }

        // Close chokidar watcher
        await watcher.close();
        watcher = null;
        watcherRunning = false;

        // Clear debounce timer if running
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        console.log("🛑 Drive watcher stopped");

    } catch (err) {
        console.error("❌ stopDriveWatcher failed:", err);
    }
}



// ✅ Helper: checks if session exists and is valid
function isSessionActiveTimer() {
    const sessionFile = path.join(app.getPath('userData'), 'session.json');

    try {
        if (fs.existsSync(sessionFile)) {
            const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
            const now = Date.now();
            const MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours

            if (sessionData.isLoggedIn && now - sessionData.loginTime < MAX_AGE) {
                return true;
            }
        }
    } catch (err) {
        console.error("⚠️ Error reading session file:", err);
    }
    return false;
}

function isSessionActive({ autoExpire = false, maxAge = 6 * 60 * 60 * 1000 } = {}) {
    const sessionFile = path.join(app.getPath('userData'), 'session.json');

    try {
        if (!fs.existsSync(sessionFile)) {
            return false;
        }

        const sessionData = JSON.parse(
            fs.readFileSync(sessionFile, 'utf8')
        );

        // not logged in
        if (!sessionData.isLoggedIn) {
            return false;
        }

        // manual mode → no expiry
        if (!autoExpire) {
            return true;
        }

        // auto expiry mode
        const now = Date.now();
        return (now - sessionData.loginTime) < maxAge;

    } catch (err) {
        console.error("⚠️ Error reading session file:", err);
        return false;
    }
}

//
function saveSession(data) {
    const sessionFile = path.join(app.getPath('userData'), 'session.json');
    try {
        const sessionData = {
            ...data,
            isLoggedIn: true,
            loginTime: Date.now(),
        };
        fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
        console.log("💾 Session saved:", sessionFile);
    } catch (err) {
        console.error("⚠️ Error saving session:", err);
    }
}

// ✅ Helper: clear session
function clearSession() {
    const sessionFile = path.join(app.getPath('userData'), 'session.json');
    try {
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            console.log("🗑️ Session cleared");
        }
    } catch (err) {
        console.error("⚠️ Error clearing session:", err);
    }
}

function loadSession() {
    const sessionFile = path.join(app.getPath('userData'), 'session.json');

    try {
        if (fs.existsSync(sessionFile)) {
            const raw = fs.readFileSync(sessionFile, "utf-8");
            return JSON.parse(raw);   // return saved session object
        }
    } catch (err) {
        console.error("⚠️ Error reading session:", err);
    }

    return {}; // default empty session
}


function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function compareServerAndDesktop(serverItems, tracker) {
    const missing = [];

    for (const item of serverItems) {
        const p = item.path.replace(/\//g, '\\');

        if (!tracker[p]) {
            missing.push(item);
            continue;
        }

        // Check for stale file
        if (item.mtime > tracker[p].mtime) {
            missing.push(item);
        }
    }

    return missing;
}

function removeDeleted(oldSnap, newSnap) {
    for (let key in oldSnap) {
        if (!newSnap[key]) {
            // deleted entry → handle delete logic
        }
    }
}


function loadTracker(onlyUnsynced = true) {
    const db = getDB();

    try {
        const rows = onlyUnsynced
            ? db.prepare(`
                SELECT path, type, hash, mtime, size, synced
                FROM tracker
                WHERE synced = 0
            `).all()
            : db.prepare(`
                SELECT path, type, hash, mtime, size, synced
                FROM tracker
            `).all();

        const tracker = {};
        for (const row of rows) {
            tracker[row.path] = {
                type: row.type,
                hash: row.hash,
                mtime: row.mtime,
                size: row.size,
                synced: row.synced
            };
        }

        return tracker;
    } catch (err) {
        console.error("❌ Failed to load tracker from DB:", err.message);
        return {};
    }
}

function saveTracker(snapshot, syncedDefault = 1) {
    const db = getDB();

    const insert = db.prepare(`
        INSERT INTO tracker (path, type, size, mtime, hash, synced)
        VALUES (@path, @type, @size, @mtime, @hash, @synced)
        ON CONFLICT(path) DO UPDATE SET
            type   = excluded.type,
            size   = excluded.size,
            mtime  = excluded.mtime,
            hash   = excluded.hash,
            synced = excluded.synced
    `);

    const trx = db.transaction((data) => {
        for (const [path, value] of Object.entries(data)) {
            insert.run({
                path: normalizeTrackerPath(path),
                type: value.type,
                size: value.size ?? 0,
                mtime: value.mtime ?? 0,
                hash: value.hash ?? null,

                // 🔒 HARD GUARANTEE: synced is NEVER null
                synced:
                    Number.isInteger(value.synced)
                        ? value.synced
                        : Number.isInteger(syncedDefault)
                            ? syncedDefault
                            : 1
            });
        }
    });

    trx(snapshot);
}


function saveTrackerItem(value) {
    const db = getDB();

    db.prepare(`
        INSERT INTO tracker (path, type, size, mtime, hash, synced)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            type   = excluded.type,
            size   = excluded.size,
            mtime  = excluded.mtime,
            hash   = excluded.hash,
            synced = excluded.synced
    `).run(
        value.path,
        value.type,
        value.size || 0,
        value.mtime || 0,
        value.hash || null,
        value.synced ?? 1   // ✅ default: synced after successful upload
    );
}


async function getDirectorySnapshotFirst(dir, oldSnap = {}, baseDir = dir) {
    const snapshot = {};
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        let relPath = normalizePath(path.relative(baseDir, fullPath));
        relPath = relPath.replace(/\\/g, "/");
      // console.log('mm -> ' +relPath );
        const stats = fs.statSync(fullPath);

        if (!relPath) continue;

        if (entry.isDirectory()) {
            snapshot[relPath] = {
                type: "folder",
                mtime: 0,//stats.mtimeMs,
            };

            Object.assign(snapshot, await getDirectorySnapshot(fullPath, oldSnap, baseDir));
        } else {
            let prev = oldSnap[relPath];
            let hash = prev?.hash || null;

            if (!prev || prev.mtime !== stats.mtimeMs) {
                hash = await hashFile(fullPath);
            }

            snapshot[relPath] = {
                type: "file",
                size: stats.size,
                mtime: stats.mtimeMs,
                hash,
            };
        }
    }

    return snapshot;
}

async function getDirectorySnapshot(dir, oldSnap = {}, baseDir = dir) {
    const snapshot = {};
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        let relPath = normalizePath(path.relative(baseDir, fullPath))
            .replace(/\\/g, "/");

        if (!relPath) continue;

        const stats = fs.statSync(fullPath);

        if (entry.isDirectory()) {
            snapshot[relPath] = {
                type: "folder",
                mtime: 0,
                size: 0,
                hash: null
            };

            Object.assign(
                snapshot,
                await getDirectorySnapshot(fullPath, oldSnap, baseDir)
            );
        } else {
            const prev = oldSnap[relPath];
            let hash = prev?.hash ?? null;

            if (!prev || prev.mtime !== stats.mtimeMs) {
                hash = await hashFile(fullPath);
            }

            snapshot[relPath] = {
                type: "file",
                size: stats.size,
                mtime: stats.mtimeMs,
                hash
            };
        }
    }

    return snapshot;
}



function findNewOrChangedFiles(current, previous) {
    const changed = [];

    for (const path in current) {
        const curr = current[path];
        const prev = previous[path];

        // 🆕 New file
        if (!prev) {
            curr.synced = 0;
            changed.push(path);
            continue;
        }

        // 🔄 Modified file
        if (
            curr.mtime !== prev.mtime ||
            curr.size !== prev.size ||
            curr.hash !== prev.hash
        ) {
            curr.synced = 0; // 🔥 force re-upload
            changed.push(path);
        }
    }

    return changed;
}


function findNewOrChangedFilesPrince(current, previous) {
    const changed = [];

    for (const key in current) {
        const curr = current[key];
        const prev = previous[key];

        if (!prev) {
            changed.push(key);
            continue;
        }

         // Skip folders from previous snapshot too
        if (prev.type === "folder") continue;

        if (curr.mtime !== prev.mtime) {
            changed.push(key);
            continue;
        }
        if (curr.hash !== prev.hash) {
            changed.push(key);
        }
    }

    return changed;
}


function normalizeTrackerPath(p) {
    return p
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/")
        .trim();
}



function findNewOrChangedItems(current, previous) {
  const changed = [];
  for (const file in current) {
    if (!previous[file]) {
      changed.push({ path: file, ...current[file], reason: "new" });
    } else if (
      current[file].type === "file" &&
      (previous[file].mtime !== current[file].mtime ||
        previous[file].hash !== current[file].hash)
    ) {
      changed.push({ path: file, ...current[file], reason: "modified" });
    }
  }
  return changed;
}

// 🚀 Auto sync function

async function autoSync({ customer_id, domain_id, apiUrl, syncData }) {
  // Reset progress UI
  progressContainer.style.display = 'none';
  progressBar.value = 0;
  progressLabel.textContent = 'Syncing... 0%';

  try {
    // Start sync
    const result = await window.electronAPI.autoSync({
      customer_id,
      domain_id,
      apiUrl,
      syncData,
    });

    console.log("✅ Sync finished:", result);

    // ✅ Show 100% completion
    progressBar.value = 100;
    progressLabel.textContent = '✅ Sync completed!';

    // Optional: hide after a delay
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 2000);

    return result;
  } catch (err) {
    console.error("❌ Auto sync error:", err);
    progressContainer.style.display = 'block';
    progressLabel.textContent = '❌ Sync failed!';
    throw err;
  }
}

function normalizeServerPath(location) {
    const parts = location.replace(/\\/g, "/").split("/");

    const index = parts.findIndex(p => p.includes("_") && /\d/.test(p));

    if (index === -1) return parts.slice(-2).join("/");

    return parts.slice(index).join("/");
}

async function downloadServerPending({ customer_id, domain_id, apiUrl, syncData }) {

    const res = await fetch(`${apiUrl}/api/get-pending-downloads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            customer_id,
            domain_id,
            user_id: syncData.user_data.id
        }),
    });

    const raw = await res.text();

    console.log("🔥 RAW RESPONSE 🔥");
    //console.log(raw);
    //JSON.parse(raw).pending;

    return JSON.parse(raw);
}

async function getServerDeletedData({ customer_id, domain_id, apiUrl, syncData }) {
    const res = await fetch(`${apiUrl}/api/get-delete-flush-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            customer_id,
            domain_id,
            user_id: syncData.user_data.id
        }),
    });

    const raw = await res.text();

    console.log("🔥 RAW RESPONSE 🔥");
    console.log(raw);

    return JSON.parse(raw);
}

function createTestFolderDocumentpath() {
    const TEST_FOLDER = path.join(app.getPath('documents'), 'Centris-Drive');
    if (!fs.existsSync(TEST_FOLDER)) {
        fs.mkdirSync(TEST_FOLDER, { recursive: true });
        console.log('Test folder created at', TEST_FOLDER);
    }
    return TEST_FOLDER;
}

function createTestFolder() {
    const homeDir = os.homedir();
    const TEST_FOLDER = path.join(homeDir, 'CentrisSync');

    if (!fs.existsSync(TEST_FOLDER)) {
        fs.mkdirSync(TEST_FOLDER, { recursive: true });
        console.log('✅ Folder created at:', TEST_FOLDER);
    }

    // Path to your .ico icon inside the app directory
    //const iconPath = path.join(__dirname, 'assets', 'images', 'favicon.ico');
    const iconPath = isDev
    ? path.join(__dirname, "assets/images/favicon.ico")              // development
    : path.join(process.resourcesPath,"app.asar", "assets/images/favicon.ico"); 

    // Create desktop.ini file to assign folder icon
    const desktopIniContent = `[.ShellClassInfo]
		IconResource=${iconPath},0
		IconFile=${iconPath}
		IconIndex=0
		`;

    const iniPath = path.join(TEST_FOLDER, 'desktop.ini');
    fs.writeFileSync(iniPath, desktopIniContent, 'utf-8');

    // Set folder + desktop.ini attributes so Windows uses the icon
    const { exec } = require('child_process');
    exec(`attrib +s "${TEST_FOLDER}"`);
    exec(`attrib +h "${iniPath}"`);

    console.log('🎨 Folder icon applied using', iconPath);

    return TEST_FOLDER;
}

const DRIVE_LETTER = 'F';

function unmapDrive(letter) {
    try {
        execSync(`subst ${letter}: /d`);
        console.log(`🧹 Drive ${letter}: unmapped successfully`);
    } catch (error) {
        console.error(`⚠️ Could not unmap drive ${letter}:`, error.message);
    }
}

const TOTAL_FOLDER_SIZE_GB = 10; // 💾 define total space limit for the mapped folder (e.g. 10 GB)

/* ------------------ Utility: Get mapped drives ------------------ */
function getMappedDrives() {
    try {
        const output = execSync('subst').toString();
        const driveMap = {};
        const regex = /^([A-Z]):\\: => (.+)$/gm;
        let match;
       
        console.log(output);
        while ((match = regex.exec(output)) !== null) {
            const driveLetter = match[1];
            const folderPath = match[2].trim();
            driveMap[folderPath] = driveLetter;
        }
        return driveMap;
    } catch {
        return {};
    }
}

function getMappedDrives1() {
    try {
        const output = execSync('subst').toString().trim();
        const driveMap = {};

        // Correct regex for:  E:\: => C:\Path
        const regex = /^([A-Z]):\\: => (.+)$/gm;

        let match;
        while ((match = regex.exec(output)) !== null) {
            
            const driveLetter = match[1];
            const targetPath = match[2].trim();
            driveMap[driveLetter + ":"] = targetPath;
        }

        return driveMap;
    } catch (err) {
        console.warn("Failed to run subst:", err.message);
        return {};
    }
}


function getMappedDriveLetterFinal(volumeLabel = "Centris-Drive") {
    try {
        // Run WMIC to get drive letter and label
        const output = execSync(`wmic logicaldisk get Name,VolumeName`, { encoding: "utf8" });

        // Example output:
        // Name  VolumeName
        // C:    Windows
        // F:    Centris-Drive
        // D:    Data

        const lines = output.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("Name"));
        console.log(lines);
        for (const line of lines) {
            // Split keeping drive and label
            const match = line.match(/^([A-Z]:)\s+(.*)$/i);
            if (!match) continue;

            const drive = match[1];
            const label = match[2].trim();

            if (label.toLowerCase() === volumeLabel.toLowerCase()) {
                console.log(`✅ Found ${volumeLabel} mounted at ${drive}\\`);
                return `${drive}\\`;
            }
        }

        console.warn(`⚠️ Drive with label "${volumeLabel}" not found.`);
        return null;

    } catch (err) {
        console.error("❌ Error detecting Centris-Drive drive:", err);
        return null;
    }
}

function getMappedDriveLetter(volumeLabel = "Centris-Drive") {
    try {
        const platform = os.platform();

        // 🪟 WINDOWS
        if (platform === "win32") {
            const output = execSync(`wmic logicaldisk get Name,VolumeName`, { encoding: "utf8" });

            const lines = output
                .split("\n")
                .map(l => l.trim())
                .filter(l => l && !l.startsWith("Name"));

            for (const line of lines) {
                const match = line.match(/^([A-Z]:)\s+(.*)$/i);
                if (!match) continue;

                const drive = match[1];
                const label = match[2].trim();

                if (label.toLowerCase() === volumeLabel.toLowerCase()) {
                    console.log(`✅ Found ${volumeLabel} mounted at ${drive}\\`);
                    return `${drive}\\`;
                }
            }

            console.warn(`⚠️ Drive "${volumeLabel}" not found on Windows`);
            return null;
        }

        // 🍎 macOS
        if (platform === "darwin") {
            const volumesPath = "/Volumes";
            const volumes = fs.readdirSync(volumesPath);

            for (const vol of volumes) {
                if (vol.toLowerCase() === volumeLabel.toLowerCase()) {
                    const mountPath = path.join(volumesPath);
                    console.log(`✅ Found ${volumeLabel} mounted at ${mountPath}`);
                    return mountPath;
                }
            }

            console.warn(`⚠️ Volume "${volumeLabel}" not found on macOS`);
            return null;
        }

        // 🐧 Linux (optional)
        console.warn(`⚠️ Platform "${platform}" not supported yet`);
        return null;

    } catch (err) {
        console.error("❌ Error detecting Centris drive:", err);
        return null;
    }
}

function getMappedDriveLetter11(volumeLabel = "Centris-Drive") {
    try {
        // Get all drives with their VolumeName and Name
        const output = execSync(`wmic logicaldisk get name,volumename`, { encoding: 'utf8' });

        // Example output:
        // VolumeName  Name
        // Windows     C:
        // CentrisSync F:
        // Data        D:

        const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
        console.log('kkkk');
        for (const line of lines) {
            if (line.startsWith('VolumeName')) continue; // skip header
            const [label, drive] = line.split(/\s+/).filter(Boolean);

            // Match by label name
            if (label && label.toLowerCase() === volumeLabel.toLowerCase()) {
                return drive.endsWith(':') ? `${drive}\\` : `${drive}:\\`;
            }
        }
        
        return null; // not found
    } catch (err) {
        console.error("Error detecting Centris-Drive drive:", err);
        return null;
    }
}


/* ------------------ Utility: Find next free drive letter ------------------ */
function getNextAvailableDriveLetter() {
    const usedLetters = new Set();
    try {
        const output = execSync('wmic logicaldisk get name').toString();
        output.split('\n').forEach(line => {
            const match = line.match(/^([A-Z]):/);
            if (match) usedLetters.add(match[1]);
        });
    } catch {}
    for (let i = 70; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        if (!usedLetters.has(letter)) return letter;
    }
    throw new Error('No available drive letters found.');
}

/* ------------------ Utility: Calculate folder’s actual size recursively ------------------ */
function getFolderSize(folderPath) {
    let total = 0;
    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            try {
                if (entry.isDirectory()) walk(entryPath);
                else total += fs.statSync(entryPath).size;
            } catch {}
        }
    }
    try {
        walk(folderPath);
    } catch (err) {
        console.warn('⚠️ Could not calculate folder size:', err.message);
    }
    return total; // bytes
}

/* ------------------ MAIN FUNCTION ------------------ */
function createSyncFolderAndDrive() {
    const homeDir = os.homedir();
    const SYNC_FOLDER = path.join(homeDir, VOLUME_LABEL);

    // 1️⃣ Create folder if missing
    if (!fs.existsSync(SYNC_FOLDER)) {
        fs.mkdirSync(SYNC_FOLDER, { recursive: true });
        console.log('📁 Folder created at:', SYNC_FOLDER);
    } else {
        console.log('📁 Folder already exists:', SYNC_FOLDER);
    }

    // 2️⃣ Optional custom icon
    try {
        //const iconPath = path.join(__dirname, 'assets', 'images', 'favicon.ico');
        const iconPath = isDev? path.join(__dirname, "assets/images/favicon.ico"): path.join(process.resourcesPath,"app.asar", "assets/images/favicon.ico"); 
        
        const iniPath = path.join(SYNC_FOLDER, 'desktop.ini');
        if (!fs.existsSync(iniPath)) {
            const iniData = `[.ShellClassInfo]
            IconResource=${iconPath},0
            IconFile=${iconPath}
            IconIndex=0
            `;
            fs.writeFileSync(iniPath, iniData, 'utf-8');
            execSync(`attrib +s "${SYNC_FOLDER}"`);
            execSync(`attrib +h "${iniPath}"`);
            console.log('🎨 Folder icon applied.');
        }
    } catch (err) {
        console.warn('⚠️ Could not set folder icon:', err.message);
    }

    // 3️⃣ Check existing mappings
    const mappedDrives = getMappedDrives();
    const existing = Object.entries(mappedDrives).find(
        ([folderPath]) => folderPath.toLowerCase() === SYNC_FOLDER.toLowerCase()
    );

    const folderSizeBytes = getFolderSize(SYNC_FOLDER);
    const folderUsedGB = folderSizeBytes / (1024 ** 3);
    const folderFreeGB = Math.max(TOTAL_FOLDER_SIZE_GB - folderUsedGB, 0).toFixed(2);

    if (existing) {
        const letter = existing[1];
        console.log(`🔤 Already mapped to ${letter}:\\`);
        console.log(`📦 Folder size used: ${folderUsedGB.toFixed(2)} GB`);
        console.log(`💾 Available space: ${folderFreeGB} GB / ${TOTAL_FOLDER_SIZE_GB} GB total`);
        return `${letter}:`;
    }

    // 4️⃣ Map to new drive
    const letter = getNextAvailableDriveLetter();
    try {
        execSync(`subst ${letter}: "${SYNC_FOLDER}"`);
        exec(`powershell -Command "(New-Object -ComObject Shell.Application).NameSpace(0).Self.InvokeVerb('refresh')"`);
        console.log(`🚀 Drive ${letter}: mapped to ${SYNC_FOLDER}`);

        console.log(`📦 Folder size used: ${folderUsedGB.toFixed(2)} GB`);
        console.log(`💾 Available space: ${folderFreeGB} GB / ${TOTAL_FOLDER_SIZE_GB} GB total`);

        return `${letter}:`;
    } catch (err) {
        console.error('❌ Mapping failed:', err.message);
        return null;
    }
}


//
function isAdmin() {
    try {
        execSync("fsutil dirty query %systemdrive%", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function relaunchAsAdmin() {
    const scriptPath = process.argv[1];
    console.log("⚙️ Requesting administrator rights...");
    spawn("powershell", [
        "-Command",
        `Start-Process 'node' -ArgumentList '${scriptPath}' -Verb RunAs`
    ], { stdio: "ignore", detached: true });
    process.exit();
}

// function relaunchAsAdmin() {
//     const options = {
//         name: 'Centris Drive',
//     };

//     const command = `"${process.execPath}"`;

//     sudo.exec(command, options, (error) => {
//         if (error) {
//             console.error("Failed to elevate:", error);
//             return;
//         }
//         app.quit();
//     });
// }

function createDiskpartScript(vhdxPath) {
    return `
        create vdisk file="${vhdxPath}" maximum=${VHDX_SIZE_MB} type=expandable
        select vdisk file="${vhdxPath}"
        attach vdisk
        create partition primary
        format fs=ntfs quick label=${VOLUME_LABEL}
        assign
        exit
        `;
}



function createAndMountVHDX() {
    const VHDX_PATH = path.join(homeDir, VHDX_NAME);
    console.log(`💽 Virtual disk path: ${VHDX_PATH}`);

    if (fs.existsSync(VHDX_PATH)) {
        console.log("💿 VHDX already exists. Attaching...");
        const attachScript = `select vdisk file="${VHDX_PATH}"\nattach vdisk\nexit`;
        fs.writeFileSync("attach.txt", attachScript);
        execSync(`diskpart /s attach.txt`, { stdio: "inherit" });
        fs.unlinkSync("attach.txt");
    } else {
        console.log(`🪶 Creating ${VHDX_SIZE_MB / 1024} GB VHDX...`);
        const script = createDiskpartScript(VHDX_PATH);
        fs.writeFileSync("create.txt", script);

        try {
            execSync(`diskpart /s create.txt`, { stdio: "inherit" });
            console.log("✅ VHDX created and mounted successfully!");
        } finally {
            fs.unlinkSync("create.txt");
        }
    }

    const output = execSync('wmic logicaldisk get name, volumename').toString();
    const match = output.match(/([A-Z]):\s+Centris-Drive/);

    if (match) {
        const driveLetter = match[1];
        console.log(`🔤 Mounted as ${driveLetter}:\\`);

        // ✅ Create subfolder inside the mounted drive
        const subFolder = path.join(driveLetter + ":\\", "Centris-Drive");
        if (!fs.existsSync(subFolder)) {
            fs.mkdirSync(subFolder, { recursive: true });
            console.log(`📁 Subfolder created at ${subFolder}`);
        } else {
            console.log(`📁 Subfolder already exists at ${subFolder}`);
        }

        // Path to your custom icon
        const iconPath = isDev
            ? path.join(__dirname, "assets/images/favicon.ico")              // development
            : path.join(process.resourcesPath, "app.asar", "assets/images/favicon.ico");

        // Apply the drive icon
        applyDriveIcon(driveLetter, iconPath);

        const autorunPath = path.join(driveLetter + ":\\", "autorun.inf");
        const autorunContent = `[Autorun] ICON=${iconPath} Label=Centris-Drive`;

        try {
            fs.writeFileSync(autorunPath, autorunContent, "utf-8");
            // Hide the autorun file
            execSync(`attrib +h +s "${autorunPath}"`);
            console.log("🎨 Drive icon applied for This PC view.");
        } catch (err) {
            console.warn("⚠️ Could not create autorun.inf:", err.message);
        }

        } else {
            console.warn("⚠️ Could not detect mounted drive letter.");
        }
}


function createAndMountMacDisk() {
    const homeDir = os.homedir();
    const DISK_NAME = VOLUME_LABEL;
    //const DISK_SIZE_GB = 20;

    const SPARSE_PATH = path.join(homeDir, `${DISK_NAME}.sparsebundle`);
    console.log(`💽 Disk image path: ${SPARSE_PATH}`);

    if (!fs.existsSync(SPARSE_PATH)) {
        console.log(`🪶 Creating ${VHDX_SIZE_MB}GB sparsebundle...`);

        execSync(`
            hdiutil create \
            -size ${VHDX_SIZE_MB}g \
            -type SPARSEBUNDLE \
            -fs APFS \
            -volname "${DISK_NAME}" \
            "${SPARSE_PATH}"
        `, { stdio: "inherit" });

        console.log("✅ Disk image created");
    }

    console.log("📀 Attaching disk image...");
    execSync(`hdiutil attach "${SPARSE_PATH}" -nobrowse`, { stdio: "inherit" });

    const volumePath = path.join("/Volumes", DISK_NAME);

    if (!fs.existsSync(volumePath)) {
        console.error("❌ Failed to mount volume");
        return;
    }

    console.log(`🔗 Mounted at ${volumePath}`);

    // Create subfolder
    const subFolder = path.join(volumePath, VOLUME_LABEL);
    if (!fs.existsSync(subFolder)) {
        fs.mkdirSync(subFolder, { recursive: true });
        console.log(`📁 Subfolder created: ${subFolder}`);
    }

    // Apply custom volume icon
    const iconPath = path.join(__dirname, "assets/images/drive.icns");
    const volumeIconPath = path.join(volumePath, ".VolumeIcon.icns");

    try {
        fs.copyFileSync(iconPath, volumeIconPath);
        execSync(`SetFile -a C "${volumePath}"`);
        console.log("🎨 Custom volume icon applied");
    } catch (err) {
        console.warn("⚠️ Icon setup failed (SetFile requires Xcode tools)");
    }
}



function createAndMountSUBST2() {
    const VHDX_PATH = path.join(homeDir, "Centris-Drive");

    // Ensure folder exists
    if (!fs.existsSync(VHDX_PATH)) {
        fs.mkdirSync(VHDX_PATH, { recursive: true });
        console.log("📁 Base folder created:", VHDX_PATH);
    } else {
        console.log("📁 Base folder already exists:", VHDX_PATH);
    }

    // Get existing drives (only physical, not SUBST)
    let driveOutput = execSync("wmic logicaldisk get name").toString();
    driveOutput = driveOutput.replace(/\s+/g, "");

    // Choose free drive letter
    let driveLetter = null;
    for (let letter of "DEFGHIJKLMNOPQRSTUVWXYZ") {
        if (!driveOutput.includes(letter + ":")) {
            driveLetter = letter;
            break;
        }
    }

    if (!driveLetter) {
        throw new Error("❌ No free drive letters available.");
    }

    console.log(`🔤 Using drive letter: ${driveLetter}:\\`);

    // Remove previous SUBST if exists
    try { execSync(`subst ${driveLetter}: /d`, { stdio: "ignore" }); } catch {}

    // Create SUBST mapping
    execSync(`subst ${driveLetter}: "${VHDX_PATH}"`);
    console.log(`🔗 Mapped ${driveLetter}: → ${VHDX_PATH}`);

    return driveLetter + ":\\";
}

function createAndMountSUBST(iconPath) {
    const baseFolder = path.join(homeDir, "Centris-Drive");

    // Ensure base folder exists
    if (!fs.existsSync(baseFolder)) {
        fs.mkdirSync(baseFolder, { recursive: true });
        console.log("📁 Base folder created:", baseFolder);
    } else {
        console.log("📁 Base folder already exists:", baseFolder);
    }

    // Collect existing drives
    let driveOutput = "";
    try {
        driveOutput = execSync("wmic logicaldisk get name").toString();
    } catch {
        driveOutput = "";
    }
    driveOutput = driveOutput.replace(/\s+/g, "");

    // Pick free letter
    let driveLetter = null;
    for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") {
        if (!driveOutput.includes(letter + ":")) {
            driveLetter = letter;
            break;
        }
    }
    if (!driveLetter) throw new Error("❌ No free drive letters available.");

    console.log(`🔤 Using drive letter: ${driveLetter}:\\`);

    // Remove existing SUBST mapping
    try { execSync(`subst ${driveLetter}: /d`); } catch {}

    // Create new SUBST
    execSync(`subst ${driveLetter}: "${baseFolder}"`);
    console.log(`🔗 Mapped ${driveLetter}: → ${baseFolder}`);

    // Create subfolder inside mapped drive
    const subFolder = `${driveLetter}:\\Centris-Drive`;
    try {
        if (!fs.existsSync(subFolder)) {
            fs.mkdirSync(subFolder, { recursive: true });
            console.log("📁 Subfolder created:", subFolder);
        } else {
            console.log("📁 Subfolder already exists:", subFolder);
        }
    } catch (err) {
        console.log("⚠️ Failed to create subfolder:", err.message);
    }

    // Apply drive icon
    applyDriveIcon(driveLetter, iconPath);

    return driveLetter + ":\\";
}


function unmountSUBST(driveLetter) {
    try { execSync(`subst ${driveLetter}: /d`); } catch {}
}


function applyDriveIcon1(driveLetter, iconPath) {
    try {
        const autorunPath = path.join(`${driveLetter}:\\`, "autorun.inf");
        const iniData = `[autorun]
        ICON=${iconPath}`;

        // Write autorun.inf file
        fs.writeFileSync(autorunPath, iniData, "utf8");

        // Hide the file to look neat
        execSync(`attrib +h +s "${autorunPath}"`);

        // Refresh icon cache for that drive
        execSync(`powershell -Command "((New-Object -ComObject Shell.Application).NameSpace('${driveLetter}:\\')).Self.InvokeVerb('refresh')"`);

        console.log(`🎨 Custom icon applied to drive ${driveLetter}:\\`);
    } catch (err) {
        console.warn(`⚠️ Could not set custom icon: ${err.message}`);
    }
}

function applyDriveIcon(driveLetter, iconPath) {
    try {
        const driveIconPath = path.join(`${driveLetter}:\\`, "favicon.ico");
        const autorunPath = path.join(`${driveLetter}:\\`, "autorun.inf");

        // Copy icon into the drive (so it persists)
        fs.copyFileSync(iconPath, driveIconPath);

        // Create autorun.inf pointing to local icon
        const iniData = `[autorun]\nICON=favicon.ico\n`;
        fs.writeFileSync(autorunPath, iniData, "utf8");

        // Hide autorun.inf and icon (optional)
        execSync(`attrib +h +s "${autorunPath}"`);
        execSync(`attrib +h "${driveIconPath}"`);

        // Refresh Explorer view of the drive
        execSync(`powershell -Command "((New-Object -ComObject Shell.Application).NameSpace('${driveLetter}:\\')).Self.InvokeVerb('refresh')"`);
        
        console.log(`🎨 Custom icon applied to drive ${driveLetter}:\\`);
    } catch (err) {
        console.warn(`⚠️ Could not set custom icon: ${err.message}`);
    }
}


function unmountVHDX() {
    const homeDir = os.homedir();
    const VHDX_PATH = path.join(homeDir, "Centris-Drive.vhdx");
    console.log(`🔌 Detaching VHDX: ${VHDX_PATH}`);

    if (!fs.existsSync(VHDX_PATH)) {
        console.log("❌ VHDX file not found!");
        return;
    }

    const script = `
    select vdisk file="${VHDX_PATH}"
    detach vdisk
    exit
    `;

    fs.writeFileSync("detach.txt", script);
    try {
        execSync(`diskpart /s detach.txt`, { stdio: "inherit" });
        console.log("✅ VHDX detached successfully!");
    } catch (err) {
        console.error("⚠️ Failed to detach:", err.message);
    } finally {
        fs.unlinkSync("detach.txt");
    }
}

function unmountMacDisk() {
    const DISK_NAME = VOLUME_LABEL;
    const volumePath = `/Volumes/${DISK_NAME}`;

    console.log(`🔌 Detaching macOS disk: ${volumePath}`);

    if (!fs.existsSync(volumePath)) {
        console.log("❌ Volume not mounted!");
        return;
    }

    try {
        // Graceful detach
        execSync(`hdiutil detach "${volumePath}"`, { stdio: "inherit" });
        console.log("✅ Disk detached successfully!");
    } catch (err) {
        console.warn("⚠️ Normal detach failed, forcing...");

        try {
            execSync(`hdiutil detach "${volumePath}" -force`, { stdio: "inherit" });
            console.log("✅ Disk force-detached successfully!");
        } catch (fatal) {
            console.error("❌ Failed to detach disk:", fatal.message);
        }
    }
}


function relaunchWithSudoMac() {
    const appPath = app.getPath("exe");

    spawn("osascript", [
        "-e",
        `do shell script "${appPath}" with administrator privileges`
    ], {
        detached: true,
        stdio: "ignore"
    });

    app.quit();
}

app.whenReady().then(() => {
  //  win = new BrowserWindow({
  //       width: 800,
  //       height: 600,
  //       webPreferences: {
  //           preload: path.join(__dirname, 'preload.js'),
  //           contextIsolation: true,
  //           enableRemoteModule: false,
  //           nodeIntegration: true // ❗ keep false for security
  //       },
  //       icon: path.join(__dirname, 'assets/images/favicon.ico')
  //   });
  // win.webContents.openDevTools({ mode: 'detach' });

  //   // open main process debug window
  //   win.webContents.debugger.attach('1.1');
    const savedSession = loadSession();

    if (savedSession) {
        // IMPORTANT: Restore into syncData
        syncData = {
            customer_data: savedSession.customer_data || {},
            domain_data: savedSession.domain_data || {},
            user_data: savedSession.user_data || {},
            config_data: savedSession.config_data || {},
            apiUrl: savedSession.apiUrl || "",
        };
        console.log("🔄 Restored syncData from session:", syncData);
    }

    initDB();
    console.log('Deepak -> ');
    console.log(app.getPath("userData"));
    //
	createWindow();
	//const folderPath = createSyncFolderAndDrive();
    // if (!isAdmin()) {
    //     relaunchAsAdmin();
    // } else {
    //     createAndMountVHDX();
    // }

    if (process.platform === "win32") {
        // Windows → needs Administrator
        if (!isAdmin()) {
            relaunchAsAdmin();
            //return;
        }

        createAndMountVHDX();
    }

    else if (process.platform === "darwin") {
        // macOS → needs sudo
        if (process.getuid && process.getuid() !== 0) {
            //relaunchWithSudoMac();
            //return;
        }
        console.log('prince -> ');
        createAndMountMacDisk();
    }

    else {
        console.warn(`❌ Unsupported platform: ${process.platform}`);
    }

    //createSyncFolderAndDrive();


    // 🔄 Auto sync every 5 minutes
    // setInterval(() => {
    //     autoSync({ customer_id, domain_id , apiUrl ,syncData }).catch(console.error);
    // }, 5 * 60 * 1000); // 5 min

	// app.on('activate', () => {
	// 	if (BrowserWindow.getAllWindows().length === 0) {
	// 		createWindow();
	// 	}
	// });

    app.on('activate', () => {
        if (!win || win.isDestroyed()) {
            createWindow();
        } else {
            win.show(); // restore from tray
        }
    });

     //createTray();

    // Prevent creating new windows unnecessarily
    // app.on('activate', () => {
    //     if (win) {
    //         win.show();
    //     } else {
    //         createWindow();
    //     }
    // });  
	
})

ipcMain.handle('get-secret-key', async () => {
    return SECRET_KEY || 'This is sensitive data';
});

ipcMain.handle('get-api-url', async () => {
    return API_URL || '';
});

// Receive and store customer/domain IDs from renderer

//
ipcMain.on('set-sync-data', (event, data) => {
  syncData = { ...syncData, ...data };
  event.sender.send('sync-data-updated', syncData);
  console.log('✅ Received syncData in main:', syncData);
});

ipcMain.handle('get-sync-data', async () => {
  return syncData;
});


ipcMain.handle("download-pending-files", async (event, args) => {
    return await downloadPendingFilesLogic(event, args);
});

ipcMain.handle("delete-item", async (event, { path: targetPath, type }) => {
    try {
        if (!targetPath) throw new Error("Invalid path");

        if (type === "folder") {
            // ✅ Delete folder recursively
            await fs.promises.rm(targetPath, {
                recursive: true,
                force: true
            });
        } else {
            // ✅ Delete single file
            await fs.promises.unlink(targetPath);
        }

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

function cleanSegment(s) {
    return s.replace(/^[:\\/]+|[:\\/]+$/g, ""); // remove leading/trailing slashes or colon
}


async function downloadPendingFilesLogicNew(event, args) {
    const { customer_id, domain_id, apiUrl, syncData } = args;
    const SourceFrom = "Centris One";
    const pending = await downloadServerPending(args);
    if (!Array.isArray(pending) || pending.length === 0) {
        event.sender.send("download-complete", {
            source: SourceFrom === "Centris One" ? "Centris One" : "Centris Drive",
            status: "no-download"
        });
        setTimeout(() => event.sender.send("download-hide"), 6000);
        return true;
    }

    const drive = cleanSegment(getMappedDriveLetter());
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);
    const mappedDrivePath = path.join(drive + ":", baseFolder);

    let UserName = syncData.user_data.user_name;

    const totalFiles = pending.length;
    let completedFiles = 0;

    event.sender.send("download-progress-start", { total: totalFiles });

    for (const item of pending) {
        
        try {
            // 1️⃣ Build safe local path
            const cleanLocation = extractRelativePath(
                item.location,
                baseFolder,
                UserName
            );

            const fullLocalPath = path.resolve(mappedDrivePath, cleanLocation);

            // 🔐 Safety check
            if (!fullLocalPath.startsWith(mappedDrivePath)) {
                throw new Error("Path escape blocked: " + fullLocalPath);
            }

            // 2️⃣ Ensure directory exists
            const targetDir =
                item.type === "file"
                    ? path.dirname(fullLocalPath)
                    : fullLocalPath;

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 3️⃣ Download FILE (streamed → no freeze)
            if (item.type === "file") {
                await downloadFile(item, fullLocalPath, apiUrl);
            }

            // 4️⃣ Update local tracker (AFTER successful write)
            await updateSaveTracker(
                fullLocalPath,
                cleanLocation,
                item
            );

            // 5️⃣ Mark downloaded on server (AFTER tracker success)
            await markDownloaded(apiUrl, item.id);

            // 6️⃣ Progress update
            // event.sender.send("download-progress", {
            //     done: i + 1,
            //     total: pending.length,
            //     file: item.location
            // });

            completedFiles++;
            event.sender.send("download-progress", {
                done: completedFiles,
                total: totalFiles,
                file: item.location,
                filePercent: 100,
            });

        } catch (err) {
            console.error("Download failed:", item.location, err.message);
            // optional: retry / log / skip
        }

        // 🔥 Yield event loop → keeps Electron responsive
        if (completedFiles % 2 === 0) {
            await new Promise(r => setImmediate(r));
        }
    }


     event.sender.send("download-complete", {
        source: SourceFrom === "Centris One" ? "Centris One" : "Centris Drive",
        status: "download"
    });
    setTimeout(() => event.sender.send("download-hide"), 6000);
    return true;
}

async function downloadPendingFilesLogicOld(event, args) {
    const { customer_id, domain_id, apiUrl, syncData } = args;
    const SourceFrom = "Centris One";
    const CHUNK_SIZE = 50;

    const pending = await downloadServerPending(args);

    if (!Array.isArray(pending) || pending.length === 0) {
        event.sender.send("download-complete", {
            source: SourceFrom,
            status: "no-download"
        });
        setTimeout(() => event.sender.send("download-hide"), 6000);
        return true;
    }

    const drive = cleanSegment(getMappedDriveLetter());
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);
    const mappedDrivePath = path.join(drive + ":", baseFolder);
    const UserName = syncData.user_data.user_name;

    const totalFiles = pending.length;
    let completedFiles = 0;

    event.sender.send("download-progress-start", { total: totalFiles });

    const chunks = chunkArray(pending, CHUNK_SIZE);

    for (const chunk of chunks) {

        const downloadedIds = []; // 👈 collect IDs per chunk

        for (const item of chunk) {
            try {
                // 1️⃣ Resolve safe local path
                const cleanLocation = extractRelativePath(
                    item.location,
                    baseFolder,
                    UserName
                );

                const fullLocalPath = path.resolve(mappedDrivePath, cleanLocation);

                if (!fullLocalPath.startsWith(mappedDrivePath)) {
                    throw new Error("Path escape blocked");
                }

                // 2️⃣ Ensure folder exists
                const targetDir =
                    item.type === "file"
                        ? path.dirname(fullLocalPath)
                        : fullLocalPath;

                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // 3️⃣ Download file
                if (item.type === "file") {
                    await downloadFile(item, fullLocalPath, apiUrl);
                }

                // 4️⃣ Update local tracker
                await updateSaveTracker(
                    fullLocalPath,
                    cleanLocation,
                    item
                );

                downloadedIds.push(item.id);

                completedFiles++;
                event.sender.send("download-progress", {
                    done: completedFiles,
                    total: totalFiles,
                    file: item.location,
                    filePercent: Math.round(
                        (completedFiles / totalFiles) * 100
                    )
                });

            } catch (err) {
                console.error("Download failed:", item.location, err.message);
            }

            // 🔥 yield event loop (keeps UI smooth)
            await new Promise(r => setImmediate(r));
        }

        // ✅ BULK markDownloaded (per chunk)
        if (downloadedIds.length > 0) {
            await fetch(`${apiUrl}/api/markDownloadedBulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer_id,
                    domain_id,
                    user_id: syncData.user_data.id,
                    ids: downloadedIds
                })
            });
        }

        // small pause between chunks
        await new Promise(r => setTimeout(r, 10));
    }

    event.sender.send("download-complete", {
        source: SourceFrom,
        status: "download"
    });

    setTimeout(() => event.sender.send("download-hide"), 6000);
    return true;
}

async function downloadPendingFilesLogic(event, args) {
    const { customer_id, domain_id, apiUrl, syncData, db } = args;
    const SourceFrom = "Centris One";
    const CHUNK_SIZE = 50;
    // 🔥 Get pending data + server time
    const response = await downloadServerPending(args);
    console.log('bbbbbbb');
    const pending = response.pending;
    const serverTime = response.server_time; // 👈 IMPORTANT
     console.log(serverTime);
    console.log(pending);
    if (!Array.isArray(pending) || pending.length === 0) {
        event.sender.send("download-complete", {
            source: SourceFrom,
            status: "no-download"
        });
        setTimeout(() => event.sender.send("download-hide"), 6000);
        return true;
    }

    const drive = cleanSegment(getMappedDriveLetter());
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);
    let mappedDrivePath = '';//path.join(drive + ":", baseFolder);
    if (process.platform === "win32") {
        // Windows → add base folder
        mappedDrivePath = path.win32.normalize(`${drive}:\\${baseFolder}`);
    } else if (process.platform === "darwin") {
        // macOS → mount path is already correct
        mappedDrivePath = `${drive}/${baseFolder}`;
    }
    
    const UserName = syncData.user_data.user_name;

    const totalFiles = pending.length;
    let completedFiles = 0;

    event.sender.send("download-progress-start", { total: totalFiles });

    const chunks = chunkArray(pending, CHUNK_SIZE);

    for (const chunk of chunks) {
        const downloadedIds = [];

        for (const item of chunk) {
            try {
                const cleanLocation = extractRelativePath(
                    item.location,
                    baseFolder,
                    UserName
                );

                const fullLocalPath = path.resolve(mappedDrivePath, cleanLocation);

                if (!fullLocalPath.startsWith(mappedDrivePath)) {
                    throw new Error("Path escape blocked");
                }

                const targetDir =
                    item.type === "file"
                        ? path.dirname(fullLocalPath)
                        : fullLocalPath;

                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                if (item.type === "file") {
                    await downloadFile(item, fullLocalPath, apiUrl);
                }

                await updateSaveTracker(
                    fullLocalPath,
                    cleanLocation,
                    item
                );

                downloadedIds.push(item.id);

                completedFiles++;
                event.sender.send("download-progress", {
                    done: completedFiles,
                    total: totalFiles,
                    file: item.location,
                    filePercent: Math.round(
                        (completedFiles / totalFiles) * 100
                    )
                });

            } catch (err) {
                console.error("Download failed:", item.location, err.message);
            }

            await new Promise(r => setImmediate(r));
        }

        if (downloadedIds.length > 0) {
            await fetch(`${apiUrl}/api/markDownloadedBulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer_id,
                    domain_id,
                    user_id: syncData.user_data.id,
                    ids: downloadedIds
                })
            });
        }

        await new Promise(r => setTimeout(r, 10));
    }

    // ✅ UPDATE last_sync_at AFTER DOWNLOAD COMPLETES
    if (serverTime) {
        await db.run(`
            INSERT INTO app_settings
                (customer_id, domain_id, domain_name, user_id, "key", value)
            VALUES (?, ?, ?, ?, 'last_sync_at', ?)
            ON CONFLICT(customer_id, domain_id, domain_name, user_id, "key")
            DO UPDATE SET
                value = excluded.value,
                domain_name = excluded.domain_name,
                updated_at = strftime('%s','now')
        `, [
            syncData.customer_data.id,
            syncData.domain_data.id,
            syncData.domain_data.domain_name,
            syncData.user_data.id,
            serverTime
        ]);
    }

    event.sender.send("download-complete", {
        source: SourceFrom,
        status: "download"
    });

    setTimeout(() => event.sender.send("download-hide"), 6000);
    return true;
}



function extractRelativePath(serverPath, baseFolder, username) {
    if (!serverPath) return "";

    let p = serverPath
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/"); // collapse //

    // remove base folder
    if (p.startsWith(baseFolder + "/")) {
        p = p.slice(baseFolder.length + 1);
    }

    const parts = p.split("/");

    // 🔥 find FIRST occurrence only
    let userIndex = -1;
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === username) {
            userIndex = i;
            break;
        }
    }

    if (userIndex === -1) {
        throw new Error("Username not found in path: " + serverPath);
    }

    // everything AFTER FIRST username
    return parts.slice(userIndex + 1).join("/");
}

async function downloadFile(item, fullLocalPath, apiUrl) {

    const res = await fetch(`${apiUrl}/api/download-file/${item.id}`, {
        method: "POST" // 🔥 MUST MATCH ROUTE
    });

    if (!res.ok) {
        throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }

    const fileStream = fs.createWriteStream(fullLocalPath);

    // 🔥 Convert WebStream → Node Stream (MANDATORY)
    const nodeStream = Readable.fromWeb(res.body);

    await streamPipeline(nodeStream, fileStream);
}

async function deleteLocalFilesLogic_old(event, args) {
    const { apiUrl, syncData } = args;
    const deleteFrom = "Centris Drive";
    const CHUNK_SIZE = 50;

    const deletedData = await getServerDeletedData(args);

    if (!Array.isArray(deletedData) || deletedData.length === 0) {
        event.sender.send("delete-progress-complete", {
            source: deleteFrom,
            status: "no-delete"
        });
        setTimeout(() => event.sender.send("delete-progress-hide"), 6000);
        return true;
    }

    const drive = cleanSegment(getMappedDriveLetter());
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);
    const mappedDrivePath = path.join(drive + ":", baseFolder);
    const userName = syncData.user_data.user_name;

    const totalFiles = deletedData.length;
    let completedFiles = 0;

    event.sender.send("delete-progress-start", { total: totalFiles });

    const chunks = chunkArray(deletedData, CHUNK_SIZE);

    for (const chunk of chunks) {
        const deletedIds = [];

        for (const item of chunk) {
            try {
                const cleanLocation = extractRelativePath(
                    item.location,
                    baseFolder,
                    userName
                );

                const fullLocalPath = path.join(mappedDrivePath, cleanLocation);
                let deletedSuccessfully = false;

                // 🔥 FILE DELETE
                if (item.type === "file") {
                    if (fs.existsSync(fullLocalPath)) {
                        try {
                            fs.unlinkSync(fullLocalPath);
                            deletedSuccessfully = true;
                        } catch (e) {
                            console.error("❌ File delete failed:", fullLocalPath, e.message);
                        }
                    }
                }

                // 🔥 FOLDER DELETE
                else if (item.type === "folder") {
                    if (fs.existsSync(fullLocalPath)) {
                        try {
                            fs.rmSync(fullLocalPath, { recursive: true, force: true });
                            deletedSuccessfully = true;
                        } catch (e) {
                            console.error("❌ Folder delete failed:", fullLocalPath, e.message);
                        }
                    }
                }

                // 🔥 TRACKER + SERVER BUFFER
                if (deletedSuccessfully) {
                    await removeFromTracker(cleanLocation);                    
                }

                deletedIds.push(item.id);

                completedFiles++;
                event.sender.send("delete-progress", {
                    done: completedFiles,
                    total: totalFiles,
                    file: fullLocalPath,
                    source: deleteFrom
                });

            } catch (err) {
                console.error("Delete error:", item.location, err.message);
            }

            // 🧠 yield to event loop (prevents freeze)
            await new Promise(r => setImmediate(r));
        }

        // ✅ BULK SERVER FLUSH (50 max)
        if (deletedIds.length > 0) {
            await removeDeletedataBulk(apiUrl, deletedIds);
        }

        // small pause between chunks
        await new Promise(r => setTimeout(r, 20));
    }

    event.sender.send("delete-progress-complete", {
        source: deleteFrom,
        status: "delete"
    });

    setTimeout(() => event.sender.send("delete-progress-hide"), 6000);
    return true;
}

async function deleteLocalFilesLogic(event, args) {
    const { apiUrl, syncData, db } = args;
    const deleteFrom = "Centris Drive";
    const CHUNK_SIZE = 50;

    // 🔥 Get delete data + server time
    const response = await getServerDeletedData(args);
    const deletedData = response.data || [];
    const serverTime = response.server_time; // 👈 IMPORTANT

    if (!Array.isArray(deletedData) || deletedData.length === 0) {
        event.sender.send("delete-progress-complete", {
            source: deleteFrom,
            status: "no-delete"
        });
        setTimeout(() => event.sender.send("delete-progress-hide"), 6000);
        return true;
    }

    const drive = cleanSegment(getMappedDriveLetter());
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);
    let mappedDrivePath = path.join(drive + ":", baseFolder);

    if (process.platform === "win32") {
        // Windows → add base folder
        //mappedDrivePath = path.win32.normalize(`${drive}:\\${baseFolder}`);
        mappedDrivePath = path.join(drive + ":", baseFolder);
    } else if (process.platform === "darwin") {
        // macOS → mount path is already correct
        mappedDrivePath = `${drive}/${baseFolder}`;
    }

    const userName = syncData.user_data.user_name;

    const totalFiles = deletedData.length;
    let completedFiles = 0;

    event.sender.send("delete-progress-start", { total: totalFiles });

    const chunks = chunkArray(deletedData, CHUNK_SIZE);

    for (const chunk of chunks) {
        const deletedIds = [];

        for (const item of chunk) {
            try {
                const cleanLocation = extractRelativePath(
                    item.location,
                    baseFolder,
                    userName
                );

                const fullLocalPath = path.join(mappedDrivePath, cleanLocation);
                let deletedSuccessfully = false;

                if (item.type === "file" && fs.existsSync(fullLocalPath)) {
                    try {
                        fs.unlinkSync(fullLocalPath);
                        deletedSuccessfully = true;
                    } catch (e) {
                        console.error("❌ File delete failed:", fullLocalPath, e.message);
                    }
                }

                else if (item.type === "folder" && fs.existsSync(fullLocalPath)) {
                    try {
                        fs.rmSync(fullLocalPath, { recursive: true, force: true });
                        deletedSuccessfully = true;
                    } catch (e) {
                        console.error("❌ Folder delete failed:", fullLocalPath, e.message);
                    }
                }

                if (deletedSuccessfully) {
                    await removeFromTracker(cleanLocation);
                }

                deletedIds.push(item.id);

                completedFiles++;
                event.sender.send("delete-progress", {
                    done: completedFiles,
                    total: totalFiles,
                    file: fullLocalPath,
                    source: deleteFrom
                });

            } catch (err) {
                console.error("Delete error:", item.location, err.message);
            }

            await new Promise(r => setImmediate(r));
        }

        if (deletedIds.length > 0) {
            await removeDeletedataBulk(apiUrl, deletedIds);
        }

        await new Promise(r => setTimeout(r, 20));
    }

    // ✅ UPDATE LAST SYNC TIME (ONLY ON SUCCESS)
    if (serverTime) {
        await db.run(`
            INSERT INTO app_settings
                (customer_id, domain_id, domain_name, user_id, "key", value)
            VALUES (?, ?, ?, ?, 'last_sync_at', ?)
            ON CONFLICT(customer_id, domain_id,domain_name, user_id, "key")
            DO UPDATE SET
                value = excluded.value,
                domain_name = excluded.domain_name,
                updated_at = strftime('%s','now')
        `, [
            syncData.customer_data.customer_id,
            syncData.domain_data.domain_id,
            syncData.domain_data.domain_name,
            syncData.user_data.id,
            serverTime
        ]);
    }

    event.sender.send("delete-progress-complete", {
        source: deleteFrom,
        status: "delete"
    });

    setTimeout(() => event.sender.send("delete-progress-hide"), 6000);
    return true;
}

function getLastSyncAtFromDB(syncData) {
    try {
        const db = getDB();

        console.log(
            'KING ->',
            syncData.customer_data.id,
            syncData.domain_data.id,
            syncData.domain_data.domain_name,
            syncData.user_data.id
        );

        const row = db.prepare(`
            SELECT value
            FROM app_settings
            WHERE customer_id = ?
              AND domain_id = ?
              AND domain_name = ?
              AND user_id = ?
              AND \`key\` = ?
            LIMIT 1
        `).get(
            syncData.customer_data.id,
            syncData.domain_data.id,
            syncData.domain_data.domain_name,
            syncData.user_data.id,
            'last_sync_at'
        );

        console.log('ROW ->', row);

        if (!row || row.value == null) {
            console.log('QUEEN -> no last_sync_at found, defaulting to 0');
            return 0;
        }

        const lastSyncAt = parseInt(String(row.value).trim(), 10);

        if (Number.isNaN(lastSyncAt)) {
            console.warn('⚠️ last_sync_at is invalid:', row.value);
            return 0;
        }

        console.log('QUEEN -> last_sync_at =', lastSyncAt);
        return lastSyncAt;

    } catch (err) {
        console.error('❌ getLastSyncAtFromDB error:', err);
        return 0;
    }
}




async function runServerToClientSync(event, syncData) {
    console.log('running - qqqqq');
    if (s2cSyncRunning) return; // prevent overlap
    s2cSyncRunning = true;

    console.log('running - kkkkk');

    try {
        const lastSyncAt = await getLastSyncAtFromDB(syncData);

        const args = {
            customer_id: syncData.customer_data.id,
            domain_id: syncData.domain_data.id,
            apiUrl: syncData.apiUrl,
            db: getDB(),                  // 👈 pass db if required
            syncData: {
                ...syncData,
                last_sync_at: lastSyncAt
            }
        };

        // 1️⃣ Delete from server → client
        await deleteLocalFilesLogic(event, args);
        //  console.log('running - gggggg' + lastSyncAt);

        // 2️⃣ Download from server → client
        await downloadPendingFilesLogic(event, args);
         console.log('running - jjjjjj' + lastSyncAt);

    } finally {
        s2cSyncRunning = false;
    }
}

async function startServerPolling(event, syncData) {
    console.log("🚀 startServerPolling called");
    console.log('s2cPollingTimer - start ->', s2cPollingTimer);

    if (s2cPollingTimer) {
        console.log("⛔ Polling already running");
        return;
    }

    console.log("▶ Running first sync");
    await runServerToClientSync(event, syncData);

    console.log("✅ First sync done");

    s2cPollingTimer = setInterval(async () => {
        console.log("⏱ Poll tick");
        try {
            await runServerToClientSync(event, syncData);
        } catch (e) {
            console.error("S2C poll error:", e);
        }
    }, 30_000);

    console.log("🟢 Polling started, timer =", s2cPollingTimer);
}


async function stopServerPolling() {
    console.log('s2cPollingTimer - stop -> ' + s2cPollingTimer);
    if (s2cPollingTimer) {
        clearInterval(s2cPollingTimer);
        s2cPollingTimer = null;
    }
}


// ipcMain.handle("scanFolder", async (event, folderPath) => {
//     const files = [];

//     function readRecursive(dir) {
//         const items = fs.readdirSync(dir);
//         for (const item of items) {
//             const full = path.join(dir, item);
//             if (fs.lstatSync(full).isDirectory()) {
//                 readRecursive(full);
//             } else {
//                 files.push(full);
//             }
//         }
//     }

//     readRecursive(folderPath);

//     return { success: true, files };
// });


async function updateSaveTracker(fullPath, cleanLocation, item = null) {
    const db = getDB();

    let stats;
    try {
        stats = fs.statSync(fullPath);
    } catch {
        console.warn(`⚠️ Missing path (skip tracker): ${fullPath}`);
        return;
    }

    const key = cleanLocation.replace(/\\/g, "/");

    // trust server hash if available
    let hash = item?.hash ?? null;

    if (stats.isFile() && !hash) {
        try {
            hash = await hashFile(fullPath);
        } catch (err) {
            console.warn(`⚠️ Failed to hash: ${fullPath}`, err.message);
        }
    }

    const mtime =
        item?.mtimeMs != null
            ? Number(item.mtimeMs)
            : stats.mtimeMs;

    // preserve server mtime
    if (stats.isFile()) {
        try {
            fs.utimesSync(fullPath, stats.atime, new Date(mtime));
        } catch (err) {
            console.warn(`⚠️ Failed utime: ${fullPath}`);
        }
    }

    const stmt = db.prepare(`
        INSERT INTO tracker (path, type, size, mtime, hash, synced)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            type   = excluded.type,
            size   = excluded.size,
            mtime  = excluded.mtime,
            hash   = excluded.hash,
            synced = 1
    `);

    stmt.run(
        key,
        stats.isDirectory() ? "folder" : "file",
        stats.isFile() ? stats.size : 0,
        stats.isDirectory() ? 0 : mtime,
        hash,
        1 // ✅ synced
    );

    console.log(`✅ Tracker updated → ${key}`);
}


async function markDownloaded(apiUrl, id) {
    const payload = JSON.stringify({ id });

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(`${apiUrl}/api/mark-downloaded`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload)
                },
                body: payload,
                signal: controller.signal
            });

            clearTimeout(timeout);

            let data;
            try {
                data = await res.json();
            } catch (e) {
                console.warn("⚠️ Invalid JSON from server");
                continue;
            }

            if (data.status === true) {
                console.log(`✔ Marked downloaded: ${id}`);
                return true;
            }

            console.warn(`⚠️ Server returned failure for id=${id}:`, data.message);

        } catch (err) {
            console.warn(`⚠️ Error marking downloaded attempt ${attempt} for id=${id}:`, err.message);
        }

        await new Promise(r => setTimeout(r, 500)); // wait 0.5s before retry
    }

    console.error(`❌ FAILED after retries → mark-downloaded for id=${id}`);
    return false;
}

async function removeDeletedata(apiUrl, id) {
    const payload = JSON.stringify({ id });

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(`${apiUrl}/api/deleted-data`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: payload,
                signal: controller.signal
            });

            clearTimeout(timeout);

            let data;
            try {
                data = await res.json();
            } catch (e) {
                console.warn("⚠️ Invalid JSON from server");
                continue;
            }

            if (data.status === true) {
                console.log(`✔ Marked deleted: ${id}`);
                return true;
            }

            console.warn(`⚠️ Server returned failure for id=${id}:`, data.message);

        } catch (err) {
            console.warn(`⚠️ Error marking deleted attempt ${attempt} for id=${id}:`, err.message);
        }

        await new Promise(r => setTimeout(r, 500)); // wait 0.5s before retry
    }

    console.error(`❌ FAILED after retries → mark-deleted for id=${id}`);
    return false;
}

async function removeDeletedataBulk(apiUrl, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return true;

    const payload = JSON.stringify({ ids });

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);

            const res = await fetch(`${apiUrl}/api/deleted-data-bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                signal: controller.signal
            });

            clearTimeout(timeout);

            const data = await res.json();

            if (data.status === true) {
                console.log(`✔ Bulk marked deleted: ${ids.length} items`);
                return true;
            }

            console.warn("⚠️ Server bulk delete failed:", data.message);
        } catch (err) {
            console.warn(`⚠️ Bulk delete attempt ${attempt} failed:`, err.message);
        }

        await new Promise(r => setTimeout(r, 500));
    }

    console.error("❌ FAILED bulk delete after retries");
    return false;
}


function normalizeKeytodoubleslash(key) {
    // Convert all / or \ into double backslash \\
    return key.replace(/[\/]+/g, "\\");
}

async function removeFromTracker(cleanLocation) {
    const db = getDB();

   // const key = cleanLocation.replace(/\\/g, "/");

    const key = normalizeTrackerPath(cleanLocation);

    try {
        const stmt = db.prepare(`
            DELETE FROM tracker
            WHERE path = ?
        `);

        const result = stmt.run(key);

        if (result.changes > 0) {
            //console.log("🗑 Removed tracker entry:", key);
        } else {
            console.warn("⚠ Tracker entry not found:", key);
        }
    } catch (err) {
        console.error("❌ Failed to remove tracker entry:", err.message);
    }
}

function scanDataDirectory(dir, base = dir, result = []) {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(base, fullPath).replace(/\\/g, "/");

        result.push(relativePath);

        if (item.isDirectory()) {
            scanDataDirectory(fullPath, base, result);
        }
    }

    return result;
}


function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

ipcMain.handle("get-all-paths", async (event, rootDir) => {
    try {
        return scanDataDirectory(rootDir);
    } catch (err) {
        console.error(err);
        return [];
    }
});

ipcMain.handle('uploadChunkToDrive', async (event, chunk = [], mappedDrive, sourceRoot) => {
  try {
    if (!Array.isArray(chunk) || chunk.length === 0) {
      return { success: true, copied: 0 };
    }
    if (!mappedDrive || !sourceRoot) {
      throw new Error('Missing mappedDrive or sourceRoot');
    }

    const rootFolderName = path.basename(sourceRoot);
    const destRoot = path.join(mappedDrive, rootFolderName);

    let copied = 0;

    for (const fullPath of chunk) {
      // ensure file exists
      if (!fs.existsSync(fullPath)) {
        console.warn('Source file not found, skipping:', fullPath);
        continue;
      }

      // compute relative path inside sourceRoot
      let rel = path.relative(sourceRoot, fullPath); // e.g. "sub/folder/file.txt"
      // On Windows ensure forward/backslash consistency
      rel = rel.split(path.sep).join(path.sep);

      const destFullPath = path.join(destRoot, rel);
      const destDir = path.dirname(destFullPath);
      ensureDirSync(destDir);

      // copy the file (synchronous ensures order; you can change to async if desired)
      fs.copyFileSync(fullPath, destFullPath);
      copied++;
    }

    return { success: true, copied };
  } catch (err) {
    console.error('uploadChunkToDrive error:', err);
    return { success: false, error: err.message };
  }
});

// Create the root folder inside mapped drive
ipcMain.handle('createFolderInDrive', async (event, sourceFolderPath, mappedDrive) => {
  try {
    if (!sourceFolderPath || !mappedDrive) {
      throw new Error('Missing parameters');
    }

    const rootFolderName = path.basename(sourceFolderPath);
    const destRoot = path.join(mappedDrive, rootFolderName);

    ensureDirSync(destRoot);

    return { success: true, destRoot };
  } catch (err) {
    console.error('createFolderInDrive error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("basename", async (event, fullPath) => {
    return path.basename(fullPath);
});

ipcMain.handle("copyFileToDrive", async (event, src, relPath, mappedDrive) => {
    const finalPath = path.join(mappedDrive, relPath);

    const folderOnly = path.dirname(finalPath);
    fs.mkdirSync(folderOnly, { recursive: true });

    await fs.promises.copyFile(src, finalPath);

    return { success: true };
});


ipcMain.handle("auto-sync", async (event, args) => {
  const { customer_id, domain_id, apiUrl, syncData } = args;

  const centrisFolder = syncData.config_data.centris_drive; // ex: Centris-Drive

  // ------------------------------------------------------------
  // Strip repeated Centris-Drive prefixes
  // ------------------------------------------------------------
  function stripCentrisPrefix(relPath) {
    if (!relPath) return relPath;

    relPath = relPath.replace(/\\/g, "/").trim();
    const folder = centrisFolder.replace(/\\/g, "/");

    while (relPath.toLowerCase().startsWith(folder.toLowerCase() + "/")) {
      relPath = relPath.substring(folder.length + 1);
    }

    return relPath;
  }

  // ------------------------------------------------------------
  // Normalize snapshot keys
  // ------------------------------------------------------------
  function normalizeSnapshotPath(fullPath, baseFolder) {
    let rel = fullPath.replace(/\\/g, "/");
    baseFolder = baseFolder.replace(/\\/g, "/");

    if (rel.toLowerCase().startsWith(baseFolder.toLowerCase())) {
      rel = rel.substring(baseFolder.length);
    }

    return stripCentrisPrefix(rel);
  }

  // ------------------------------------------------------------
  // File/Folder detection
  // ------------------------------------------------------------
  function getFileType(fullPath) {
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) return "dir";
      if (stat.isFile()) return "file";
      return "unknown";
    } catch {
      return "missing";
    }
  }

  try {
    // ------------------------------------------------------------
    // Mapped folder path (true final path)
    // ------------------------------------------------------------
    const drive_letter = getMappedDriveLetter();
    let mappedDrivePath = `${drive_letter}/${centrisFolder}/`.replace(/\\/g, "/");

    if (process.platform === "win32") {
        // Windows → add base folder
        //mappedDrivePath = path.win32.normalize(`${drive}:\\${baseFolder}`);       
        mappedDrivePath = `${drive_letter}/${centrisFolder}/`.replace(/\\/g, "/");
    } else if (process.platform === "darwin") {
        // macOS → mount path is already correct
        mappedDrivePath = `${drive_letter}/${centrisFolder}`;
    }

    // Load old tracker
    const previousSnapshot = await loadTracker(false);

    // Scan directory
    const rawSnapshot = await getDirectorySnapshot(mappedDrivePath, previousSnapshot);

    let normalizedPrevious = {};
    for (const key in previousSnapshot) {
      const cleaned = normalizeSnapshotPath(key, mappedDrivePath);
      normalizedPrevious[cleaned] = previousSnapshot[key];
    }

    // Create normalized snapshot keys
    let currentSnapshot = {};
    for (const rawKey in rawSnapshot) {
      const cleanKey = normalizeSnapshotPath(rawKey, mappedDrivePath);
      currentSnapshot[cleanKey] = rawSnapshot[rawKey];
    }

    const user_id = syncData.user_data.id;
    let deleteFrom = 'Centris Drive';

    // ------------------------------------------------------------
    // DIFF (NO MORE strip AGAIN — FIX)
    // ------------------------------------------------------------
    let changedItems = findNewOrChangedFiles(currentSnapshot, normalizedPrevious);
    //let deletedItems = Object.keys(previousSnapshot).filter(p => !currentSnapshot[p]);
    let deletedItems = Object.keys(normalizedPrevious).filter(p => !currentSnapshot[p]);

    changedItems = changedItems.filter(Boolean);
    deletedItems = deletedItems.filter(Boolean);

     // Downloaded
    
    //await deleteLocalFilesLogic(event,args);
    //return true;
    //await downloadPendingFilesLogic(event,args);
    
    if (changedItems.length === 0 && deletedItems.length === 0) {
      return { success: true, message: "No  changes in " + deleteFrom +" to Upload." };
    }

    
    //return;
    // ------------------------------------------------------------
    // UPLOAD CHANGED FILES
    // ------------------------------------------------------------
    deleteFrom = 'Centris One';
    
    if (changedItems.length > 0) {
        const uploadChunks = chunkArray(changedItems, 50);

        event.sender.send("upload-progress-start", { total: changedItems.length });

        let processed = 0;

        for (const chunkPaths of uploadChunks) {

            const payloadItems = await Promise.all(
            chunkPaths.map(async relPath => {
                const cleanPath = relPath;

                const fullLocalPath = path
                .join(mappedDrivePath, cleanPath)
                .replace(/\\/g, "/");

                const type = getFileType(fullLocalPath);

                const is_dir = type === "dir";
                let content = null;

                if (!is_dir) {
                    content = await fs.promises.readFile(fullLocalPath, "base64");
                }

                return {
                    path: cleanPath,
                    is_dir,
                    content,
                    size: currentSnapshot[cleanPath]?.size || 0,
                    mtime: currentSnapshot[cleanPath]?.mtime || 0,
                    hash: currentSnapshot[cleanPath]?.hash || null
                    };
                })
            );

            // ✅ Send to server
            const res = await fetch(`${apiUrl}/api/syncChangedItems`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                    customer_id,
                    domain_id,
                    user_id,
                    changed_items: payloadItems
                })
            });

            if (!res.ok) {
                throw new Error("Upload failed");
            }

            // ✅ SAVE TRACKER ITEM-BY-ITEM (AFTER SERVER SUCCESS)
            for (const item of payloadItems) {
                saveTrackerItem({path: normalizeTrackerPath(item.path),
                    type: item.is_dir ? "folder" : "file",
                    size: item.size,
                    mtime: item.mtime,
                    hash: item.hash,
                    synced : 1
                });
            }

            processed += chunkPaths.length;

            event.sender.send("upload-progress", {
            done: processed,
            total: changedItems.length
            });
        }

        event.sender.send("upload-progress-complete");
        setTimeout(() => event.sender.send("upload-progress-hide"), 6000);
    }

    // ------------------------------------------------------------
    // DELETE ITEMS
    // ------------------------------------------------------------
    
    if (deletedItems.length > 0) {
        const delChunks = chunkArray(deletedItems, 50);

        event.sender.send("delete-progress-start", { total: deletedItems.length });

        let processed = 0;

        for (const chunk of delChunks) {

            // ✅ Call server delete
            const res = await fetch(`${apiUrl}/api/deleteSyncedItems`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer_id,
                    domain_id,
                    user_id,
                    deleted_items: chunk,
                    root_path: mappedDrivePath
                })
            });

            if (!res.ok) {
                throw new Error("Server delete failed");
            }

            // ✅ REMOVE FROM TRACKER — ONE BY ONE
            for (const relPath of chunk) {
                await removeFromTracker(relPath);
            }

            processed += chunk.length;

            event.sender.send("delete-progress", {
                done: processed,
                total: deletedItems.length,
                file: chunk?.[chunk.length - 1] ?? null,
                source: deleteFrom
            });
        }

        event.sender.send("delete-progress-complete", {
            source: deleteFrom === "Centris One" ? "Centris One" : "Centris Drive"
        });

        setTimeout(() => event.sender.send("delete-progress-hide"), 6000);
    }


    // SAVE TRACKER
    //saveTracker(currentSnapshot);

    //win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.send("sync-status", "Auto sync complete.");

    return { success: true, message: "Sync completed successfully" };

  } catch (err) {
    console.error("AUTO-SYNC ERROR:", err);
    return { success: false, message: err.message };
  }
});

// function makeRelativePath(fullPath, rootPath) {
//     return fullPath
//         .replace(rootPath, "")
//         .replace(/\\/g, "/")
//         .replace(/^\/+/, "");
// }

function makeRelativePath(fullPath, rootPath) {
    const full = path.resolve(fullPath).replace(/\\/g, "/");
    const root = path.resolve(rootPath).replace(/\\/g, "/");

    if (!full.startsWith(root + "/")) {
        throw new Error(`Invalid path outside root: ${full}`);
    }

    return full.slice(root.length + 1);
}

ipcMain.handle("auto-sync-failed", async (event, args) => {
    const { customer_id, domain_id, apiUrl, syncData } = args;

    const user_id = syncData.user_data.id;
    const centrisFolder = syncData.config_data.centris_drive;
    const deleteFrom = "Centris Drive";

    const db = getDB();

    try {
        // --------------------------------------------------
        // BASE PATH (NO DUPLICATION)
        // --------------------------------------------------
        const driveLetter = getMappedDriveLetter(); // e.g. F:
        const mappedDrivePath = path
            .resolve(`${driveLetter}\\${centrisFolder}`)
            .replace(/\\/g, "/");

        // --------------------------------------------------
        // TEMP SNAPSHOT TABLE
        // --------------------------------------------------
        db.exec(`
            DROP TABLE IF EXISTS temp_snapshot;
            CREATE TEMP TABLE temp_snapshot (
                path TEXT PRIMARY KEY,
                type TEXT,
                size INTEGER,
                mtime INTEGER,
                hash TEXT
            );
        `);

        const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO temp_snapshot
            (path, type, size, mtime, hash)
            VALUES (?, ?, ?, ?, ?)
        `);

        const insertBatch = db.transaction(rows => {
            for (const r of rows) {
                insertStmt.run(
                    r.path,
                    r.type,
                    r.size,
                    r.mtime,
                    r.hash
                );
            }
        });

        // --------------------------------------------------
        // DIRECTORY SCAN (STREAMING)
        // --------------------------------------------------
        async function* scanDirectory(start) {
            const stack = [start];

            while (stack.length) {
                const dir = stack.pop();
                let entries;

                try {
                    entries = await fs.promises.readdir(dir, { withFileTypes: true });
                } catch {
                    continue;
                }

                for (const e of entries) {
                    const full = path.join(dir, e.name);

                    if (e.isDirectory()) {
                        yield { full, type: "folder" };
                        stack.push(full);
                    } else if (e.isFile()) {
                        const stat = await fs.promises.stat(full);
                        yield {
                            full,
                            type: "file",
                            size: stat.size,
                            mtime: stat.mtimeMs
                        };
                    }
                }
            }
        }

        // --------------------------------------------------
        // BUILD SNAPSHOT (BATCHED)
        // --------------------------------------------------
        const BATCH_SIZE = 1000;
        let buffer = [];

        for await (const item of scanDirectory(mappedDrivePath)) {
            const relPath = makeRelativePath(item.full, mappedDrivePath);

            let hash = null;

            if (item.type === "file") {
                const prev = db.prepare(`
                    SELECT mtime, hash FROM tracker WHERE path = ?
                `).get(relPath);

                if (!prev || prev.mtime !== item.mtime) {
                    hash = await hashFile(item.full);
                } else {
                    hash = prev.hash;
                }
            }

            buffer.push({
                path: relPath,
                type: item.type,
                size: item.size || 0,
                mtime: item.mtime || 0,
                hash
            });

            if (buffer.length >= BATCH_SIZE) {
                insertBatch(buffer);
                buffer = [];
            }
        }

        if (buffer.length) insertBatch(buffer);

        // --------------------------------------------------
        // DIFF (SQL BASED)
        // --------------------------------------------------
        const newItems = db.prepare(`
            SELECT t.*
            FROM temp_snapshot t
            LEFT JOIN tracker tr ON t.path = tr.path
            WHERE tr.path IS NULL
        `).all();

        const changedItems = db.prepare(`
            SELECT t.*
            FROM temp_snapshot t
            JOIN tracker tr ON t.path = tr.path
            WHERE tr.synced = 1
              AND (
                    t.hash  != tr.hash OR
                    t.mtime != tr.mtime OR
                    t.size  != tr.size
              )
        `).all();

        const deletedItems = db.prepare(`
            SELECT tr.path
            FROM tracker tr
            LEFT JOIN temp_snapshot t ON tr.path = t.path
            WHERE tr.synced = 1
              AND t.path IS NULL
        `).all();

        await deleteLocalFilesLogic(event,args);
       
        await downloadPendingFilesLogic(event,args);

        // --------------------------------------------------
        // NO CHANGES
        // --------------------------------------------------
        if (newItems.length === 0 &&
            changedItems.length === 0 &&
            deletedItems.length === 0) {

            return {
                success: true,
                message: "No changes found to upload."
            };
        }

        // --------------------------------------------------
        // UPLOAD NEW + CHANGED
        // --------------------------------------------------
        const uploadItems = [...newItems, ...changedItems];

        if (uploadItems.length) {
            event.sender.send("upload-progress-start", {
                total: uploadItems.length
            });

            const chunks = chunkArray(uploadItems, 50);
            let done = 0;

            for (const chunk of chunks) {
                const payload = await Promise.all(
                    chunk.map(async item => {
                        const fullPath = path
                            .join(mappedDrivePath, item.path)
                            .replace(/\\/g, "/");

                        return {
                            path: item.path,
                            is_dir: item.type === "folder",
                            content: item.type === "file"
                                ? await fs.promises.readFile(fullPath, "base64")
                                : null,
                            size: item.size,
                            mtime: item.mtime,
                            hash: item.hash
                        };
                    })
                );

                const res = await fetch(`${apiUrl}/api/syncChangedItems`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        customer_id,
                        domain_id,
                        user_id,
                        changed_items: payload
                    })
                });

                if (!res.ok) {
                    throw new Error("Upload failed");
                }

                for (const i of payload) {
                    saveTrackerItem({
                        path: i.path,
                        type: i.is_dir ? "folder" : "file",
                        size: i.size,
                        mtime: i.mtime,
                        hash: i.hash,
                        synced: 1
                    });
                }

                done += chunk.length;
                event.sender.send("upload-progress", {
                    done,
                    total: uploadItems.length
                });
            }

            event.sender.send("upload-progress-complete");
        }

        if (deletedItems.length) {
            event.sender.send("delete-progress-start", {
                total: deletedItems.length
            });

            const chunks = chunkArray(deletedItems, 50);
            let done = 0;

            for (const chunk of chunks) {

                // For server: keep as objects
                const payload = chunk;  // [{ path: "..."}]

                const res = await fetch(`${apiUrl}/api/deleteSyncedItems`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        customer_id,
                        domain_id,
                        user_id,
                        deleted_items: payload, // send objects for API
                        root_path: mappedDrivePath
                    })
                });

                const result = await res.json();
                if (!res.ok || result.success !== true) {
                    throw new Error(result.message || "Server delete failed");
                }

                // For removing from tracker: extract strings
                for (const p of payload.map(x => x.path)) {
                    await removeFromTracker(p);
                }

                done += payload.length;
                event.sender.send("delete-progress", {
                    done,
                    total: deletedItems.length
                });
            }


            // for (const chunk of chunks) {

            //     // ✅ chunk is already an array of paths (strings)
            //     const paths = chunk;

            //     const res = await fetch(`${apiUrl}/api/deleteSyncedItems`, {
            //         method: "POST",
            //         headers: { "Content-Type": "application/json" },
            //         body: JSON.stringify({
            //             customer_id,
            //             domain_id,
            //             user_id,
            //             deleted_items: paths,
            //             root_path: mappedDrivePath
            //         })
            //     });

            //     const result = await res.json();
            //     if (!res.ok || result.success !== true) {
            //         throw new Error(result.message || "Server delete failed");
            //     }

            //     // ✅ Remove from tracker using SAME path string
            //     for (const p of paths) {
            //         await removeFromTracker(p);
            //     }

            //     done += paths.length;
            //     event.sender.send("delete-progress", {
            //         done,
            //         total: deletedItems.length
            //     });
            // }

            event.sender.send("delete-progress-complete");
        }


        event.sender.send("sync-status", "Auto sync complete");
        return { success: true };

    } catch (err) {
        console.error("AUTO-SYNC ERROR:", err);
        return { success: false, message: err.message };
    }
});

ipcMain.handle("search-paths", async (event, query) => {
    try {
        const db = getDB();
        const q = `%${query.replace(/%/g, "\\%")}%`;

        const rows = db.prepare(`
            SELECT path
            FROM tracker
            WHERE path LIKE ?
            ORDER BY
                (LENGTH(path) - LENGTH(REPLACE(path, '/', ''))) ASC,
                path ASC
            LIMIT 50
        `).all(q);

        return rows.map(r => r.path);
    } catch (err) {
        console.error("Search error:", err);
        return [];
    }
});


ipcMain.handle("copy-file", async (e, src, dest) => {
    const fs = require("fs/promises");
    await fs.copyFile(src, dest);
    return true;
});

ipcMain.handle("read-base64", async (e, p) => {
    const fs = require("fs/promises");
    return await fs.readFile(p, { encoding: "base64" });
});

function fileMetadata(fullPath, rootPath) {
  const stat = fs.statSync(fullPath);
  return {
    relative_path: path.relative(rootPath, fullPath).replace(/\\/g, '/'),
    is_folder: stat.isDirectory(),
    mtime: stat.mtimeMs,
    size: stat.isFile() ? stat.size : null
  };
}

async function streamUploadChunk(apiUrl, endpoint, metaList, rootPath, customerId, domainId, userId) {
  // metaList contains objects:
  // { fullPath, relative_path, is_folder, mtime, size }
  const form = new FormData();

  // Attach JSON metadata for this batch
  form.append('meta', JSON.stringify({
    root_path: rootPath.replace(/\\/g, '/'),
    customer_id: customerId,
    domain_id: domainId,
    user_id: userId,
    items: metaList.map(m => ({
      relative_path: m.relative_path,
      is_folder: m.is_folder,
      mtime: m.mtime,
      size: m.size
    }))
  }));

  // Append each file as stream (only for non-folders)
  metaList.forEach((m, idx) => {
    if (!m.is_folder) {
      // stream - keep field name unique `files[]`
      form.append('files[]', fs.createReadStream(m.fullPath), {
        filename: path.basename(m.fullPath),
        knownLength: m.size
      });
    }
  });

  const headers = form.getHeaders();
  // node-fetch needs content-length otherwise may hang for large posts
  if (form.getLengthSync) {
    try {
      headers['Content-Length'] = form.getLengthSync();
    } catch (e) {
      // ignore
    }
  }

  const res = await fetch(`${apiUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: form
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed ${res.status} ${text}`);
  }

  return res.json();
}

ipcMain.on("stop-sync", () => {
    console.log("🔥 STOP REQUEST RECEIVED");
    global.isSyncCancelled = true;
});

ipcMain.on("hard-stop", () => {
    console.log("💀 Hard stop called. Killing sync task.");
    global.isSyncCancelled = true;

    // force kill long timers
    clearInterval(global.syncTimer);
    clearTimeout(global.syncTimeout);
});


ipcMain.handle("file:stat", (event, filePath) => {
    try {
        return fs.statSync(filePath);
    } catch (err) {
        console.error("Error in fileStat:", err);
        return null; // or throw err
    }
});

// ipcMain.handle("file:read-base64", async (event, filePath) => {
//     try {
//         const data = await fs.promises.readFile(filePath, { encoding: "base64" });
//         return data;
//     } catch (err) {
//         console.error("Error in readFileBase64:", err);
//         return null; // or throw err
//     }
// });



function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}



function saveTrackerChunk(obj) {
    let tracker = loadTracker();
    tracker = { ...tracker, ...obj };

    fs.writeFileSync(trackerPath, JSON.stringify(tracker), "utf-8");
    fs.fsyncSync(fs.openSync(trackerPath, "r+"));
}

function removeDeletedChunk(keys) {
    let tracker = loadTracker();

    keys.forEach(k => delete tracker[k]);

    fs.writeFileSync(trackerPath, JSON.stringify(tracker), "utf-8");
    fs.fsyncSync(fs.openSync(trackerPath, "r+"));
}

// ipcRenderer.on('sync-progress', (event, data = {}) => {
//   const { done = 0, total = 0, file = '' } = data;
//   if (!total) return; // Skip invalid messages

//   //window.postMessage({ type: 'sync-progress', data: { done, total, file } });
// });

ipcMain.handle('getMappedDrive', async () => {
    const drive = getMappedDriveLetter();

    if (process.platform === "win32") {
        // Windows → add base folder
        //drive = path.win32.normalize(`${drive}`);
    } else if (process.platform === "darwin") {
        // macOS → mount path is already correct
        drive = `/${drive}`;
    }
    return drive || "A:\\";
});
  
  // Handle list files
// ipcMain.handle('fs:listFiles', async (event, dirPath) => {
// 	if (!fs.existsSync(dirPath)) return [];
// 	const walk = (dir) => {
// 	  	const entries = fs.readdirSync(dir, { withFileTypes: true });
// 	  	let files = [];
// 	  	for (const entry of entries) {
// 			const fullPath = path.join(dir, entry.name);
// 			if (entry.isDirectory()) {
// 			files = files.concat(walk(fullPath));
// 			} else {
// 			files.push(fullPath);
// 			}
// 	  	}
// 	  	return files;
// 	};
// 	return walk(dirPath);
// });

ipcMain.handle('fs:listFiles', async (_event, dirPath) => {
    if (!dirPath || !fs.existsSync(dirPath)) return [];

    const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let files = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files = files.concat(walk(fullPath));
            } else {
                files.push(fullPath);
            }
        }
        return files;
    };

    return walk(dirPath);
});

// Recursive file listing handler
// ipcMain.handle('fs:listFilesRecursively', async (event, dir) => {
// 	async function listFilesRecursively(dir) {
// 	  let results = [];
// 	  const items = fs.readdirSync(dir, { withFileTypes: true });
// 	  for (let item of items) {
// 			const fullPath = path.join(dir, item.name);
// 			if (item.isDirectory()) {
// 				results.push({ type: 'folder', name: item.name, path: fullPath });
// 				results = results.concat(await listFilesRecursively(fullPath));
// 			} else {
// 				results.push({ type: 'file', name: item.name, path: fullPath });
// 			}
// 	  }
// 	  return results;
// 	}
// 	return await listFilesRecursively(dir);
// });

ipcMain.handle('fs:listFilesRecursively', async (_event, dir) => {
    if (!dir || !fs.existsSync(dir)) return [];

    async function listFilesRecursively(currentDir) {
        let results = [];
        const items = fs.readdirSync(currentDir, { withFileTypes: true });

        for (let item of items) {
            const fullPath = path.join(currentDir, item.name);
            if (item.isDirectory()) {
                results.push({ type: 'folder', name: item.name, path: fullPath });
                results = results.concat(await listFilesRecursively(fullPath));
            } else {
                results.push({ type: 'file', name: item.name, path: fullPath });
            }
        }
        return results;
    }

    return await listFilesRecursively(dir);
});

// ipcMain.handle('fs:listFilesRecursively', async (event, dir) => {
//   async function listFilesRecursively(dir, visited = new Set()) {
//     let results = [];

//     let realPath;
//     try {
//       realPath = fs.realpathSync(dir);
//     } catch {
//       return results; // skip inaccessible directories
//     }

//     if (visited.has(realPath)) return results;
//     visited.add(realPath);

//     const items = fs.readdirSync(dir, { withFileTypes: true });

//     for (const item of items) {
//       const fullPath = path.join(dir, item.name);

//       try {
//         const stat = fs.lstatSync(fullPath);

//         if (stat.isSymbolicLink()) continue; // skip junctions
//         if (item.name.startsWith('.') || item.name.startsWith('$')) continue; // optional: skip hidden/system

//         if (item.isDirectory()) {
//           results.push({ type: 'folder', name: item.name, path: fullPath });
//           results = results.concat(await listFilesRecursively(fullPath, visited));
//         } else if (item.isFile()) {
//           results.push({ type: 'file', name: item.name, path: fullPath });
//         }
//       } catch (err) {
//         console.warn(`Skipping inaccessible item: ${fullPath}`);
//         continue;
//       }
//     }

//     return results;
//   }

//   return await listFilesRecursively(dir);
// });

ipcMain.handle('path:relative', (event, from, to) => {
    return path.relative(from, to);
});

ipcMain.handle("get-base-path", () => {
    if (!app.isPackaged) {
        // Development: project root
        return path.join(__dirname, "..").replace(/\\/g, "/");
    }

    // Production: point to app.asar.unpacked content
    return path.join(process.resourcesPath, "app.asar").replace(/\\/g, "/");
});

function isHiddenWindows(filePath) {
    try {
        const output = execSync(
            `powershell -command "(Get-Item -LiteralPath '${filePath.replace(/'/g, "''")}').Attributes"`,
            { encoding: 'utf8' }
        );
        return /Hidden|System/.test(output);
    } catch {
        return false;
    }
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return "-";
  if (typeof bytes !== "number") bytes = Number(bytes) || 0;

  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  // show up to 2 decimals but drop trailing zeros (e.g. 12.00 -> 12)
  return `${parseFloat(value.toFixed(2))} ${sizes[i]}`;
}

// 🔹 IPC handler to list folder contents
// ipcMain.handle('fs:list-recur-files', async (event, dirPath = null, offset = 0, limit = 1000) => {
//     try {
//         const basePath = dirPath || 'E:\\';
//         const entries = fs.readdirSync(basePath, { withFileTypes: true });

//         // Filter hidden files
//         const visibleEntries = entries.filter(entry => {
//             const fullPath = path.join(basePath, entry.name);
//             return !entry.name.startsWith('.') && !isHiddenWindows(fullPath);
//         });

//         // Apply pagination
//         const paginated = visibleEntries.slice(offset, offset + limit);

//         const items = await Promise.all(
//             paginated.map(async entry => {
//                 const fullPath = path.join(basePath, entry.name);
//                 const stats = await fs.promises.stat(fullPath);

//                 return {
//                     name: entry.name,
//                     path: fullPath,
//                     isDirectory: entry.isDirectory(),
//                     size: entry.isDirectory() ? "-" : formatSize(stats.size),
//                     modified_date: new Date(stats.mtime).toLocaleString(),
//                     modified_by: os.userInfo().username || "Unknown",
//                     shared: false,
//                 };
//             })
//         );

//         return {
//             currentPath: basePath,
//             items,
//             total: visibleEntries.length,
//             hasMore: offset + limit < visibleEntries.length
//         };
        

//     } catch (err) {
//         console.error('Error reading directory:', err);
//         return { error: err.message };
//     }
// });

ipcMain.handle('fs:list-recur-files', async (event, dirPath = 'E:\\', offset = 0, limit = 100) => {
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        const visibleEntries = entries.filter(entry => {
            const fullPath = path.join(dirPath, entry.name);
            return !entry.name.startsWith('.') && !isHiddenWindows(fullPath);
        });

        const paginated = visibleEntries.slice(offset, offset + limit);

        const items = await Promise.all(
            paginated.map(async entry => {
                const fullPath = path.join(dirPath, entry.name);
                const stats = await fs.promises.stat(fullPath);

                return {
                    name: entry.name,
                    path: fullPath,
                    isDirectory: entry.isDirectory(),
                    size: entry.isDirectory() ? '-' : formatSize(stats.size),
                    modified_date: new Date(stats.mtime).toLocaleString(),
                    modified_by: os.userInfo().username || 'Unknown',
                    shared: false,
                };
            })
        );

        return {
            currentPath: dirPath,
            items,
            total: visibleEntries.length,
            hasMore: offset + limit < visibleEntries.length
        };

    } catch (err) {
        console.error('Error reading directory:', err);
        return { error: err.message };
    }
});


ipcMain.handle("scanFolder", async (event, folderPath) => {
    const files = [];
    const folders = [];

    function scan(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                folders.push(full);
                scan(full);
            } else {
                files.push(full);
            }
        }
    }

    scan(folderPath);

    return {
        files,
        folders
    };
});



// Open folder via dialog and return folder path
ipcMain.handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
});

ipcMain.handle("dialog:openFolders", async () => {
    const res = await dialog.showOpenDialog({
        title: "Select folders",
        properties: ["openDirectory", "multiSelections"]
    });

    return res.canceled ? null : res.filePaths;
});

ipcMain.handle('dialog:openFile', async () => {
    const res = await dialog.showOpenDialog({
        properties: ['openFile'], // allows single file selection
        filters: [
        { name: 'All Files', extensions: ['*'] }
        // you can restrict types, e.g. { name: 'Documents', extensions: ['pdf', 'docx'] }
        ]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
        return res.filePaths[0];
});

ipcMain.handle('dialog:openFiles', async () => {
    // Open dialog to select multiple files
    const res = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
    });

    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths; // array of selected file paths
});

// New code
// Read directory entries (files + folders)
ipcMain.handle('fs:readDir', async (ev, folderPath) => {
    try {
    const names = await fs.readdir(folderPath, { withFileTypes: true });
    const items = await Promise.all(names.map(async (dirent) => {
    const full = path.join(folderPath, dirent.name);
    const stat = await fs.stat(full);
    return {
    name: dirent.name,
    path: full,
    isDirectory: dirent.isDirectory(),
    size: dirent.isDirectory() ? 0 : stat.size,
    mtimeMs: stat.mtimeMs
    };
    }));
    // sort: folders first, then files
    items.sort((a,b) => (a.isDirectory === b.isDirectory) ? a.name.localeCompare(b.name) : (a.isDirectory ? -1 : 1));
    return items;
    } catch (err) {
    return { error: err.message };
    }
});


// Read file content (text) - returns utf8 string
ipcMain.handle('fs:readFile', async (ev, filePath) => {
    try {
        const buffer = await fs.readFile(filePath);
        // try to detect binary by checking for 0 byte
        const isBinary = buffer.includes(0);
        if (isBinary) return { binary: true };
        return { text: buffer.toString('utf8') };
    } catch (err) {
        return { error: err.message };
    }
});


// Optionally open file in external editor
ipcMain.handle('shell:openItem', (ev, filePath) => {
    try {
        require('electron').shell.openPath(filePath);
        return { ok: true };
    } catch (err) {
        return { error: err.message };
    }
});


ipcMain.handle("getAppConfig", async () => {
    const platform = os.platform();
    let driveRoot = null;

    if (platform === "win32") {
        // Example: "F:\"
        driveRoot = getMappedDriveLetter("Centris-Drive");
    } else if (platform === "darwin") {
        // Example: "/Volumes/Centris-Drive"
        driveRoot = "/Volumes/" + VOLUME_LABEL;
    }

    if (!driveRoot) {
        throw new Error("Centris Drive not mounted");
    }

    // Build final paths safely
    const drivePath =
        platform === "win32"
            ? path.win32.join(driveRoot, syncData.config_data.centris_drive)
            : driveRoot;

    const config = {
        vhdx_name: VHDX_NAME,
        drivePath :drivePath,
        driveCustDomPath: drivePath,
        userName: syncData.user_data.user_name,
        version: app.getVersion(),
        vhdx_path: VHDX_PATH
    };

    return config;
});

ipcMain.handle("fs:upload-folder", async (event, srcDir, destDir) => {
    try {
        function copyRecursive(src, dest) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });

            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                    copyRecursive(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }

        // 👇 include the folder itself (e.g., D:\uploads\folder1)
        const folderName = path.basename(srcDir);
        const destFolder = path.join(destDir, folderName);

        copyRecursive(srcDir, destFolder);

        return { success: true };
    } catch (err) {
        console.error("Upload error:", err);
        return { success: false, error: err.message };
    }
});
//deepak

ipcMain.handle('uploadFileToDrive', async (event, files, targetDir) => {
  try {
    if (!files || !Array.isArray(files) || files.length === 0) {
      throw new Error('No files selected for upload.');
    }

    if (!fs.existsSync(targetDir)) {
      throw new Error('Target directory not found.');
    }

    for (const file of files) {
      const fileName = path.basename(file);
      const destPath = path.join(targetDir, fileName);
      fs.copyFileSync(file, destPath); // simple copy (synchronous)
    }

    return { success: true, message: 'All files uploaded successfully.' };
  } catch (err) {
    console.error('Upload error:', err);
    return { success: false, error: err.message };
  }
});


// Set session after login
ipcMain.on('set-session', (event, data) => {
    sessionData = {
        ...data,
        loginTime: Date.now(),
    };
    console.log('✅ Session saved:', sessionData);
});

// Clear session (on logout)
ipcMain.on('clear-session', () => {
    console.log('🧹 Clearing session');
    sessionData = null;
});

// Check if session exists
ipcMain.handle('check-session', () => {
    if (!sessionData) return null;

    // Optional: expire after 6 hours (21600000 ms)
    const expired = Date.now() - sessionData.loginTime > 21600000;
    if (expired) {
        sessionData = null;
        return null;
    }

    return sessionData;
});

ipcMain.handle("get-directory-snapshot", async (event, dir,oldSnapshot = {}) => {
    try {
        const snapshot = await getDirectorySnapshot(dir,oldSnapshot);
        return { success: true, snapshot };
    } catch (error) {
        console.error("Error generating directory snapshot:", error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle("save-tracker", async (event, { snapshot, syncedDefault }) => {
    saveTracker(snapshot, syncedDefault);
    return { success: true };
});

// ipcMain.handle("load-tracker", () => {
//     return loadTracker();
// });

ipcMain.handle("load-tracker", (event, { onlyUnsynced }) => {
    return loadTracker(onlyUnsynced);
});

ipcMain.handle("create-vhdx", async () => {    
    return await vhdxService.createVHDX();
});

ipcMain.on("user:logout", () => {
    console.log("🔒 User logged out, unmounting VHDX...");   
    if (process.platform === "win32") {
        unmountVHDX();
    } else if (process.platform === "darwin") {
        unmountMacDisk();
    } else {
        unmountVHDX();
        console.warn("❌ Unsupported platform");
    }
    killLeftoverProcesses();
    app.quit();
});

ipcMain.handle("open-external-file", async (_, filePath) => {
    await shell.openPath(filePath);
});

ipcMain.on("start-drive-watcher", (event, syncData) => {
    startDriveWatcher(syncData);
});

ipcMain.handle("stop-drive-watcher", async () => {
    stopDriveWatcher();
});

ipcMain.on("start-server-polling", (event, syncData) => {
    startServerPolling(event,syncData);
});

ipcMain.handle("stop-server-polling", async () => {
    stopServerPolling();
});

ipcMain.handle("get-session-user", async () => {
    try {
        const sessionFile = path.join(app.getPath("userData"), "session.json");

        if (!fs.existsSync(sessionFile)) {
            return null;
        }

        const raw = fs.readFileSync(sessionFile, "utf8");
        const session = JSON.parse(raw);

        if (!session.user_data) {
            return null;
        }

        const u = session.user_data;

        return {
            id: u.id,
            user_name: u.user_name,
            first_name: u.first_name,
            last_name: u.last_name,
            profile_image : u.profile_image,
            active: true
        };
    } catch (err) {
        console.error("Session read error:", err);
        return null;
    }
});

ipcMain.handle("set-sync-enabled", async (e, enabled) => {
  setSyncEnabled(enabled);

  // notify backend
  try {
    await fetch(`${apiUrl}/sync-preference`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sync_enabled: enabled ? 1 : 0 })
    });
  } catch {
    // offline → safe to ignore
  }
});


ipcMain.handle("get-sync-status", async (event, params) => {
  return await getSyncEnabled(params);
});

ipcMain.handle("set-sync-status", async (event, user, enabled) => {
  // 1️⃣ Save locally (SQLite)
  await setSyncEnabled(user, "sync_enabled", enabled ? "1" : "0");

  // Optional: update last_sync_at when enabling
  if (enabled) {
    await setSyncEnabled(
      user,
      "last_sync_at",
      Math.floor(Date.now() / 1000).toString()
    );
  }
  console.log(user.apiUrl);
  // 2️⃣ Update server (user-wise)
  try {
    const response = await fetch(`${user.apiUrl}/api/update-sync-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.user_id,
        sync_status: enabled ? 1 : 0
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    console.log("✅ Sync status updated on server");
  } catch (err) {
    console.error("❌ Server sync status update failed:", err.message);
  }

  return true;
});


ipcMain.handle("user-sync-update-success", async (event, user) => {
  return onUserSyncLogin(user);
});



function isHiddenWindows(filePath) {
    try {
        const stats = fs.statSync(filePath, { bigint: false });
        return !!(stats.mode & 0o200000); // very rough check; better via attrib in PowerShell
    } catch {
        return false;
    }
}

function normalizePath(p) {
  return p.replace(/^[A-Za-z]:/, ""); // remove drive letters
}

function addDriveLetter(drive, filePath) {
  // ensure begins with slash
  if (!filePath.startsWith('/')) filePath = '/' + filePath;
  return drive + filePath.replace(/\//g, '\\');
}

function getSyncEnabledFails(params = {}) {
  const { customer_id, domain_id, domain_name, user_id } = params;
  const db = getDB();

  // default ON if params missing
  if (!customer_id || !domain_id || !domain_name || !user_id) {
    return true;
  }

  try {
    const stmt = db.prepare(`
      SELECT value FROM app_settings
      WHERE customer_id = ?
        AND domain_id = ?
        AND domain_name = ?
        AND user_id = ?
        AND "key" = 'sync_enabled'
    `);

    const row = stmt.get(customer_id, domain_id, domain_name, user_id);

    if (!row) return true;
    return row.value === "1";

  } catch (err) {
    console.error("getSyncEnabled error:", err);
    return true; // fail-safe default
  }
}

function getSyncEnabled(params = {}) {
  const { customer_id, domain_id, domain_name, user_id } = params;
  const db = getDB();

  // default ON
  if (!customer_id || !domain_id || !domain_name || !user_id) {
    return 1;
  }

  try {
    const stmt = db.prepare(`
      SELECT value FROM app_settings
      WHERE customer_id = ?
        AND domain_id = ?
        AND domain_name = ?
        AND user_id = ?
        AND "key" = 'sync_enabled'
    `);

    const row = stmt.get(customer_id, domain_id, domain_name, user_id);

    if (!row) return 1;

    return Number(row.value) === 1 ? 1 : 0;

  } catch (err) {
    console.error("getSyncEnabled error:", err);
    return 1;
  }
}



function setSyncErrorEnabled(
  { customer_id, domain_id,domain_name, user_id },
  enabled
) {
  const db = getDB();

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO app_settings
       (customer_id, domain_id,domain_name, user_id, "key", value)
       VALUES (?, ?, ?, ?, 'sync_enabled', ?)
       ON CONFLICT(customer_id, domain_id,domain_name, user_id, "key")
       DO UPDATE SET
         value = excluded.value,
         updated_at = strftime('%s','now')`,
      [customer_id, domain_id, domain_name , user_id, enabled ? "1" : "0"],
      (err) => {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
}

function setSyncEnabled({ customer_id, domain_id, domain_name, user_id },
  key,
  value
) {
  const db = getDB();
    console.log(customer_id + ' = ' + domain_id + ' = ' + domain_name + ' = ' + key + ' = ' +  value);
  const stmt = db.prepare(`
    INSERT INTO app_settings
      (customer_id, domain_id, domain_name, user_id, "key", value)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(customer_id, domain_id,domain_name, user_id, "key")
    DO UPDATE SET
      value = excluded.value,
      domain_name = excluded.domain_name,
      updated_at = strftime('%s','now')
  `);

  stmt.run(
    customer_id,
    domain_id,
    domain_name,
    user_id,
    key,
    value
  );

  return true;
}


function onUserSyncLogin(user) {
  insertDefaultSetting.run(
    user.customer_id,
    user.domain_id,
    user.domain_name,
    user.user_id,    
    "sync_enabled",
    "1"
  );

  insertDefaultSetting.run(
    user.customer_id,
    user.domain_id,
    user.domain_name,
    user.user_id,    
    "last_sync_at",
    "0"
  );

  return true;
}


// ipcMain.handle('create-test-folder', async () => {
//     try {
//         const TEST_FOLDER = path.join(app.getPath('documents'), 'CentrisSyncTest');

//         if (!fs.existsSync(TEST_FOLDER)) {
//             fs.mkdirSync(TEST_FOLDER, { recursive: true });
//             console.log('Test folder created at', TEST_FOLDER);
//         }

//         return TEST_FOLDER; // return folder path to renderer
//     } catch (err) {
//         console.error('Error creating test folder:', err);
//         throw err; // propagate error to renderer
//     }
// });

function safeCleanup() {
    if (isDev) {
        console.log("🔧 Dev mode detected — skipping session cleanup and VHDX unmount.");
        return;
    }

    console.log("🧹 Production cleanup: clearing session & unmounting VHDX...");

    try {
        clearSession();
    } catch (e) {
        console.warn("⚠️ Failed to clear session:", e.message);
    }

    try {
        if (isDev) {
           // no mount mount
        }else{
            if (process.platform === "win32") {
                unmountVHDX();
            } else if (process.platform === "darwin") {
                unmountMacDisk();
            } else {
                unmountVHDX();
                console.warn("❌ Unsupported platform");
            }
        }
    } catch (e) {
        console.warn("⚠️ Failed to unmount VHDX:", e.message);
    }
}


function killLeftoverProcesses1() {
    try {
        execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' });
        console.log("🧹 Leftover Electron processes killed.");
    } catch (e) {
        console.warn("⚠️ No leftover processes to kill.");
    }
}



function killLeftoverProcesses() {
    try {
        if (process.platform === "win32") {
            execSync(`taskkill /F /IM "${path.basename(process.execPath)}"`, { stdio: "ignore" });
        } 
        else if (process.platform === "darwin") {
            execSync(`pkill -f "${app.getName()}"`, { stdio: "ignore" });
        }

        console.log("🧹 Leftover app processes killed.");
    } catch {
        console.warn("⚠️ No leftover processes to kill.");
    }
}


process.on('exit', () => {
  
    try { 
        safeCleanup();
        console.log('💾 VHDX unmounted on exit.');
    } catch (e) {
        console.warn('⚠️ Failed to unmount VHDX on exit:', e.message);
    }
});

app.on("before-quit", () => {
  console.log("🧹 Cleaning old instances...");
  try {
    safeCleanup();
    killLeftoverProcesses();
  } catch (e) {
    console.warn("⚠ Cleanup failed");
  }
});


app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
    
});