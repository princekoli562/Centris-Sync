const { contextBridge, ipcRenderer, webFrame } = require('electron');
const isDev = process.argv.includes('--is-dev=true');

if (!isDev) {
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
    console.warn = () => {};
    try {
        webFrame.executeJavaScript('if (typeof console !== "undefined") { console.log = () => {}; console.info = () => {}; console.debug = () => {}; console.warn = () => {}; }');
    } catch { }
}

contextBridge.exposeInMainWorld('electronAPI', {
    isDev: isDev,
    //chooseFolder: async () => await ipcRenderer.invoke('dialog:openFolder'),
    getSecretKey: () => ipcRenderer.invoke('get-secret-key'),
    getSavedSecretKey: () => ipcRenderer.invoke('get-saved-secret-key'),
    saveSavedSecretKey: (secretKey) => ipcRenderer.invoke('save-saved-secret-key', secretKey),
    deleteSavedSecretKey: () => ipcRenderer.invoke('delete-saved-secret-key'),
    getApiUrl: () => ipcRenderer.invoke('get-api-url'),
    getAppConfig: () => ipcRenderer.invoke('getAppConfig'),
    //listFiles: (path) => ipcRenderer.invoke('fs:listFiles', path),
    listFiles: (dirPath) => ipcRenderer.invoke('fs:listFiles', dirPath),
    listRecurFiles: (dir, offset = 0, limit = 100) => ipcRenderer.invoke('fs:list-recur-files', dir, offset, limit),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    openFolders: () => ipcRenderer.invoke('dialog:openFolders'),
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    readDir: (folderPath) => ipcRenderer.invoke('fs:readDir', folderPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    openItem: (filePath) => ipcRenderer.invoke('shell:openItem', filePath),
    uploadFolderToDrive: (src, dest) => ipcRenderer.invoke("fs:upload-folder", src, dest),
    uploadFileToDrive: (files, targetDir) => ipcRenderer.invoke('uploadFileToDrive', files, targetDir),
    getMappedDrive: () => ipcRenderer.invoke('getMappedDrive'),
    saveSession: (data) => ipcRenderer.send('save-session', data),
    clearSession: () => ipcRenderer.send('clear-session'),
    loadSession: () => ipcRenderer.invoke('load-session'),
    listFilesRecursively: (dir) => ipcRenderer.invoke('fs:listFilesRecursively', dir),
    onMainLog: (callback) => ipcRenderer.on('main-log', (_event, message) => callback(message)),
    autoSync: (args) => ipcRenderer.invoke("auto-sync", args),
    onSyncDataUpdated: (callback) => ipcRenderer.on('sync-data-updated', (event, data) => callback(data)),
    sendSyncData: (data) => ipcRenderer.send('set-sync-data', data),
    getSyncData: () => ipcRenderer.invoke('get-sync-data'),
    //getDirectorySnapshot: (dir) => ipcRenderer.invoke("get-directory-snapshot", dir),   
    getDirectorySnapshot: (dir, oldSnapshot = {}) => ipcRenderer.invoke("get-directory-snapshot", dir, oldSnapshot),
    saveTracker: (snapshot, syncedDefault = 1) => ipcRenderer.invoke("save-tracker", { snapshot, syncedDefault }),
    loadTracker: (onlyUnsynced = true) => ipcRenderer.invoke("load-tracker", { onlyUnsynced }),
    onSyncProgress: (callback) => ipcRenderer.on('sync-progress', (event, data) => callback(data)),
    onSyncStatus: (callback) => ipcRenderer.on('sync-status', callback),
    onUploadProgressStart: (cb) => ipcRenderer.on("upload-progress-start", (_, data) => cb(data)),
    onUploadProgress: (cb) => ipcRenderer.on("upload-progress", (_, data) => cb(data)),
    onUploadComplete: (cb) => ipcRenderer.on("upload-progress-complete", cb),
    onUploadHide: (cb) => ipcRenderer.on("upload-progress-hide", cb),

    onDeleteProgressStart: (cb) => ipcRenderer.on("delete-progress-start", (_, data) => cb(data)),
    onDeleteProgress: (cb) => ipcRenderer.on("delete-progress", (_, data) => cb(data)),
    onDeleteComplete: (cb) => ipcRenderer.on("delete-progress-complete", (_event, data) => cb(data)),   // ✅ forward payload only   
    onDeleteHide: (cb) => ipcRenderer.on("delete-progress-hide", (_, data) => cb(data)),
    scanFolder: (folderPath) => ipcRenderer.invoke("scanFolder", folderPath),
    //createFolderInDrive: (sourceFolderPath, mappedDrive) => ipcRenderer.invoke('createFolderInDrive', sourceFolderPath, mappedDrive),
    createFolderInDrive: (relPath, mappedDrive) => ipcRenderer.invoke("createFolderInDrive", relPath, mappedDrive),
    createEmptyFolder: (parentDir, folderName) => ipcRenderer.invoke("createEmptyFolder", parentDir, folderName),
    focusWindow: () => ipcRenderer.invoke("focus-window"),
    getDriveProperties: (rootDir) => ipcRenderer.invoke("get-drive-properties", rootDir),
    getDriveCapacity: (rootDir) => ipcRenderer.invoke("get-drive-capacity", rootDir),
    onStorageCapacityAlert: (cb) => ipcRenderer.on("storage-capacity-alert", (_, data) => cb(data)),
    onStorageCapacityUpdate: (cb) => ipcRenderer.on("storage-capacity-update", (_, data) => cb(data)),
    getAppVersion: () => ipcRenderer.invoke("get-app-version"),
    checkForUpdates: (manual = true) => ipcRenderer.invoke("check-for-updates", manual),
    showAboutDialog: () => ipcRenderer.invoke("show-about-dialog"),
    onUpdateStatus: (cb) => ipcRenderer.on("update-status", (_, data) => cb(data)),
    onOpenAboutModal: (cb) => ipcRenderer.on("open-about-modal", () => cb()),
    // NEW: Copy file into mapped drive
    copyFileToDrive: (source, relPath, mappedDrive) => ipcRenderer.invoke("copyFileToDrive", source, relPath, mappedDrive),
    uploadChunkToDrive: (chunk, mappedDrive, sourceRoot) => ipcRenderer.invoke('uploadChunkToDrive', chunk, mappedDrive, sourceRoot),
    stopSync: () => ipcRenderer.send("stop-sync"), on: (channel, func) => ipcRenderer.on(channel, func),
    hardStop: () => ipcRenderer.send("hard-stop"),
    pathRelative: (from, to) => ipcRenderer.invoke('path:relative', from, to),
    fileStat: (filePath) => ipcRenderer.invoke("file:stat", filePath),
    //readFileBase64: (filePath) => ipcRenderer.invoke("file:read-base64", filePath)
    basename: (fullPath) => ipcRenderer.invoke("basename", fullPath),
    copyFile: (src, dest) => ipcRenderer.invoke("copy-file", src, dest),
    readFileBase64: (p) => ipcRenderer.invoke("read-base64", p),
    downloadPendingFiles: (args) => ipcRenderer.invoke("download-pending-files", args),
    onDownloadProgressStart: (fn) => ipcRenderer.on("download-progress-start", (e, d) => fn(d)),
    onDownloadProgress: (fn) => ipcRenderer.on("download-progress", (e, d) => fn(d)),
    onDownloadComplete: (cb) => ipcRenderer.on("download-complete", (event, data) => cb(data)),
    onDownloadHide: (fn) => ipcRenderer.on("download-hide", fn),
    openExternalFile: (path) => ipcRenderer.invoke("open-external-file", path),
    deleteItem: (data) => ipcRenderer.invoke("delete-item", data),
    // onFSChange: (callback) => ipcRenderer.on("fs-changed", callback),
    onFSChange: (callback) => {
        ipcRenderer.removeAllListeners("fs-changed");
        ipcRenderer.on("fs-changed", callback);
    },

    // startDriveWatcher: (syncData) => { ipcRenderer.send("start-drive-watcher", syncData)},
    // stopDriveWatcher: () => ipcRenderer.invoke("stop-drive-watcher"),
    // startServerPolling: (syncData) => { ipcRenderer.send("start-server-polling", syncData)},
    // stopServerPolling: () => ipcRenderer.invoke("stop-server-polling"),

    startDriveWatcher: (syncData) => ipcRenderer.invoke("start-drive-watcher", syncData),
    stopDriveWatcher: () => ipcRenderer.invoke("stop-drive-watcher"),
    startServerPolling: (syncData) => ipcRenderer.invoke("start-server-polling", syncData),
    stopServerPolling: () => ipcRenderer.invoke("stop-server-polling"),

    getAllPaths: (rootDir) => ipcRenderer.invoke("get-all-paths", rootDir),
    searchPaths: (query) => ipcRenderer.invoke("search-paths", query),
    getSessionUser: () => ipcRenderer.invoke("get-session-user"),
    getSyncStatus: (params) => ipcRenderer.invoke("get-sync-status", params),
    setSyncStatus: (user, enabled) => ipcRenderer.invoke("set-sync-status", user, enabled),
    onLogin: (user) => ipcRenderer.invoke("user-login-success", user),
    checkSessionAndRedirect: (autoExpireVal) => ipcRenderer.invoke("check-session-and-redirect", autoExpireVal),
    insertSettingIfNotExists: (user, key, value) => ipcRenderer.invoke("insert-setting-if-not-exists", user, key, value),
    fullLogoutCleanup: () => ipcRenderer.invoke("full-logout-cleanup"),
    getDeviceId: (syncData) => ipcRenderer.invoke("get-device-id", syncData),
    getSettingFromDB: (syncData, key, defaultValue = 0) => {
        return ipcRenderer.invoke("get-setting-from-db", {
            syncData,
            key,
            defaultValue
        });
    }
    //listFilesRecursively: async (dir) => await listFilesRecursively(dir)
});


contextBridge.exposeInMainWorld('versions', {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
    // we can also expose variables, not just functions
});

// contextBridge.exposeInMainWorld("appPaths", {
//   base: __dirname.replace(/\\/g, "/"),
// });

contextBridge.exposeInMainWorld("appPaths", {
    //base: path.join(__dirname, "..").replace(/\\/g, "/"),
    getBase: () => ipcRenderer.invoke("get-base-path"),
    relative: (from, to) => ipcRenderer.invoke("path:relative", from, to)
});

contextBridge.exposeInMainWorld("vhdx", {
    create: () => ipcRenderer.invoke("create-vhdx")
});


// contextBridge.exposeInMainWorld("vhdx", {
//     create: () => ipcRenderer.invoke("vhdx:create")
// });


// expose centris keys
contextBridge.exposeInMainWorld('secureAPI', {
    getSecretKey: () => ipcRenderer.invoke('get-secret-key'),
    send: (channel, data) => {
        // Whitelist allowed channels for security
        const validChannels = ['navigate'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        } else {
            console.error('Invalid channel:', channel);
        }
    }
});