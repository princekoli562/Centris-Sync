// vhdx-service.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const VHDX_NAME = "Centris-Drive.vhdx";
const VHDX_PATH = path.join(os.homedir(), VHDX_NAME);
const VHDX_SIZE_MB = 10240; // 10 GB
const VOLUME_LABEL = "Centris-Drive";
const homeDir = os.homedir();

function runAdminTask(scriptPath, vhdxPath) {
    return new Promise((resolve, reject) => {
        const ps = `
Start-Process "node" -ArgumentList '"${scriptPath}" "${vhdxPath}"' -Verb RunAs
`;

        exec(`powershell -Command "${ps}"`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function createVHDX() {
    const adminScript = path.join(__dirname, "admin-task.js");

    await runAdminTask(adminScript, VHDX_PATH);

    await new Promise(r => setTimeout(r, 4000));

    const output = require("child_process")
        .execSync('wmic logicaldisk get name,volumename')
        .toString();

    const match = output.match(/([A-Z]):\s+Centris-Drive/);
    return match ? `${match[1]}:\\` : null;
}

module.exports = { createVHDX };

