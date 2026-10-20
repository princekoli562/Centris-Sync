const { ipcMain } = require("electron");

let pollTimer = null;
let lastState = { enabled: null, capacity: null };

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Fetch /api/get-sync-config and push results to the renderer.
 * Called every 30s by startSyncConfigPolling().
 */
async function fetchAndPushSyncConfig(win, ctx) {
    if (!ctx) return lastState.capacity;
    const { apiUrl, customer_id, domain_id, user_id } = ctx;
    if (!apiUrl || !customer_id || !domain_id || !user_id) return lastState.capacity;

    let res, body;
    try {
        res = await fetch(`${apiUrl}/api/get-sync-config`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ customer_id, domain_id, user_id }),
        });
        body = await res.json().catch(() => ({}));
    } catch (e) {
        // network error → leave last state alone, retry next tick
        console.warn("[sync-config] network error:", e.message);
        return lastState.capacity;
    }

    // ── Case A: admin disabled sync (403 + reason sync_disabled) ─────────
    if (res.status === 403 && body.reason === "sync_disabled") {
        if (lastState.enabled !== false) {
            lastState.enabled = false;
            if (win && !win.isDestroyed() && win.webContents) {
                win.webContents.send("sync-disabled-by-server", {
                    message: body.message || "Sync disabled by administrator.",
                });
            }
        }
        // also refresh capacity card so the badge flips to "Disabled"
        if (lastState.capacity) {
            const disabledCap = {
                ...lastState.capacity,
                syncEnabled: false,
            };
            lastState.capacity = disabledCap;
            if (win && !win.isDestroyed() && win.webContents) {
                win.webContents.send("storage-capacity-update", disabledCap);
            }
        }
        return lastState.capacity;
    }

    // ── Case B: other error → do NOT change state ────────────────────────
    if (!res.ok || body.status !== true) {
        console.warn("[sync-config] failed:", res.status, body.reason || body.message);
        return lastState.capacity;
    }

    // ── Case C: OK → re-enable if admin turned it back on ────────────────
    if (lastState.enabled === false) {
        lastState.enabled = true;
        if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send("sync-enabled-by-server", {
                message: "Sync re-enabled by administrator.",
            });
        }
    }
    if (lastState.enabled === null) lastState.enabled = true;

    // ── Build the dual cap object — Account Limit (Cloud) & Mapped Drive (VHDX 10 GB) ──
    const limitBytes = Number(body.sync_size_limit_bytes) || 0;
    const usedBytes = Number(body.used_bytes) || 0;
    let serverLimitGb = Number(body.sync_size_limit_in_gb) || 0;
    if (!serverLimitGb && limitBytes > 0) {
        serverLimitGb = parseFloat((limitBytes / (1024 * 1024 * 1024)).toFixed(1));
    }

    const isServerBlocked = (body.sync_status === "block");
    const isServerReady = (body.sync_enabled === 1 || body.sync_status === "ready");

    // 1️⃣ Mapped Drive VHDX metrics
    const driveTotalBytes = (ctx.physicalLimitGb || 10) * 1024 * 1024 * 1024;
    const driveUsedBytes = ctx.getDriveUsedBytes ? ctx.getDriveUsedBytes() : (lastState.capacity?.drive?.usedBytes || 0);
    const driveFreeBytes = Math.max(0, driveTotalBytes - driveUsedBytes);
    const driveRawPercent = (driveUsedBytes / driveTotalBytes) * 100;
    const drivePercentage = Math.min(100, parseFloat(driveRawPercent.toFixed(1)));
    let driveStatus = "normal";
    if (driveRawPercent >= 100) driveStatus = "full";
    else if (driveRawPercent >= 90) driveStatus = "danger";
    else if (driveRawPercent >= 85) driveStatus = "warning";

    const drive = {
        totalBytes: driveTotalBytes,
        totalFormatted: `${ctx.physicalLimitGb || 10} GB`,
        usedBytes: driveUsedBytes,
        usedFormatted: formatBytes(driveUsedBytes),
        freeBytes: driveFreeBytes,
        freeFormatted: formatBytes(driveFreeBytes),
        percentage: drivePercentage,
        rawPercentage: driveRawPercent,
        status: driveStatus,
        isWarning: driveRawPercent >= 85,
        isDanger: driveRawPercent >= 90,
        isSyncBlocked: driveRawPercent >= 100,
        limitMB: (ctx.physicalLimitGb || 10) * 1024
    };

    // 2️⃣ Account Quota metrics
    const percentage = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
    const status =
        limitBytes <= 0 ? "warning" :
            usedBytes >= limitBytes ? "full" :
                usedBytes >= limitBytes * 0.9 ? "danger" :
                    usedBytes >= limitBytes * 0.85 ? "warning" : "normal";

    const remainingBytes = Number(body.remaining_bytes) || Math.max(0, limitBytes - usedBytes);

    const account = {
        serverLimitGb,
        totalBytes: limitBytes,
        totalFormatted: body.limit_formatted || formatBytes(limitBytes),
        usedBytes,
        usedFormatted: body.used_formatted || formatBytes(usedBytes),
        remainingBytes,
        remainingFormatted: body.remaining_formatted || formatBytes(remainingBytes),
        freeFormatted: body.remaining_formatted || formatBytes(remainingBytes),
        percentage,
        rawPercentage: (limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0),
        status,
        isWarning: status === "warning",
        isDanger: status === "danger" || status === "full",
        isSyncBlocked: limitBytes > 0 && usedBytes >= limitBytes,
        syncEnabled: !isServerBlocked,
        syncStatus: body.sync_status || (isServerReady ? "ready" : "stop")
    };

    // 3️⃣ Priority blocking: Account limit is first priority, then mapped drive
    let isSyncBlocked = false;
    let blockReason = "";
    let blockMessage = "";

    if (account.isSyncBlocked) {
        isSyncBlocked = true;
        blockReason = "account_limit";
        blockMessage = `Storage capacity reached 100% of account limit (${account.usedFormatted} / ${account.totalFormatted}). Sync stopped.`;
    } else if (drive.isSyncBlocked) {
        isSyncBlocked = true;
        blockReason = "drive_capacity";
        blockMessage = `Mapped drive capacity reached 100% (${drive.usedFormatted} / ${drive.totalFormatted}). Sync stopped.`;
    }

    const priorityOrder = { full: 4, danger: 3, warning: 2, normal: 1 };
    const overallStatus = (priorityOrder[account.status] >= priorityOrder[drive.status])
        ? account.status
        : drive.status;

    const cap = {
        serverLimitGb,
        totalBytes: limitBytes,
        totalFormatted: account.totalFormatted,
        usedBytes: account.usedBytes,
        usedFormatted: account.usedFormatted,
        remainingBytes,
        remainingFormatted: account.remainingFormatted,
        freeFormatted: drive.freeFormatted,
        percentage: account.percentage,
        status: overallStatus,
        isWarning: account.isWarning || drive.isWarning,
        isDanger: account.isDanger || drive.isDanger,
        isSyncBlocked,
        blockReason,
        blockMessage,
        physicalLimitGb: ctx.physicalLimitGb || 10,
        syncEnabled: !isServerBlocked,
        syncStatus: account.syncStatus,
        serverTime: body.server_time,

        account,
        drive
    };

    lastState.capacity = cap;
    if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send("storage-capacity-update", cap);
    }
    return cap;
}

function startSyncConfigPolling(win, ctx) {
    stopSyncConfigPolling();
    // fire immediately, then every 30s
    fetchAndPushSyncConfig(win, ctx).catch(() => { });
    pollTimer = setInterval(() => {
        fetchAndPushSyncConfig(win, ctx).catch(() => { });
    }, 30_000);
    console.log("[sync-config] polling started");
}

function stopSyncConfigPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        console.log("[sync-config] polling stopped");
    }
}

function getLastSyncConfig() {
    return lastState.capacity;
}

module.exports = {
    startSyncConfigPolling,
    stopSyncConfigPolling,
    fetchAndPushSyncConfig,
    getLastSyncConfig,
};

