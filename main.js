const { app, BrowserWindow, ipcMain,dialog } = require('electron');
const path = require('node:path');
const fs = require('fs');
const SECRET_KEY = "25fHeqIXYAfa";
let win;

const createWindow = () => {
	win = new BrowserWindow({
		width: 800,
		height: 600,
		webPreferences: {
      		preload: path.join(__dirname, 'preload.js'), // Ensure the correct path to preload.js
      		contextIsolation: true, // Required for contextBridge to work
            enableRemoteModule: false, // Keep secure
            nodeIntegration: false // Keep secure
    	}
	});

	win.loadFile('index.html');

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

app.whenReady().then(() => {
	createWindow()
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
ipcMain.handle('dialog:openFolder', async () => {
	const result = await dialog.showOpenDialog(win, {
		properties: ['openDirectory']
	});
	return result.canceled ? null : result.filePaths[0];
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

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});