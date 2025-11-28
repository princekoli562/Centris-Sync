
const { app, BrowserWindow, ipcMain,dialog, Tray, Menu } = require('electron');
//const path = require('node:path');
const path = require("path");
const fs = require('fs');
const crypto = require('crypto');

//console.log(process.env.NODE_ENV);
// if (process.env.NODE_ENV === "development") {
//   try {
//     // 👇 Detect electron binary properly (Windows-friendly)
//     let electronBinary = path.join(
//       __dirname,
//       "node_modules",
//       ".bin",
//       "electron.cmd"
//     );

//     // Fallback if .cmd doesn't exist (Linux/macOS case)
//     if (!fs.existsSync(electronBinary)) {
//       electronBinary = path.join(
//         __dirname,
//         "node_modules",
//         ".bin",
//         "electron"
//       );
//     }

//     // Load electron-reload
//     require("electron-reload")(__dirname, {
//       electron: electronBinary,
//       //hardResetMethod: "exit",
//       hardResetMethod: "reload",
//     });

//     console.log("🔁 Electron auto-reload enabled (Windows Dev Mode)");
//   } catch (err) {
//     console.warn("⚠️ Electron reload not active:", err.message);
//   }
// }
///
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

let syncData = {
  customer_data: null,
  domain_data: null,
  user_data: null,
  config_data: null,
  apiUrl: null,
};

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
    win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: true // ❗ keep false for security
        },
        icon: path.join(__dirname, 'assets/images/favicon.ico')
    });

    // ✅ Use local session checker instead of win.electronAPI
    const sessionActive = isSessionActive(); // function defined below
    console.log(sessionActive);
    if (sessionActive) {
        console.log("✅ Session active, redirecting to home...");
        await win.loadFile('home.html');
    } else {
        console.log("🔒 Session expired or not logged in");
        await win.loadFile('index.html');
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
    ipcMain.on('navigate', (event, page) => {
        if (page === 'home') {
            win.loadFile('home.html')
                .then(() => console.log('🏠 Home page loaded'))
                .catch(err => console.error('Error loading home page:', err));
        } else if (page === 'login') {
            win.loadFile('index.html')
                .then(() => console.log('🔑 Login page loaded'))
                .catch(err => console.error('Error loading login page:', err));
        } else {
            console.error('Unknown page:', page);
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

    function handleSessionCheck() {
        if (!isSessionActive() && !redirectingToLogin) {
            redirectingToLogin = true; // 🔒 prevent multiple triggers
            console.log("⚠️ Session expired — redirecting to login page...");
            win.loadFile('index.html').then(() => {
            redirectingToLogin = false; // ✅ reset once done
        });
    }
}
};

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/images/favicon.png'));
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


async function getDirectorySnapshot11(dir) {
  const snapshot = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const stats = fs.statSync(fullPath);

    if (entry.isDirectory()) {
      snapshot[normalizePath(fullPath)] = {
        type: "folder",
        mtime: stats.mtimeMs,
      };
      Object.assign(snapshot, await getDirectorySnapshot(fullPath));
    } else {
      const hash = await hashFile(fullPath);
      snapshot[normalizePath(fullPath)] = {
        type: "file",
        size: stats.size,
        mtime: stats.mtimeMs,
        hash,
      };
    }
  }

  return snapshot;
}


async function getDirectorySnapshot(dir, oldSnap = {}) {
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

            Object.assign(snapshot, await getDirectorySnapshot(fullPath, oldSnap));
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



function saveTracker_1(snapshot) {
    const trackerPath = path.join(app.getPath('userData'), 'sync-tracker.json');
    fs.writeFileSync(trackerPath, JSON.stringify(snapshot, null, 2));
}

function saveTracker(data) {
    try {
        fs.writeFileSync(trackerPath, JSON.stringify(data), { encoding: "utf-8" });
        fs.fsyncSync(fs.openSync(trackerPath, "r+")); // forces flush
    } catch (e) {
        console.error("Error saving tracker:", e);
    }
}

function findNewOrChangedFilesOLd(current, previous) {
    const changed = [];

    for (const file in current) {
        const norm = normalizePath(file);

        const prevItem = previous[norm];
        const currItem = current[file];

        if (!prevItem ||
            prevItem.mtime !== currItem.mtime ||
            prevItem.hash !== currItem.hash) 
        {
            changed.push(norm);
        }
    }

    return changed;
}

function findNewOrChangedFiles(current, previous) {
    const changed = [];

    for (const file in current) {
        const key = normalizePath(file);

        const curr = current[key];
        const prev = previous[key];

        // NEW file/directory
        if (!prev) {
            changed.push(key);
            continue;
        }

        // DIRECTORY: check only mtime
        if (curr.type === "folder") {
            if (curr.mtime !== prev.mtime) {
                changed.push(key);
            }
            continue;
        }

        // FILE: check mtime first (fast)
        if (curr.mtime !== prev.mtime) {
            changed.push(key);
            continue;
        }

        // Rare case: same mtime but different hash (timestamp preserved)
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

async function autoSync_wrong({ customer_id, domain_id, apiUrl, syncData }) {

    // Show progress UI
    const progressContainer = document.getElementById('syncProgressContainer');
    const progressBar = document.getElementById('syncProgressBar');
    const progressLabel = document.getElementById('syncProgressLabel');
    progressContainer.style.display = 'block';
    progressBar.value = 0;
    progressLabel.textContent = 'Syncing... 0%';

    return new Promise((resolve, reject) => {
        // Listen for progress updates from main
        window.electronAPI.onSyncProgress((_event, data) => {
            const { done, total } = data;
            const percent = Math.round((done / total) * 100);

            progressBar.value = percent;
            progressLabel.textContent = `Syncing... ${percent}% (${done}/${total})`;

            if (percent >= 100) {
                progressLabel.textContent = '✅ Sync complete!';
            }
        });

        // Listen for final status message
        window.electronAPI.onSyncStatus((_event, statusMsg) => {
            console.log("📦 Sync status:", statusMsg);
        });

        // Call main process to start sync
        window.electronAPI.autoSync({
            customer_id,
            domain_id,
            apiUrl,
            syncData,
        })
        .then(result => {
            console.log("✅ Sync finished:", result);
            progressLabel.textContent = '✅ Sync completed!';
            resolve(result);
        })
        .catch(err => {
            console.error("❌ Auto sync error:", err);
            progressLabel.textContent = '❌ Sync failed!';
            reject(err);
        });
    });
}

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
    const iconPath = path.join(__dirname, 'assets', 'images', 'favicon.ico');

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
    const SYNC_FOLDER = path.join(homeDir, 'CentrisSync');

    // 1️⃣ Create folder if missing
    if (!fs.existsSync(SYNC_FOLDER)) {
        fs.mkdirSync(SYNC_FOLDER, { recursive: true });
        console.log('📁 Folder created at:', SYNC_FOLDER);
    } else {
        console.log('📁 Folder already exists:', SYNC_FOLDER);
    }

    // 2️⃣ Optional custom icon
    try {
        const iconPath = path.join(__dirname, 'assets', 'images', 'favicon.ico');
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

    // 🧩 Find drive letter (most recent one assigned)
    const output = execSync(
        'wmic logicaldisk get name, volumename'
    ).toString();

    const match = output.match(/([A-Z]):\s+Centris-Drive/);
    if (match) {
        const driveLetter = match[1];
        console.log(`🔤 Mounted as ${driveLetter}:\\`);

        // Path to your custom icon
        const iconPath = path.join(__dirname, "assets", "images", "favicon.ico");

        // Apply the drive icon
        applyDriveIcon(driveLetter, iconPath);
    } else {
        console.warn("⚠️ Could not detect mounted drive letter.");
    }
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

// Handle folder picker
// ipcMain.handle('dialog:openFolder', async () => {
// 	const result = await dialog.showOpenDialog(win, {
// 		properties: ['openDirectory']
// 	});
// 	return result.canceled ? null : result.filePaths[0];
// });

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

ipcMain.handle("scanFolder", async (event, folderPath) => {
    const files = [];

    function readRecursive(dir) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const full = path.join(dir, item);
            if (fs.lstatSync(full).isDirectory()) {
                readRecursive(full);
            } else {
                files.push(full);
            }
        }
    }

    readRecursive(folderPath);

    return { success: true, files };
});

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

// ipcMain.handle('auto-sync-1', async (event, args) => {
//   const { customer_id, domain_id, apiUrl, syncData } = args;
//   console.log("Auto sync triggered...");

//   try {
    
//     const drive_letter =  getMappedDriveLetter();

//     const CustomerDomainUserDrivePath =
//       drive_letter + '\\' +
//       syncData.config_data.centris_drive + '\\' +
//       syncData.customer_data.customer_name + '\\' +
//       syncData.domain_data.domain_name + '\\' + syncData.user_data.user_name + '\\';

//     const mappedDrivePath = drive_letter + '\\' + syncData.config_data.centris_drive + '\\';
//     console.log('AAAA');
//     const previousSnapshot = loadTracker();
//      console.log('BBBB');
//     const currentSnapshot = await getDirectorySnapshot(mappedDrivePath,previousSnapshot);
//     console.log('CCCC');
//     const user_id = syncData.user_data.id;

//     //const changedItems = findNewOrChangedFiles(currentSnapshot, previousSnapshot)
//     //  .map(file => path.relative(mappedDrivePath, file).replace(/\\/g, '/'));

//     const changedItems = findNewOrChangedFiles(currentSnapshot, previousSnapshot)
//     .map(file => file.replace(/\\/g, '/'));
//     console.log('DDDD');

//     // 🔹 Find deleted files/folders
//     // const deletedItems = Object.keys(previousSnapshot).filter(
//     //   oldPath => !currentSnapshot[oldPath]
//     // ).map(file => path.relative(mappedDrivePath, file).replace(/\\/g, '/'));

//     const deletedItems = Object.keys(previousSnapshot).filter(
//       oldPath => !currentSnapshot[oldPath]
//     ).map(file => file.replace(/\\/g, '/'));
//       console.log('EEEE');

//     if (changedItems.length === 0 && deletedItems.length === 0) {
//       console.log("✅ No new, modified, or deleted files found to sync.");
//       return { success: true, message: "No changes" };
//     }

//     const changedItemsWithDrive = changedItems.map(
//         file => addDriveLetter(drive_letter, file)
//     );

//     const deletedItemsWithDrive = deletedItems.map(
//         file => addDriveLetter(drive_letter, file)
//     );

//     console.log(`🔄 Found ${changedItemsWithDrive.length} changed and ${deletedItemsWithDrive.length} deleted items.`);

//     console.log(changedItemsWithDrive);

//     // 🔹 Sync changed/new files
//     if (changedItemsWithDrive.length > 0) {
//       let processed = 0;
//       const chunkSize = 50;

//       for (let i = 0; i < changedItemsWithDrive.length; i += chunkSize) {
//         const chunk = changedItemsWithDrive.slice(i, i + chunkSize);
//         try {
//           const res = await fetch(`${apiUrl}/api/syncChangedItems`, {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: JSON.stringify({
//               customer_id,
//               domain_id,
//               user_id,
//               root_path: mappedDrivePath,
//               changed_items: chunk,
//             }),
//           });

//           await res.json();
//           processed += chunk.length;

//           event.sender.send('sync-progress', {
//             done: processed,
//             total: changedItemsWithDrive.length,
//             file: chunk?.[chunk.length - 1] || null,
//           });

//           console.log(`✅ Synced batch (${processed}/${changedItemsWithDrive.length})`);
//         } catch (err) {
//           console.error(`❌ Error syncing batch:`, err);
//         }

//         await new Promise(resolve => setTimeout(resolve, 300));
//       }
//     }

//     // 🔹 Handle deleted files/folders
//     // if (deletedItemsWithDrive.length > 0) {
//     //   try {
//     //     console.log(`🗑️ Deleting ${deletedItemsWithDrive.length} items from server...`);
//     //     await fetch(`${apiUrl}/api/deleteSyncedItems`, {
//     //       method: "POST",
//     //       headers: { "Content-Type": "application/json" },
//     //       body: JSON.stringify({
//     //         customer_id,
//     //         domain_id,
//     //         user_id,
//     //         root_path: mappedDrivePath,
//     //         deleted_items: deletedItemsWithDrive,
//     //       }),
//     //     });
//     //   } catch (err) {
//     //     console.error("❌ Error deleting items on server:", err);
//     //   }
//     // }

//     if (deletedItemsWithDrive.length > 0) {
//         let processed = 0;
//         const chunkSize = 50;

//         console.log(`🗑️ Deleting ${deletedItemsWithDrive.length} items from server...`);

//         for (let i = 0; i < deletedItemsWithDrive.length; i += chunkSize) {
//             const chunk = deletedItemsWithDrive.slice(i, i + chunkSize);

//             try {
//                 const res = await fetch(`${apiUrl}/api/deleteSyncedItems`, {
//                     method: "POST",
//                     headers: { "Content-Type": "application/json" },
//                     body: JSON.stringify({
//                     customer_id,
//                     domain_id,
//                     user_id,
//                     root_path: mappedDrivePath,
//                     deleted_items: chunk,
//                     }),
//                 });

//                 await res.json();
//                 processed += chunk.length;

//                 // Send progress for UI
//                 event.sender.send('delete-progress', {
//                     done: processed,
//                     total: deletedItemsWithDrive.length,
//                     file: chunk?.[chunk.length - 1] || null,
//                 });

//                 console.log(`🗑️ Deleted batch (${processed}/${deletedItemsWithDrive.length})`);
//             } catch (err) {
//                 console.error(`❌ Error deleting batch:`, err);
//             }

//             // small delay to avoid server load
//             await new Promise(resolve => setTimeout(resolve, 300));
//         }
//     }

//     // ✅ Save latest snapshot
//     removeDeleted(previousSnapshot, currentSnapshot);
//     saveTracker(currentSnapshot);

//     const win = BrowserWindow.getFocusedWindow();
//     if (win) win.webContents.send('sync-status', 'Auto sync complete.');

//     return { success: true, message: "Sync completed successfully" };

//   } catch (error) {
//     console.error("Auto sync failed:", error);
//     return { success: false, message: error.message };
//   }
// });

ipcMain.handle('auto-sync-1', async (event, args) => {
  const { customer_id, domain_id, apiUrl, syncData } = args;

  try {
    const drive_letter = getMappedDriveLetter();

    const mappedDrivePath = drive_letter + '\\' + syncData.config_data.centris_drive + '\\';
    console.log('AAAA');
    const previousSnapshot = loadTracker();
    const currentSnapshot = await getDirectorySnapshot(mappedDrivePath, previousSnapshot);

    const user_id = syncData.user_data.id;
    console.log('BBBB');

    const changedItems = findNewOrChangedFiles(currentSnapshot, previousSnapshot)
      .map(file => file.replace(/\\/g, '/'));

      console.log('CCCC');

    const deletedItems = Object.keys(previousSnapshot)
      .filter(oldPath => !currentSnapshot[oldPath])
      .map(file => file.replace(/\\/g, '/'));

    const changedItemsWithDrive = changedItems.map(
      file => addDriveLetter(drive_letter, file)
    );
    console.log('DDDD');

    const deletedItemsWithDrive = deletedItems.map(
      file => addDriveLetter(drive_letter, file)
    );

    console.log('EEEE');

    if (changedItems.length === 0 && deletedItems.length === 0) {
      console.log("✅ No new, modified, or deleted files found to sync.");
      return { success: true, message: "No changes" };
    }

    console.log(`🔄 Found ${changedItemsWithDrive.length} changed and ${deletedItemsWithDrive.length} deleted items.`);

    // -----------------------------------------------
    // 🚀 NEW UPLOADS PROGRESS BAR STARTS HERE
    // -----------------------------------------------
    
    console.log(changedItemsWithDrive);
    if (changedItemsWithDrive.length > 0) {
        event.sender.send("upload-progress-start", {
            total: changedItemsWithDrive.length
        });
        let processed = 0;
        const chunkSize = 200;

        for (let i = 0; i < changedItemsWithDrive.length; i += chunkSize) {
            const chunk = changedItemsWithDrive.slice(i, i + chunkSize);

            try {
            const res = await fetch(`${apiUrl}/api/syncChangedItems`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                customer_id,
                domain_id,
                user_id,
                root_path: mappedDrivePath,
                changed_items: chunk,
                }),
            });

            await res.json();
            processed += chunk.length;

            event.sender.send("upload-progress", {
                done: processed,
                total: changedItemsWithDrive.length,
                file: chunk?.[chunk.length - 1] || null,
            });

            } catch (err) {
            console.error("Error syncing batch:", err);
            }

            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // END upload progress
        event.sender.send("upload-progress-complete", {});
        // Auto hide UI bar after 1 minute
        setTimeout(() => {
            event.sender.send("upload-progress-hide");
        }, 6000);
    }

    if (deletedItemsWithDrive.length > 0) {
        // -----------------------------------------------
        // 🗑️ DELETE PROGRESS BAR STARTS HERE
        // -----------------------------------------------
        event.sender.send("delete-progress-start", {
            total: deletedItemsWithDrive.length
        });
        let processed = 0;
        const chunkSize = 200;

        for (let i = 0; i < deletedItemsWithDrive.length; i += chunkSize) {
            const chunk = deletedItemsWithDrive.slice(i, i + chunkSize);

            try {
            const res = await fetch(`${apiUrl}/api/deleteSyncedItems`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                customer_id,
                domain_id,
                user_id,
                root_path: mappedDrivePath,
                deleted_items: chunk,
                }),
            });

            await res.json();
            processed += chunk.length;

            event.sender.send("delete-progress", {
                done: processed,
                total: deletedItemsWithDrive.length,
                file: chunk?.[chunk.length - 1] || null,
            });

            } catch (err) {
            console.error("Error deleting batch:", err);
            }

            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // END delete progress
        event.sender.send("delete-progress-complete", {});
        setTimeout(() => {
            event.sender.send("delete-progress-hide");
        }, 60000);
    }

    // -----------------------------------------------
    // SAVE TRACKER
    // -----------------------------------------------
    removeDeleted(previousSnapshot, currentSnapshot);
    saveTracker(currentSnapshot);

    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.send('sync-status', 'Auto sync complete.');

    return { success: true, message: "Sync completed successfully" };

  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('auto-sync-2', async (event, args) => {
  const { customer_id, domain_id, apiUrl, syncData } = args;

  try {
        const drive_letter = getMappedDriveLetter();
        const mappedDrivePath = drive_letter + '\\' + syncData.config_data.centris_drive + '\\';

        const previousSnapshot = loadTracker();
        const currentSnapshot = await getDirectorySnapshot(mappedDrivePath, previousSnapshot);

        const user_id = syncData.user_data.id;

        const changedItems = findNewOrChangedFiles(currentSnapshot, previousSnapshot)
        .map(f => f.replace(/\\/g, "/"));

        const deletedItems = Object.keys(previousSnapshot)
        .filter(old => !currentSnapshot[old])
        .map(f => f.replace(/\\/g, "/"));

        const changedItemsWithDrive = changedItems.map(f => addDriveLetter(drive_letter, f));
        const deletedItemsWithDrive = deletedItems.map(f => addDriveLetter(drive_letter, f));

        if (changedItems.length === 0 && deletedItems.length === 0) {
        return { success: true, message: "No changes" };
        }

        // -------------------------------------
        // 📤 CHANGED FILES UPLOAD (chunked)
        // -------------------------------------
        if (changedItemsWithDrive.length > 0) {
        event.sender.send("upload-progress-start", {
            total: changedItemsWithDrive.length
        });

        let processed = 0;
        const uploadChunks = chunkArray(changedItemsWithDrive, 200);

        for (const chunk of uploadChunks) {
            await fetch(`${apiUrl}/api/syncChangedItems`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                customer_id,
                domain_id,
                user_id,
                root_path: mappedDrivePath,
                changed_items: chunk,
            }),
            });

            processed += chunk.length;

            event.sender.send("upload-progress", {
            done: processed,
            total: changedItemsWithDrive.length,
            file: chunk?.[chunk.length - 1] ?? null,
            });

            await new Promise(r => setTimeout(r, 300));
        }

        event.sender.send("upload-progress-complete");
        setTimeout(() => event.sender.send("upload-progress-hide"), 6000);
        }

        // -------------------------------------
        // 🗑️ DELETED FILES SYNC (chunked)
        // -------------------------------------
        if (deletedItemsWithDrive.length > 0) {
        event.sender.send("delete-progress-start", {
            total: deletedItemsWithDrive.length
        });

        let processed = 0;
        const deleteChunks = chunkArray(deletedItemsWithDrive, 200);

        for (const chunk of deleteChunks) {
            await fetch(`${apiUrl}/api/deleteSyncedItems`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                customer_id,
                domain_id,
                user_id,
                root_path: mappedDrivePath,
                deleted_items: chunk,
            }),
            });

            processed += chunk.length;

            event.sender.send("delete-progress", {
            done: processed,
            total: deletedItemsWithDrive.length,
            file: chunk?.[chunk.length - 1] ?? null,
            });

            await new Promise(r => setTimeout(r, 300));
        }

        event.sender.send("delete-progress-complete");
        setTimeout(() => event.sender.send("delete-progress-hide"), 60000);
        }

        // ---------------------------------------------------
        // 🧩 CHUNKED SNAPSHOT SAVE (new/modified items)
        // ---------------------------------------------------
        const snapshotChunks = chunkArray(Object.entries(currentSnapshot), 2000);

        for (const chunk of snapshotChunks) {
        const obj = Object.fromEntries(chunk);
        saveTrackerChunk(obj);
        }

        // ---------------------------------------------------
        // 🗑️ CHUNK DELETE FROM SNAPSHOT
        // ---------------------------------------------------
        const deleteSnapChunks = chunkArray(deletedItems, 2000);

        for (const chunk of deleteSnapChunks) {
        removeDeletedChunk(chunk);
        }

        // FINAL MERGE & SAVE
        saveTracker(loadTracker());

        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.send('sync-status', 'Auto sync complete.');

        return { success: true, message: "Sync completed successfully" };

    } catch (error) {
        return { success: false, message: error.message };
    }
});

ipcMain.handle('auto-sync-3', async (event, args) => {
  const { customer_id, domain_id, apiUrl, syncData } = args;

  try {
    const drive_letter = getMappedDriveLetter();
    const mappedDrivePath = drive_letter + '\\' + syncData.config_data.centris_drive + '\\';

    const previousSnapshot = loadTracker();
    console.log('AAAA');
    const currentSnapshot = await getDirectorySnapshot(mappedDrivePath, previousSnapshot);
    console.log('BBBB');
    const user_id = syncData.user_data.id;

    const changedItems = findNewOrChangedFiles(currentSnapshot, previousSnapshot)
      .map(f => f.replace(/\\/g, "/"));

    console.log('CCCC');

    const deletedItems = Object.keys(previousSnapshot)
      .filter(old => !currentSnapshot[old])
      .map(f => f.replace(/\\/g, "/"));

    const changedItemsWithDrive = changedItems.map(f => addDriveLetter(drive_letter, f));
    const deletedItemsWithDrive = deletedItems.map(f => addDriveLetter(drive_letter, f));

    console.log('DDDD');

    if (changedItems.length === 0 && deletedItems.length === 0) {
      return { success: true, message: "No changes" };
    }

    console.log('EEEE');

    // -------------------------------------
    // 📤 CHANGED FILES UPLOAD (chunked)
    // -------------------------------------
    if (changedItemsWithDrive.length > 0) {
      event.sender.send("upload-progress-start", {
        total: changedItemsWithDrive.length
      });

      let processed = 0;
      const uploadChunks = chunkArray(changedItemsWithDrive, 200);

      for (const chunk of uploadChunks) {
        await fetch(`${apiUrl}/api/syncChangedItems`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_id,
            domain_id,
            user_id,
            root_path: mappedDrivePath,
            changed_items: chunk,
          }),
        });

        // 🔥 Update snapshot immediately
        chunk.forEach(item => {
          const cleanPath = item.replace(`${drive_letter}/`, "").replace(/\\/g, "/");
          currentSnapshot[cleanPath] = { mtime: Date.now() };
        });

        saveTracker(currentSnapshot); // 🔥 Save after each chunk

        processed += chunk.length;

        event.sender.send("upload-progress", {
          done: processed,
          total: changedItemsWithDrive.length,
          file: chunk?.[chunk.length - 1] ?? null,
        });

        await new Promise(r => setTimeout(r, 300));
      }

      event.sender.send("upload-progress-complete");
      setTimeout(() => event.sender.send("upload-progress-hide"), 6000);
    }

    // -------------------------------------
    // 🗑️ DELETED FILES SYNC (chunked)
    // -------------------------------------
    if (deletedItemsWithDrive.length > 0) {
      event.sender.send("delete-progress-start", {
        total: deletedItemsWithDrive.length
      });

      let processed = 0;
      const deleteChunks = chunkArray(deletedItemsWithDrive, 200);

      for (const chunk of deleteChunks) {
        await fetch(`${apiUrl}/api/deleteSyncedItems`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_id,
            domain_id,
            user_id,
            root_path: mappedDrivePath,
            deleted_items: chunk,
          }),
        });

        // 🔥 Remove from snapshot immediately
        chunk.forEach(item => {
          const cleanPath = item.replace(`${drive_letter}/`, "").replace(/\\/g, "/");
          delete currentSnapshot[cleanPath];
        });

        saveTracker(currentSnapshot); // 🔥 Save after each chunk

        processed += chunk.length;

        event.sender.send("delete-progress", {
          done: processed,
          total: deletedItemsWithDrive.length,
          file: chunk?.[chunk.length - 1] ?? null,
        });

        await new Promise(r => setTimeout(r, 300));
      }

      event.sender.send("delete-progress-complete");
      setTimeout(() => event.sender.send("delete-progress-hide"), 60000);
    }

    // -------------------------------------
    // Snapshot is already updated inside loops
    // No final saveTracker() needed
    // -------------------------------------

    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.send('sync-status', 'Auto sync complete.');

    return { success: true, message: "Sync completed successfully" };

  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('auto-sync', async (event, args) => {
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



function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

function saveTrackerChunk_1(snapshotChunk) {
  try {
    const tracker = loadTracker() || {};

    for (const [key, value] of Object.entries(snapshotChunk)) {
      tracker[key] = value;
    }

    saveTracker(tracker);
    return true;

  } catch (err) {
    console.error("Error saving snapshot chunk:", err);
    return false;
  }
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

function removeDeletedChunk_1(deletedPaths) {
  try {
    const tracker = loadTracker() || {};

    for (const d of deletedPaths) {
      delete tracker[d];
    }

    saveTracker(tracker);
    return true;

  } catch (err) {
    console.error("Error deleting snapshot chunk:", err);
    return false;
  }
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
ipcMain.handle('fs:listFiles', async (event, dirPath) => {
	if (!fs.existsSync(dirPath)) return [];
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
ipcMain.handle('fs:listFilesRecursively', async (event, dir) => {
	async function listFilesRecursively(dir) {
	  let results = [];
	  const items = fs.readdirSync(dir, { withFileTypes: true });
	  for (let item of items) {
			const fullPath = path.join(dir, item.name);
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
ipcMain.handle('fs:list-recur-files', async (event, dirPath = null, offset = 0, limit = 1000) => {
    try {
        const basePath = dirPath || 'E:\\';
        const entries = fs.readdirSync(basePath, { withFileTypes: true });

        // Filter hidden files
        const visibleEntries = entries.filter(entry => {
            const fullPath = path.join(basePath, entry.name);
            return !entry.name.startsWith('.') && !isHiddenWindows(fullPath);
        });

        // Apply pagination
        const paginated = visibleEntries.slice(offset, offset + limit);

        // const items = paginated.map(entry => ({
        //     name: entry.name,
        //     path: path.join(basePath, entry.name),
        //     isDirectory: entry.isDirectory(),
        //     size: entry.isDirectory() ? "-" : formatSize(stats.size),
        //     modified_date: new Date(stats.mtime).toLocaleString(),
        //     modified_by: os.userInfo().username || "Unknown",
        //     shared: false,
        // }));

        const items = await Promise.all(
            paginated.map(async entry => {
                const fullPath = path.join(basePath, entry.name);
                const stats = await fs.promises.stat(fullPath);

                return {
                    name: entry.name,
                    path: fullPath,
                    isDirectory: entry.isDirectory(),
                    size: entry.isDirectory() ? "-" : formatSize(stats.size),
                    modified_date: new Date(stats.mtime).toLocaleString(),
                    modified_by: os.userInfo().username || "Unknown",
                    shared: false,
                };
            })
        );

        return {
            currentPath: basePath,
            items,
            total: visibleEntries.length,
            hasMore: offset + limit < visibleEntries.length
        };
        

    } catch (err) {
        console.error('Error reading directory:', err);
        return { error: err.message };
    }
});


// Open folder via dialog and return folder path
ipcMain.handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
});

// ipcMain.handle('dialog:openFolders', async () => {
//   let folders = [];

//   while (true) {
//     const res = await dialog.showOpenDialog({
//       title: 'Select a Folder (Cancel when done)',
//       properties: ['openDirectory','multiSelections']
//     });

//     if (res.canceled || res.filePaths.length === 0) break;

//     folders.push(res.filePaths[0]);
//   }

//   return folders.length > 0 ? folders : null;
// });

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

process.on('exit', () => {
    try { 
      // clearSession();
      //  unmountVHDX(); 
        console.log('💾 VHDX unmounted on exit.');
    } catch (e) {
        console.warn('⚠️ Failed to unmount VHDX on exit:', e.message);
    }
});


app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
    
});