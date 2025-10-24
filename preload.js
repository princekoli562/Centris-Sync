const { contextBridge, ipcRenderer } = require('electron')
//const fs = require('fs');
//const path = require('path');

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
    chooseFolder: async () => await ipcRenderer.invoke('dialog:openFolder'),
    listFiles: (path) => ipcRenderer.invoke('fs:listFiles', path),
    listFilesRecursively: (dir) => ipcRenderer.invoke('fs:listFilesRecursively', dir)
    //listFilesRecursively: async (dir) => await listFilesRecursively(dir)
});

contextBridge.exposeInMainWorld('versions', {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
    // we can also expose variables, not just functions
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