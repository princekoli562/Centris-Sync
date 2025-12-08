// admin-task.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const VHDX_PATH = process.argv[2];
const VHDX_SIZE_MB = 1024 * 1024; // 1GB
const VHDX_LABEL = "Centris-Drive";


function createDiskpartScript() {
    const esc = VHDX_PATH.replace(/\\/g, "\\\\");
    return `
    create vdisk file="${esc}" maximum=${VHDX_SIZE_MB} type=expandable
    select vdisk file="${esc}"
    attach vdisk
    create partition primary
    format fs=ntfs quick label="${LABEL}"
    assign
    exit
    `;
}

try {
    // VERY IMPORTANT — use TEMP folder!
    const tempScript = path.join(os.tmpdir(), "create.txt");

    fs.writeFileSync(tempScript, createDiskpartScript());

    execSync(`diskpart /s "${tempScript}"`, { stdio: "inherit" });

    fs.unlinkSync(tempScript);

    console.log("DONE");

} catch (err) {
    console.error("❌ DISKPART ERROR:");
    console.error(err);
}
