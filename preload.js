const { contextBridge, ipcRenderer } = require('electron')

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

contextBridge.exposeInMainWorld('electronAPI', {
    chooseFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    listFiles: (path) => ipcRenderer.invoke('fs:listFiles', path)
});