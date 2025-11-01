const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs');
const path = require('path');

// async function listFilesRecursively(dir) {
//     let results = [];
//     const items = fs.readdirSync(dir, { withFileTypes: true });

//     for (const item of items) {
//         const fullPath = path.join(dir, item.name);
//         if (item.isDirectory()) {
//             results.push({ type: 'folder', name: item.name, path: fullPath });
//             results = results.concat(await listFilesRecursively(fullPath));
//         } else {
//             results.push({ type: 'file', name: item.name, path: fullPath });
//         }
//     }
//     return results;
// }

contextBridge.exposeInMainWorld('electronAPI', {
    //chooseFolder: async () => await ipcRenderer.invoke('dialog:openFolder'),
    getAppConfig: () => ipcRenderer.invoke('getAppConfig'),
    listFiles: (path) => ipcRenderer.invoke('fs:listFiles', path),
    //listRecurFiles: (path) => ipcRenderer.invoke('fs:list-recur-files', path),    
    listRecurFiles: (dir, offset = 0, limit = 100) => ipcRenderer.invoke('fs:list-recur-files', dir, offset, limit),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
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
  base: path.join(__dirname, "..").replace(/\\/g, "/"),
});

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

// contextBridge.exposeInMainWorld('electronAPI', {
//     chooseFolder: () => ipcRenderer.invoke('dialog:openFolder'),
//     listFiles: (path) => ipcRenderer.invoke('fs:listFiles', path),
//     listFilesRecursively: (dir) => listFilesRecursively(dir), 
// });