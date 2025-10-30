
const { app, BrowserWindow, ipcMain,dialog } = require('electron');
const path = require('node:path');

// ✅ Enable auto reload for all files in your project
// try {
//   require("electron-reload")(path.join(__dirname), {
//     electron: path.join(__dirname, "node_modules", ".bin", "electron"),
//     hardResetMethod: "exit",
//   });
//   console.log("🔁 Electron auto-reload enabled");
// } catch (err) {
//   console.warn("⚠️ Electron reload not active:", err.message);
// }


const fs = require('fs');
const os = require('os');
const { execSync, exec,spawn } = require('child_process');
const SECRET_KEY = "25fHeqIXYAfa";
let win;
const VHDX_NAME = "CentrisSync.vhdx";
const VHDX_SIZE_MB = 10240; // 10 GB
const VOLUME_LABEL = "CentrisSync";
const homeDir = os.homedir();
const VHDX_PATH = path.join(homeDir, VHDX_NAME);


const createWindow = () => {
	win = new BrowserWindow({
		width: 800,
		height: 600,
		webPreferences: {
      		preload: path.join(__dirname, 'preload.js'), // Ensure the correct path to preload.js
      		contextIsolation: true, // Required for contextBridge to work
            enableRemoteModule: false, // for Keep secure , it must be false
            nodeIntegration: true // for Keep secure , it must be false
    	},
		icon: path.join(__dirname, 'assets/images/favicon.ico')
	});

	win.loadFile('index.html');
    //win.loadFile(path.join(__dirname, 'index.html'));

	// Listen for navigation events from the renderer process
	ipcMain.on('navigate', (event, page) => {
	    if (page === 'home') {
	        win.loadFile('home.html') // Adjust file path as needed
	            .then(() => console.log('Page loaded successfully'))
	            .catch((err) => console.error('Error loading page:', err));
	    } else {
	        console.error('Unknown page:', page);
	    }
	});
}

function createTestFolderDocumentpath() {
    const TEST_FOLDER = path.join(app.getPath('documents'), 'CentrisSync');
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

function getMappedDriveLetter11(volumeLabel = "CentrisSync") {
    try {
        // Run Windows 'wmic' command to get drives
        const output = execSync(`wmic logicaldisk get name,volumename`).toString();

        // Example output:
        // VolumeName  Name
        // Windows     C:
        // CentrisSync F:

        const lines = output.split('\n').filter(l => l.trim());
        for (const line of lines) {
            if (line.includes(volumeLabel)) {
                const parts = line.trim().split(/\s+/);
                const drive = parts[parts.length - 1]; // e.g. 'F:'
                return drive + "\\"; // ensure it ends with backslash
            }
        }
        return null;
    } catch (err) {
        console.error("Error detecting drive:", err);
        return null;
    }
}

function getMappedDriveLetter(volumeLabel = "CentrisSync") {
    try {
        // Get all drives with their VolumeName and Name
        const output = execSync(`wmic logicaldisk get name,volumename`, { encoding: 'utf8' });

        // Example output:
        // VolumeName  Name
        // Windows     C:
        // CentrisSync F:
        // Data        D:

        const lines = output.split('\n').map(line => line.trim()).filter(Boolean);

        for (const line of lines) {
            if (line.startsWith('VolumeName')) continue; // skip header
            const [label, drive] = line.split(/\s+/).filter(Boolean);

            // Match by label name
            if (label && label.toLowerCase() === volumeLabel.toLowerCase()) {
                return drive.endsWith(':') ? `${drive}\\` : `${drive}:\\`;
            }
        }
        console.log('kkkk');
        return null; // not found
    } catch (err) {
        console.error("Error detecting CentrisSync drive:", err);
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

    const match = output.match(/([A-Z]):\s+CentrisSync/);
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

function applyDriveIcon(driveLetter, iconPath) {
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

function unmountVHDX() {
    const homeDir = os.homedir();
    const VHDX_PATH = path.join(homeDir, "CentrisSync.vhdx");
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
	createWindow()
	//const folderPath = createSyncFolderAndDrive();
    if (!isAdmin()) {
        relaunchAsAdmin();
    } else {
        createAndMountVHDX();
    }
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
	
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

// 🔹 IPC handler to list folder contents
ipcMain.handle('fs:list-recur-files', async (event, dirPath = null, offset = 0, limit = 1000) => {
    try {
        const basePath = dirPath || 'F:\\';
        const entries = fs.readdirSync(basePath, { withFileTypes: true });

        // Filter hidden files
        const visibleEntries = entries.filter(entry => {
            const fullPath = path.join(basePath, entry.name);
            return !entry.name.startsWith('.') && !isHiddenWindows(fullPath);
        });

        // Apply pagination
        const paginated = visibleEntries.slice(offset, offset + limit);

        const items = paginated.map(entry => ({
            name: entry.name,
            path: path.join(basePath, entry.name),
            isDirectory: entry.isDirectory(),
        }));

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
    const config = {
        vhdx_name: VHDX_NAME,
        drivePath: 'F:\\CentrisSync',
        userName: 'Prince',
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

        copyRecursive(srcDir, destDir);
        return { success: true };
    } catch (err) {
        console.error("Upload error:", err);
        return { success: false, error: err.message };
    }
});


function isHiddenWindows(filePath) {
    try {
        const stats = fs.statSync(filePath, { bigint: false });
        return !!(stats.mode & 0o200000); // very rough check; better via attrib in PowerShell
    } catch {
        return false;
    }
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
        unmountVHDX(); 
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