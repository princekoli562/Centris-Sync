
const { app, BrowserWindow, ipcMain,dialog, Tray, Menu,shell } = require('electron');
//const path = require('node:path');
const path = require("path");
const fs = require('fs');
const crypto = require('crypto');
const FormData = require('form-data'); 
const sudo = require("sudo-prompt");
const https = require("https");
const http = require("http");
//const vhdxService = require(path.join(__dirname, "assets/js/vhdx-service.js"));
//const adminTasks  = require(path.join(__dirname, "assets/js/admin-task.js"));

//console.log(process.env.NODE_ENV);


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
let win;
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
//global.isSyncCancelled = false;

let syncData = {
  customer_data: null,
  domain_data: null,
  user_data: null,
  config_data: null,
  apiUrl: null,
};

const isDev = !app.isPackaged;

const preloadPath = isDev
    ? path.join(__dirname, "preload.js")
    : path.join(process.resourcesPath, "app.asar.unpacked", "preload.js");
    

const iconPath = isDev
    ? path.join(__dirname, "assets/images/favicon.ico")
    : path.join(process.resourcesPath, "app.asar" ,"assets/images/favicon.ico");

function sendLogToRenderer(message) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && win.webContents) {
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
//
const createWindow = async () => {
    // if (win) {
    //     // 👇 If already exists, just show instead of recreating
    //     win.show();
    //     return;
    // }
    // win = new BrowserWindow({
    //     width: 800,
    //     height: 600,
    //     webPreferences: {
    //         preload: path.join(__dirname, 'preload.js'),
    //         contextIsolation: true,
    //         enableRemoteModule: false,
    //         nodeIntegration: false // ❗ keep false for security
    //     },
    //     icon: path.join(__dirname, 'assets/images/favicon.ico')
    // });

    

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
            webSecurity: false
        },
        icon: iconPath
    });

    // ✅ Use local session checker instead of win.electronAPI
    const sessionActive = isSessionActive(); // function defined below
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

    //win.webContents.on('did-finish-load', handleSessionCheck);
   // win.webContents.on('did-navigate', handleSessionCheck);

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

  //   function handleSessionCheck() {
  //         if (!isSessionActive() && !redirectingToLogin) {
  //             redirectingToLogin = true; // 🔒 prevent multiple triggers
  //             console.log("⚠️ Session expired — redirecting to login page...");
  //             await win.loadFile(path.join(__dirname, 'index.html').then(() => {
  //             redirectingToLogin = false; // ✅ reset once done
  //         });
  //     }
  // }

    async function handleSessionCheck() {
        if (!isSessionActive() && !redirectingToLogin) {
            redirectingToLogin = true; // prevent multiple triggers
            console.log("⚠️ Session expired — redirecting to login page...");

            try {
                await win.loadFile(getHtmlPath('index.html'));
            } catch (err) {
                console.error("Error loading login page:", err);
            }

            redirectingToLogin = false; // reset after done
        }
    }

    function getHtmlPath(file) {
        return isDev
            ? path.join(__dirname, file)                // Dev folder
            : path.join(process.resourcesPath, "app.asar", file); // Packaged EXE
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





// ✅ Helper: checks if session exists and is valid
function isSessionActive() {
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

async function getDirectorySnapshotold(dir, oldSnap = {}) {
    const snapshot = {};
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const key = normalizePath(fullPath);
        const stats = fs.statSync(fullPath);

        if (entry.isDirectory()) {
            snapshot[key] = {
                type: "folder",
                mtime: stats.mtimeMs,
            };

            Object.assign(snapshot, await getDirectorySnapshotold(fullPath, oldSnap));
        } 
        else {
            // 🟢 NEW HASH LOGIC (as you requested)
            let prev = oldSnap[key];
            let hash = prev?.hash || null;

            if (!prev || prev.mtime !== stats.mtimeMs) {
                hash = await hashFile(fullPath);
            }

            snapshot[key] = {
                type: "file",
                size: stats.size,
                mtime: stats.mtimeMs,
                hash,
            };
        }
    }

    return snapshot;
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

async function updateTrackerAfterDownload(serverItems, tracker, driveRoot, trackerPath) {

    const missingItems = compareServerAndDesktop(serverItems, tracker);

    for (const item of missingItems) {

        const localPath = path.join(driveRoot, item.path.replace(/\//g, '\\'));

        // -------------------------
        // 📁 FOLDER
        // -------------------------
        if (item.type === "folder") {
            if (!fs.existsSync(localPath)) {
                fs.mkdirSync(localPath, { recursive: true });
            }

            // Update tracker entry
            tracker[item.path] = {
                type: "folder",
                size: 0,
                mtime: item.mtime,
                hash: null
            };

            continue;
        }

        // -------------------------
        // 📄 FILE (download)
        // -------------------------
        await downloadToPath(item.url, localPath);

        // After download, read fresh file stats
        let stats = fs.statSync(localPath);

        // Compute hash of downloaded file
        let hash = await hashFile(localPath);

        // Update tracker entry
        tracker[item.path] = {
            type: "file",
            size: stats.size,
            mtime: item.mtime,   // server-side MTime
            hash: hash
        };
    }

    // Save updated tracker.json
    saveTracker(trackerPath, tracker);
}

async function downloadToPath(fileUrl, destPath) {
    return new Promise((resolve, reject) => {

        // Ensure folder exists
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const fileStream = fs.createWriteStream(destPath);

        const protocol = fileUrl.startsWith("https") ? https : http;

        const request = protocol.get(fileUrl, response => {
            if (response.statusCode !== 200) {
                reject(new Error(`Download failed: ${response.statusCode}`));
                return;
            }

            response.pipe(fileStream);
        });

        fileStream.on("finish", () => {
            fileStream.close(resolve);
        });

        request.on("error", err => {
            fs.unlink(destPath, () => {}); // delete partial file
            reject(err);
        });

        fileStream.on("error", err => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}


function removeDeleted(oldSnap, newSnap) {
    for (let key in oldSnap) {
        if (!newSnap[key]) {
            // deleted entry → handle delete logic
        }
    }
}

function loadTracker() {
    const trackerPath = path.join(app.getPath('userData'), 'sync-tracker.json');
    if (fs.existsSync(trackerPath)) {
        return JSON.parse(fs.readFileSync(trackerPath, 'utf8'));
    }
    return {};
}



function saveTracker(snapshot) {
    const trackerPath = path.join(app.getPath('userData'), 'sync-tracker.json');
    fs.writeFileSync(trackerPath, JSON.stringify(snapshot, null, 2));
}


async function getDirectorySnapshot(dir, oldSnap = {}, baseDir = dir) {
    const snapshot = {};
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        let relPath = normalizePath(path.relative(baseDir, fullPath));
        relPath = relPath.replace(/\\/g, "/");
       console.log('mm -> ' +relPath );
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


function findNewOrChangedFilesPrince(current, previous) {
    const changed = [];

    for (const key in current) {
        const curr = current[key];
        const prev = previous[key];

        if (!prev) {
            changed.push(key);
            continue;
        }

        if (curr.type === "folder") {
            if (curr.mtime !== prev.mtime) changed.push(key);
            continue;
        }

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

function findNewOrChangedFiles(current, previous) {
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
    console.log(raw);

    return JSON.parse(raw).pending;
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

    return JSON.parse(raw).data;
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


function getMappedDriveLetter(volumeLabel = "Centris-Drive") {
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
    const SYNC_FOLDER = path.join(homeDir, 'Centris-Drive');

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
    //
	createWindow();
	//const folderPath = createSyncFolderAndDrive();
    if (!isAdmin()) {
        relaunchAsAdmin();
    } else {
        createAndMountVHDX();
    }

    //createSyncFolderAndDrive();


    // 🔄 Auto sync every 5 minutes
    // setInterval(() => {
    //     autoSync({ customer_id, domain_id , apiUrl ,syncData }).catch(console.error);
    // }, 5 * 60 * 1000); // 5 min

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
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

function cleanSegment(s) {
    return s.replace(/^[:\\/]+|[:\\/]+$/g, ""); // remove leading/trailing slashes or colon
}

async function downloadPendingFilesLogicPrince(event, args) {
    const { customer_id, domain_id, apiUrl, syncData} = args;

    const pending = await downloadServerPending(args);
    if (!Array.isArray(pending) || pending.length === 0) {
        event.sender.send("download-complete");
        return true;
    }

    const drive = cleanSegment(getMappedDriveLetter());
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);

    // FINAL CORRECT MAPPED DRIVE PATH
    const mappedDrivePath = path.join(drive + ":", baseFolder); 

    const totalFiles = pending.length;
    let completedFiles = 0;

    event.sender.send("download-progress-start", { total: totalFiles });

    for (const item of pending) {
        try {
            const cleanLocation = normalizeServerPath(item.location);
            const fullLocalPath = path.join(mappedDrivePath, cleanLocation);

            const fileDir = path.dirname(fullLocalPath);
            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
            }

            if (item.type === "folder") {
                if (!fs.existsSync(fullLocalPath)) {
                    fs.mkdirSync(fullLocalPath, { recursive: true });
                }
            } else {
                const fileStream = fs.createWriteStream(fullLocalPath);
                let chunkIndex = 0;

                for (const chunk of item.chunks) {
                    const binaryChunk = Buffer.from(chunk, "base64");
                    fileStream.write(binaryChunk);

                    chunkIndex++;
                    const filePercent = Math.floor((chunkIndex / item.chunks.length) * 100);

                    event.sender.send("download-progress", {
                        done: completedFiles,
                        total: totalFiles,
                        file: item.location,
                        filePercent
                    });
                }

                fileStream.end();
            }

            await updateSaveTracker(fullLocalPath,cleanLocation, item);

            await fetch(`${apiUrl}/api/mark-downloaded`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: item.id })
            });


            completedFiles++;
            event.sender.send("download-progress", {
                done: completedFiles,
                total: totalFiles,
                file: item.location,
                filePercent: 100
            });

        } catch (err) {
            console.log("Download error:", item.location, err);
        }
    }

    event.sender.send("download-complete");
    setTimeout(() => event.sender.send("download-hide"), 6000);

    return true;
}

async function downloadPendingFilesLogic(event, args) {
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

    const totalFiles = pending.length;
    let completedFiles = 0;

    event.sender.send("download-progress-start", { total: totalFiles });

    for (const item of pending) {
        try {
            const cleanLocation = normalizeServerPath(item.location);
            const fullLocalPath = path.join(mappedDrivePath, cleanLocation);

            // Ensure directory exists
            const fileDir = path.dirname(fullLocalPath);
            if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });

            if (item.type === "file") {

                const fileStream = fs.createWriteStream(fullLocalPath);

                for (const chunk of item.chunks) {
                    const binaryChunk = Buffer.from(chunk, "base64");
                    fileStream.write(binaryChunk);
                }

                fileStream.end();

                // 🔥🔥 wait for file to finish writing before tracker update
                await new Promise(resolve => fileStream.on("finish", resolve));

                // now update tracker
                await updateSaveTracker(fullLocalPath, cleanLocation, item);
            }
            else {
                // folder case
                if (!fs.existsSync(fullLocalPath)) {
                    fs.mkdirSync(fullLocalPath, { recursive: true });
                }
                await updateSaveTracker(fullLocalPath, cleanLocation, item);
            }

            // Mark downloaded on server safely
            await markDownloaded(apiUrl, item.id);

            completedFiles++;
            event.sender.send("download-progress", {
                done: completedFiles,
                total: totalFiles,
                file: item.location,
                filePercent: 100,
            });

        } catch (err) {
            console.error("Download error:", item.location, err.message);
        }
    }

     event.sender.send("download-complete", {
        source: SourceFrom === "Centris One" ? "Centris One" : "Centris Drive",
        status: "download"
    });
    setTimeout(() => event.sender.send("download-hide"), 6000);
    return true;
}


async function deleteLocalFilesLogic(event, args) {
    const { customer_id, domain_id, apiUrl, syncData } = args;
    const deleteFrom = 'Centris Drive';

    const deletedData = await getServerDeletedData(args);
    if (!Array.isArray(deletedData) || deletedData.length === 0) {
      
        event.sender.send("delete-progress-complete", {
            source: deleteFrom === "Centris One" ? "Centris One" : "Centris Drive",
            status: "no-delete"
        });
        setTimeout(() => event.sender.send("delete-hide"), 6000);
        return true;
    }

    const drive = cleanSegment(getMappedDriveLetter());
    const baseFolder = cleanSegment(syncData.config_data.centris_drive);
    const mappedDrivePath = path.join(drive + ":", baseFolder);

    const totalFiles = deletedData.length;
    let completedFiles = 0;
    

    event.sender.send("delete-progress-start", { total: totalFiles });

    for (const item of deletedData) {
        try {
            const cleanLocation = normalizeServerPath(item.location);
            const fullLocalPath = path.join(mappedDrivePath, cleanLocation);
            console.log(cleanLocation);
            // ======================
            // 🔥 LOCAL DELETE LOGIC
            // ======================
            let deletedSuccessfully = false;

            if (item.type === "file") {
                if (fs.existsSync(fullLocalPath)) {
                    try {
                        fs.unlinkSync(fullLocalPath);
                        deletedSuccessfully = true;
                    } catch (err) {
                        console.error("❌ Failed to delete file:", fullLocalPath, err.message);
                    }
                }
            }

            else if (item.type === "folder") {
                if (fs.existsSync(fullLocalPath)) {
                    try {
                        fs.rmSync(fullLocalPath, { recursive: true, force: true });
                        deletedSuccessfully = true;
                    } catch (err) {
                        console.error("❌ Failed to delete folder:", fullLocalPath, err.message);
                    }
                }
            }

            // ==============================
            // 🔥 ONLY IF DELETED SUCCESSFULLY
            // ==============================
            console.log('XXX - > ' + cleanLocation + ' = ' + item.id);
            if (deletedSuccessfully) {
                console.log('JJJ - > ' + cleanLocation);
                // Remove from tracker
                await removeFromTracker(cleanLocation);

                // Flush DB entry
                await removeDeletedata(apiUrl, item.id);

            } else {
                console.warn("⚠️ Skip tracker + server flush. Local delete failed:", fullLocalPath);
            }

            completedFiles++;
            event.sender.send("delete-progress", {
                done: completedFiles,
                total: totalFiles,
                file: fullLocalPath,
                source : deleteFrom
            });

        } catch (err) {
            console.error("Delete error:", item.location, err.message);
        }
    }


    event.sender.send("delete-progress-complete", {
        source: deleteFrom === "Centris One" ? "Centris One" : "Centris Drive",
        status: "delete"
    });
    setTimeout(() => event.sender.send("delete-hide"), 6000);

    return true;
}


// async function downloadPendingFilesLogic(event, args) {
//     const { apiUrl, syncData, customer_id, domain_id } = args;

//     const drive = cleanSegment(getMappedDriveLetter());
//     const baseFolder = cleanSegment(syncData.config_data.centris_drive);
//     const mappedDrivePath = path.join(drive + ":", baseFolder);

//     let totalDownloaded = 0;

//     while (true) {
//         let response = await downloadServerPending(apiUrl, syncData, customer_id, domain_id, 50);

//         if (!response.pending || response.pending.length === 0) break;

//         let batch = response.pending;

//         event.sender.send("download-progress-start", { total: batch.length });

//         let completed = 0;

//         for (const item of batch) {
//             try {
//                 const cleanLocation = normalizeServerPath(item.location);
//                 const fullLocalPath = path.join(mappedDrivePath, cleanLocation);

//                 const fileDir = path.dirname(fullLocalPath);
//                 if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });

//                 if (item.type === "folder") {
//                     if (!fs.existsSync(fullLocalPath)) fs.mkdirSync(fullLocalPath, { recursive: true });
//                 } else {
//                     const fileStream = fs.createWriteStream(fullLocalPath);

//                     for (let i = 0; i < item.chunks.length; i++) {
//                         const binaryChunk = Buffer.from(item.chunks[i], "base64");
//                         fileStream.write(binaryChunk);

//                         event.sender.send("download-progress", {
//                             done: completed,
//                             total: batch.length,
//                             file: item.location,
//                             filePercent: Math.floor(((i + 1) / item.chunks.length) * 100)
//                         });
//                     }

//                     fileStream.end();
//                 }

//                 await updateSaveTracker(fullLocalPath, cleanLocation, item);

//                 await fetch(`${apiUrl}/api/mark-downloaded`, {
//                     method: "POST",
//                     headers: { "Content-Type": "application/json" },
//                     body: JSON.stringify({ id: item.id })
//                 });

//                 completed++;
//                 totalDownloaded++;

//                 event.sender.send("download-progress", {
//                     done: completed,
//                     total: batch.length,
//                     file: item.location,
//                     filePercent: 100
//                 });

//             } catch (err) {
//                 console.log("Download error:", item.location, err);
//             }
//         }

//         if (!response.has_more) break;
//     }

//     event.sender.send("download-complete");
//     setTimeout(() => event.sender.send("download-hide"), 6000);

//     return true;
// }



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
    const saveTrackerPath = path.join(app.getPath("userData"), "sync-tracker.json");

    // Load tracker safely
    let tracker = {};
    try {
        tracker = JSON.parse(fs.readFileSync(saveTrackerPath, "utf-8"));
    } catch (err) {
        tracker = {};
    }

    // Ensure file/folder exists
    let stats;
    try {
        stats = fs.statSync(fullPath);
    } catch (err) {
        console.warn(`⚠️ Missing path (skip tracker): ${fullPath}`);
        return;
    }

    const key = cleanLocation.replace(/\\/g, "/");

    // ---------- FIX #1: Always trust server hash for S2C direction ----------
    // If item.hash exists, ALWAYS use that (server and desktop must match)
    let hash = item?.hash || null;

    // ---------- FIX #2: Only compute hash when no incoming hash ----------
    if (stats.isFile() && !hash) {
        try {
            hash = await hashFile(fullPath); // same function used in C2S snapshot
        } catch (err) {
            console.warn(`⚠️ Failed to hash file: ${fullPath}`, err.message);
        }
    }

    // ---------- FIX #3: Proper mtime handling ----------
    // Prefer server mtime for S2C, otherwise local stat value
    const mtime = item?.mtimeMs ? Number(item.mtimeMs) : stats.mtimeMs;

    // ---------- FIX #4: Update filesystem timestamps (only for files) ----------
    if (stats.isFile()) {
        try {
            fs.utimesSync(
                fullPath,
                stats.atime,         // keep access time
                new Date(mtime)      // update modified time
            );
        } catch (err) {
            console.warn(`⚠️ Failed to set mtime: ${fullPath} : ${err.message}`);
        }
    }

    // ---------- FIX #5: Update tracker ----------
    tracker[key] = {
        type: stats.isDirectory() ? "folder" : "file",
        size: stats.isFile() ? stats.size : 0,
        mtime: stats.isDirectory() ? 0 : mtime,
        hash
    };

    // ---------- FIX #6: Write JSON file safely ----------
    try {
        fs.writeFileSync(saveTrackerPath, JSON.stringify(tracker, null, 4));
        console.log(`✅ Tracker updated → ${key}`);
    } catch (err) {
        console.error(`❌ Failed to write tracker JSON: ${err.message}`);
    }
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

function normalizeKeytodoubleslash(key) {
    // Convert all / or \ into double backslash \\
    return key.replace(/[\/]+/g, "\\");
}

async function removeFromTracker(cleanLocation) {
    const saveTrackerPath = path.join(app.getPath("userData"), "sync-tracker.json");

    let tracker = {};
    try {
        tracker = JSON.parse(fs.readFileSync(saveTrackerPath, "utf8"));
    } catch (err) {
        return;
    }

    // Convert cleanLocation to tracker-style:  folder\\subfolder\\file
    const key = normalizeKeytodoubleslash(cleanLocation);

    // 🔥 Normalize all existing tracker keys
    const normalizedTracker = {};
    for (const oldKey in tracker) {
        const newKey = normalizeKeytodoubleslash(oldKey);   // fixes keys with / or single \
        normalizedTracker[newKey] = tracker[oldKey];
    }

    tracker = normalizedTracker;

    // 🔥 Delete key if it exists
    if (tracker[key]) {
        delete tracker[key];
        console.log("🗑 Removed tracker entry:", key);
    } else {
        console.warn("⚠ Tracker entry not found:", key);
    }

    // Save updated tracker
    fs.writeFileSync(saveTrackerPath, JSON.stringify(tracker, null, 4));
}





function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

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
    const mappedDrivePath = `${drive_letter}/${centrisFolder}/`.replace(/\\/g, "/");

    // Load old tracker
    const previousSnapshot = loadTracker();

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
    const deleteFrom = 'Centris Drive';

    // ------------------------------------------------------------
    // DIFF (NO MORE strip AGAIN — FIX)
    // ------------------------------------------------------------
    let changedItems = findNewOrChangedFiles(currentSnapshot, normalizedPrevious);
    //let deletedItems = Object.keys(previousSnapshot).filter(p => !currentSnapshot[p]);
    let deletedItems = Object.keys(normalizedPrevious).filter(p => !currentSnapshot[p]);

    changedItems = changedItems.filter(Boolean);
    deletedItems = deletedItems.filter(Boolean);

     // Downloaded
    
    await deleteLocalFilesLogic(event,args);
    //return true;
    await downloadPendingFilesLogic(event,args);
    
    if (changedItems.length === 0 && deletedItems.length === 0) {
      return { success: true, message: "No  changes in " + deleteFrom +" to Upload." };
    }

    
    //return;
    // ------------------------------------------------------------
    // UPLOAD CHANGED FILES
    // ------------------------------------------------------------
    if (changedItems.length > 0) {
      const uploadChunks = chunkArray(changedItems, 50);

      event.sender.send("upload-progress-start", { total: changedItems.length });

      let processed = 0;

      for (const chunkPaths of uploadChunks) {

        const payloadItems = await Promise.all(
          chunkPaths.map(async relPath => {
            // *** STOP REMOVING PREFIX AGAIN ***
            const cleanPath = relPath;

            const fullLocalPath = path
              .join(mappedDrivePath, cleanPath)
              .replace(/\\/g, "/");

            const type = getFileType(fullLocalPath);

            let is_dir = type === "dir";
            let content = null;

            if (type === "file") {
              content = await fs.promises.readFile(fullLocalPath, "base64");
            }

            return {
              path: cleanPath,
              is_dir,
              content,
              size: currentSnapshot[cleanPath]?.size || 0,
              mtime: currentSnapshot[cleanPath]?.mtime || 0
            };
          })
        );

        await fetch(`${apiUrl}/api/syncChangedItems`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_id,
            domain_id,
            user_id,
            changed_items: payloadItems
          })
        });

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

        await fetch(`${apiUrl}/api/deleteSyncedItems`, {
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

        processed += chunk.length;

        event.sender.send("delete-progress", {
          done: processed,
          total: deletedItems.length,
          file : chunk?.[chunk.length - 1] ?? null,
          source:deleteFrom
        });
      }

      event.sender.send("delete-progress-complete", {
            source: deleteFrom === "Centris One" ? "Centris One" : "Centris Drive"
        });
      setTimeout(() => event.sender.send("delete-progress-hide"), 6000);
    }

    // SAVE TRACKER
    saveTracker(currentSnapshot);

    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.send("sync-status", "Auto sync complete.");

    return { success: true, message: "Sync completed successfully" };

  } catch (err) {
    console.error("AUTO-SYNC ERROR:", err);
    return { success: false, message: err.message };
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

ipcMain.handle('auto-sync-final', async (event, args) => {
  const { customer_id, domain_id, apiUrl, syncData } = args;

  // helper: normalize keys used inside the snapshot (no drive letter, forward slashes)
  const normalizeKey = (p) => {
    if (!p) return p;
    // remove drive letter like "E:\" or "E:/" or "E:"
    p = p.replace(/^[A-Za-z]:[\\/]?/, "");
    // remove leading slashes/backslashes
    p = p.replace(/^[\\/]+/, "");
    // unify to forward slashes
    return p.replace(/\\/g, "/");
  };

  // helper: save a chunk of keys into persistent tracker efficiently if helpers exist
  const persistAddChunk = (keys, sourceSnapshot, previousSnapshot) => {
    // If you have saveTrackerChunk implementation (from earlier code), use it for better perf.
    // Otherwise, fall back to saveTracker(previousSnapshot) after merge.
    if (typeof saveTrackerChunk === "function") {
      // build object of only these keys and values from sourceSnapshot
      const obj = {};
      keys.forEach(k => {
        if (sourceSnapshot[k] !== undefined) obj[k] = sourceSnapshot[k];
      });
      try { saveTrackerChunk(obj); } catch (e) {
        // fallback
        Object.assign(previousSnapshot, obj);
        saveTracker(previousSnapshot);
      }
    } else {
      // merge and save full snapshot
      keys.forEach(k => {
        if (sourceSnapshot[k] !== undefined) previousSnapshot[k] = sourceSnapshot[k];
      });
      saveTracker(previousSnapshot);
    }
  };

  // helper: remove a chunk of keys from persistent tracker
  const persistRemoveChunk = (keys, previousSnapshot) => {
    if (typeof removeDeletedChunk === "function") {
      try {
        removeDeletedChunk(keys);
      } catch (e) {
        // fallback
        keys.forEach(k => delete previousSnapshot[k]);
        saveTracker(previousSnapshot);
      }
    } else {
      keys.forEach(k => delete previousSnapshot[k]);
      saveTracker(previousSnapshot);
    }
  };

  try {
    const drive_letter = getMappedDriveLetter(); // e.g. "E:" or "E:\"
    const mappedDrivePath = drive_letter + '\\' + syncData.config_data.centris_drive + '\\';

    // load persistent tracker (previously synced state)
    let previousSnapshot = loadTracker() || {};
    console.log('loadTracker keys:', Object.keys(previousSnapshot).length);

    // build current snapshot from filesystem
    console.log('scanning directory for current snapshot...');
    const currentSnapshot = await getDirectorySnapshot(mappedDrivePath, previousSnapshot);
    console.log('currentSnapshot keys:', Object.keys(currentSnapshot).length);

    const user_id = syncData.user_data.id;

    // normalize snapshot keys for consistent comparison (no drive letter, forward slashes)
    const normPrevKeys = Object.keys(previousSnapshot).reduce((acc, k) => {
      acc[normalizeKey(k)] = previousSnapshot[k];
      return acc;
    }, {});
    const normCurrKeys = Object.keys(currentSnapshot).reduce((acc, k) => {
      acc[normalizeKey(k)] = currentSnapshot[k];
      return acc;
    }, {});

    // Rebuild snapshots in normalized-key form for this run
    previousSnapshot = normPrevKeys;
    // We want currentSnapshotNormalized to contain actual metadata from original currentSnapshot
    const currentSnapshotNormalized = {};
    Object.keys(currentSnapshot).forEach(k => {
      currentSnapshotNormalized[normalizeKey(k)] = currentSnapshot[k];
    });

    // Determine changed (present in current but new or changed vs previous)
    const changedItems = findNewOrChangedFiles(currentSnapshotNormalized, previousSnapshot)
      .map(f => f.replace(/\\/g, "/"));

    // Determine deleted (present in previous but missing in current)
    const deletedItems = Object.keys(previousSnapshot)
      .filter(old => !currentSnapshotNormalized[old])
      .map(f => f.replace(/\\/g, "/"));

    // Add drive letter back for API upload if server expects full path
    const addDriveIfNeeded = (key) => {
      // If addDriveLetter function exists and used previously, use it; else prefix
      if (typeof addDriveLetter === "function") return addDriveLetter(drive_letter, key);
      // ensure drive_letter ends with colon (E:) and slash
      let dl = drive_letter;
      if (!dl.endsWith(":")) dl = dl.replace(/[\\/]+$/,"");
      // produce something like "E:/path/to/file"
      return `${dl}/${key}`.replace(/\\/g, "/");
    };

    const changedItemsWithDrive = changedItems.map(f => addDriveIfNeeded(f));
    const deletedItemsWithDrive = deletedItems.map(f => addDriveIfNeeded(f));

    console.log('changed count:', changedItems.length, 'deleted count:', deletedItems.length);

    if (changedItems.length === 0 && deletedItems.length === 0) {
      return { success: true, message: "No changes" };
    }

    // ---------------------------------------------------
    // UPLOAD CHANGED FILES (chunked) - persist previousSnapshot after each successful chunk
    // ---------------------------------------------------
    if (changedItemsWithDrive.length > 0) {
      event.sender.send("upload-progress-start", { total: changedItemsWithDrive.length });

      let processed = 0;
      const uploadChunks = chunkArray(changedItemsWithDrive, 200); // chunk size configurable

      for (const chunkWithDrive of uploadChunks) {
        // convert chunkWithDrive to normalized keys used in snapshot (remove drive)
        const chunkKeys = chunkWithDrive.map(p => normalizeKey(String(p).replace(/^([A-Za-z]:)?[\\\/]?/, "")));

        try {
          const res = await fetch(`${apiUrl}/api/syncChangedItems`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customer_id,
              domain_id,
              user_id,
              root_path: mappedDrivePath,
              changed_items: chunkWithDrive,
            }),
          });

          if (!res.ok) {
            // server returned error -> stop and return partial state (previousSnapshot remains persisted up to last chunk)
            const text = await res.text().catch(() => null);
            console.error('syncChangedItems failed', res.status, text);
            return { success: false, message: `Upload chunk failed: ${res.status}` };
          }

          // ✅ On success: merge only these chunkKeys from currentSnapshotNormalized -> previousSnapshot
          persistAddChunk(chunkKeys, currentSnapshotNormalized, previousSnapshot);

          processed += chunkKeys.length;
          event.sender.send("upload-progress", {
            done: processed,
            total: changedItemsWithDrive.length,
            file: chunkWithDrive?.[chunkWithDrive.length - 1] ?? null,
          });

        } catch (err) {
          console.error('fetch error while uploading changed chunk', err);
          return { success: false, message: `Network/upload error: ${err.message}` };
        }

        // small throttle so server isn't hammered; adjust/remove as needed
        await new Promise(r => setTimeout(r, 300));
      }

      event.sender.send("upload-progress-complete");
      setTimeout(() => event.sender.send("upload-progress-hide"), 6000);
    }

    // ---------------------------------------------------
    // DELETE REMOTE FILES (chunked) - persist removal after each successful chunk
    // ---------------------------------------------------
    if (deletedItemsWithDrive.length > 0) {
      event.sender.send("delete-progress-start", { total: deletedItemsWithDrive.length });

      let processed = 0;
      const deleteChunks = chunkArray(deletedItemsWithDrive, 200);

      for (const chunkWithDrive of deleteChunks) {
        const chunkKeys = chunkWithDrive.map(p => normalizeKey(String(p).replace(/^([A-Za-z]:)?[\\\/]?/, "")));

        try {
          const res = await fetch(`${apiUrl}/api/deleteSyncedItems`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customer_id,
              domain_id,
              user_id,
              root_path: mappedDrivePath,
              deleted_items: chunkWithDrive,
            }),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => null);
            console.error('deleteSyncedItems failed', res.status, text);
            return { success: false, message: `Delete chunk failed: ${res.status}` };
          }

          // ✅ On success: remove these keys from previousSnapshot and persist
          persistRemoveChunk(chunkKeys, previousSnapshot);

          processed += chunkKeys.length;
          event.sender.send("delete-progress", {
            done: processed,
            total: deletedItemsWithDrive.length,
            file: chunkWithDrive?.[chunkWithDrive.length - 1] ?? null,
          });

        } catch (err) {
          console.error('fetch error while deleting chunk', err);
          return { success: false, message: `Network/delete error: ${err.message}` };
        }

        await new Promise(r => setTimeout(r, 300));
      }

      event.sender.send("delete-progress-complete");
      setTimeout(() => event.sender.send("delete-progress-hide"), 60000);
    }

    // Final status message
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.send('sync-status', 'Auto sync complete.');

    return { success: true, message: "Sync completed successfully" };

  } catch (error) {
    console.error('auto-sync error:', error);
    return { success: false, message: error.message || String(error) };
  }
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


ipcMain.handle('getAppConfig', async (event) => {
    const drive = getMappedDriveLetter();
    const config = {
        vhdx_name: VHDX_NAME,
        drivePath: drive + '\\' + syncData.config_data.centris_drive,
        driveCustDomPath: drive +  '\\' + syncData.config_data.centris_drive,
        userName: syncData.user_data.user_name,
        version: app.getVersion(),
        vhdx_path : VHDX_PATH
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

ipcMain.handle('save-tracker', async (event, snapshot) => {
    saveTracker(snapshot);
    return { success: true };
});

ipcMain.handle("load-tracker", () => {
    return loadTracker();
});

ipcMain.handle("create-vhdx", async () => {    
    return await vhdxService.createVHDX();
});

ipcMain.on("user:logout", () => {
    console.log("🔒 User logged out, unmounting VHDX...");
    unmountVHDX();
    killLeftoverProcesses();
    app.quit();
});

ipcMain.handle("open-external-file", async (_, filePath) => {
    await shell.openPath(filePath);
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
            unmountVHDX();
        }
    } catch (e) {
        console.warn("⚠️ Failed to unmount VHDX:", e.message);
    }
}


function killLeftoverProcesses() {
    try {
        execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' });
        console.log("🧹 Leftover Electron processes killed.");
    } catch (e) {
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