const BATCH_SIZE = 500; // how many files to show per scroll
let allItems = [];
let visibleCount = 0;

let totalItems = 0;
let loadedItems = 0;
let isLoading = false;
let history = [];
let currentIndex = -1;
window.stopSync = true;

let currentView = "grid";

let customer_data = localStorage.getItem('customer_data');
let domain_data = localStorage.getItem('domain_data');
let user_data = localStorage.getItem('user_data');

let syncData = null;
let user_list = [];
let pingInterval = null;

let isSyncing = false;
let autoSyncInterval = null;
let isSyncRunning = false;
let searchTimer = null;
let fsListenerAttached = false;  // track listener


let sync_toggle = document.getElementById("syncToggle");
let sync_indicator = document.getElementById("sync-indicator");
let sync_text = document.getElementById("sync-text");
let sync_icon = document.getElementById("sync-icon");

/* ============================================================
   DUAL PROGRESS SYSTEM (C2S: Watcher Upload/Delete, S2C: Server Download/Delete)
============================================================ */
let c2sHideTimeout = null;
let s2cHideTimeout = null;

function bringToTop(cardId) {
    const wrapper = document.getElementById("syncProgressWrapper");
    const card = document.getElementById(cardId);
    if (wrapper && card && wrapper.firstElementChild !== card) {
        wrapper.prepend(card);
    }
}

function showC2SProgress(type, text, percent) {
    if (c2sHideTimeout) {
        clearTimeout(c2sHideTimeout);
        c2sHideTimeout = null;
    }
    const card = document.getElementById("c2sProgressCard");
    const label = document.getElementById("c2sProgressLabel");
    const bar = document.getElementById("c2sProgressBar");
    const badge = card ? card.querySelector(".c2s-badge") : null;

    if (badge) {
        badge.innerHTML = type === "delete"
            ? `<i class="fas fa-trash-alt"></i> C2S · Delete`
            : `<i class="fas fa-cloud-upload-alt"></i> C2S · Upload`;
    }

    if (card) card.style.display = "block";
    if (label) label.textContent = text;
    if (bar && percent !== undefined) bar.value = percent;

    bringToTop("c2sProgressCard");
}

function completeC2SProgress(text) {
    const card = document.getElementById("c2sProgressCard");
    const label = document.getElementById("c2sProgressLabel");
    const bar = document.getElementById("c2sProgressBar");
    if (card) card.style.display = "block";
    if (label) label.textContent = text || "✅ C2S Upload complete! 100%";
    if (bar) bar.value = 100;

    bringToTop("c2sProgressCard");

    if (c2sHideTimeout) clearTimeout(c2sHideTimeout);
    c2sHideTimeout = setTimeout(() => {
        const c = document.getElementById("c2sProgressCard");
        if (c) c.style.display = "none";
    }, 6000);
}

function hideC2SProgress() {
    const card = document.getElementById("c2sProgressCard");
    if (card) card.style.display = "none";
}

function showS2CProgress(type, text, percent) {
    if (s2cHideTimeout) {
        clearTimeout(s2cHideTimeout);
        s2cHideTimeout = null;
    }
    const card = document.getElementById("s2cProgressCard");
    const label = document.getElementById("s2cProgressLabel");
    const bar = document.getElementById("s2cProgressBar");
    const badge = card ? card.querySelector(".s2c-badge") : null;

    if (badge) {
        badge.innerHTML = type === "delete"
            ? `<i class="fas fa-trash-alt"></i> S2C · Delete`
            : `<i class="fas fa-cloud-download-alt"></i> S2C · Download`;
    }

    if (card) card.style.display = "block";
    if (label) label.textContent = text;
    if (bar && percent !== undefined) bar.value = percent;

    bringToTop("s2cProgressCard");
}

function completeS2CProgress(text) {
    const card = document.getElementById("s2cProgressCard");
    const label = document.getElementById("s2cProgressLabel");
    const bar = document.getElementById("s2cProgressBar");
    if (card) card.style.display = "block";
    if (label) label.textContent = text || "✅ S2C Download complete! 100%";
    if (bar) bar.value = 100;

    bringToTop("s2cProgressCard");

    if (s2cHideTimeout) clearTimeout(s2cHideTimeout);
    s2cHideTimeout = setTimeout(() => {
        const c = document.getElementById("s2cProgressCard");
        if (c) c.style.display = "none";
    }, 6000);
}

function hideS2CProgress() {
    const card = document.getElementById("s2cProgressCard");
    if (card) card.style.display = "none";
}

/* ------------------------------------------------------------
   EVENT LISTENERS: C2S (Upload) & S2C (Download) & Delete (Both)
------------------------------------------------------------ */

// Upload (C2S)
window.electronAPI.onUploadProgressStart(({ total = 0 } = {}) => {
    if (total <= 0) return;
    showC2SProgress("upload", `Uploading... 0% (0/${total})`, 0);
});

window.electronAPI.onUploadProgress(({ done = 0, total = 0, file } = {}) => {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    showC2SProgress("upload", `Uploading... ${percent}% (${done}/${total})`, percent);
    if (percent >= 100) {
        completeC2SProgress(`✅ C2S Upload complete! 100% (${done}/${total})`);
    }
    if (file) console.log("C2S Uploading:", file);
});

window.electronAPI.onUploadComplete(() => {
    completeC2SProgress("✅ C2S Upload complete! 100%");
});

window.electronAPI.onUploadHide(() => {
    hideC2SProgress();
});

// Delete (Dispatched to C2S or S2C based on source)
window.electronAPI.onDeleteProgressStart((data = {}) => {
    const total = data.total || 0;
    if (total <= 0) return;
    const source = String(data.source || "").toLowerCase();
    const isC2S = source === "client" || source === "c2s";

    if (isC2S) {
        showC2SProgress("delete", `Deleting on Server... 0% (0/${total})`, 0);
    } else {
        showS2CProgress("delete", `Deleting locally... 0% (0/${total})`, 0);
    }
});

window.electronAPI.onDeleteProgress(({ done = 0, total = 0, file, source } = {}) => {
    if (total <= 0) return;
    const percent = Math.round((done / total) * 100);
    const src = String(source || "").toLowerCase();
    const isC2S = src === "client" || src === "c2s";

    if (isC2S) {
        showC2SProgress("delete", `Deleting on Server... ${percent}% (${done}/${total})`, percent);
    } else {
        showS2CProgress("delete", `Deleting locally... ${percent}% (${done}/${total})`, percent);
    }
    if (file) console.log(`Deleting (${source}):`, file);
});

window.electronAPI.onDeleteComplete((data = {}) => {
    const source = String(data?.source || "").toLowerCase();
    const status = data?.status || "";
    const isC2S = source === "client" || source === "c2s";

    // 🛑 If there were no items to delete, do NOT show progress card and do NOT refresh screen
    if (status === "no-delete") {
        if (isC2S) hideC2SProgress();
        else hideS2CProgress();
        return;
    }

    const msg = isC2S ? "🗑️ C2S Delete complete!" : "🗑️ S2C Delete complete!";

    if (isC2S) {
        completeC2SProgress(msg);
    } else {
        completeS2CProgress(msg);
    }

    // Only refresh drive view when actual items were deleted
    setTimeout(() => {
        if (typeof loadDriveItems === "function" && history[currentIndex]) {
            loadDriveItems(history[currentIndex], true);
        }
    }, 3000);
});

window.electronAPI.onDeleteHide((data = {}) => {
    const source = String(data?.source || "").toLowerCase();
    if (source === "client" || source === "c2s") {
        hideC2SProgress();
    } else if (source) {
        hideS2CProgress();
    } else {
        hideC2SProgress();
        hideS2CProgress();
    }
});

// Download (S2C)
window.electronAPI.onDownloadProgressStart(({ total = 0 } = {}) => {
    if (total <= 0) return;
    showS2CProgress("download", `Downloading... 0% (0/${total})`, 0);
});

window.electronAPI.onDownloadProgress(({ done = 0, total = 0, file } = {}) => {
    if (total <= 0) return;
    const percent = Math.round((done / total) * 100);
    showS2CProgress("download", `Downloading... ${percent}% (${done}/${total})`, percent);
    if (percent >= 100) {
        completeS2CProgress(`✅ S2C Download complete! 100% (${done}/${total})`);
    }
    if (file) console.log("S2C Downloading:", file);
});

window.electronAPI.onDownloadComplete((data = {}) => {
    const status = data?.status || "";

    // 🛑 If there were no items to download, do NOT show progress card and do NOT refresh screen
    if (status === "no-download") {
        hideS2CProgress();
        return;
    }

    completeS2CProgress("✅ S2C Download complete! 100%");

    // Only refresh drive view when actual items were downloaded
    setTimeout(() => {
        if (typeof loadDriveItems === "function" && history[currentIndex]) {
            loadDriveItems(history[currentIndex], true);
        }
    }, 3000);
});

window.electronAPI.onDownloadHide(() => {
    hideS2CProgress();
});

// Generic sync progress / status listeners
window.electronAPI.onSyncProgress(({ done, total, file } = {}) => {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    showC2SProgress("sync", `Syncing... ${percent}% (${done}/${total})`, percent);
    if (percent === 100) {
        completeC2SProgress("✅ Sync complete!");
    }
});

window.electronAPI.onSyncStatus((_event, payload) => {
    if (!payload || typeof payload !== "object") return;
    const status = String(payload.status || "").toLowerCase();
    const message = payload.message || "";
    console.log("📦 Sync status:", status, message);
    if (status === "success" && message.toLowerCase().includes("complete")) {
        completeC2SProgress("✅ " + message);
    }
});

// Online / Offline listener
window.addEventListener("online", () => {
    console.log('On - > ' + sync_toggle.checked);
    updateUI({ enabled: sync_toggle.checked, online: true, syncData: syncData });
    checkServer(sync_toggle.checked, true); // 🔥 important
    startPing(syncData);
});

window.addEventListener("offline", () => {
    console.log('Off - > ' + sync_toggle.checked);
    updateUI({ enabled: sync_toggle.checked, online: false, server: false, syncData: syncData });
    stopPing();
});



// window.electronAPI.onDownloadComplete(() => {
//     progressLabel.textContent = "✅ Download complete!";
// });




// Apply initial class
$("#file-list").addClass("grid-view");

document.addEventListener('DOMContentLoaded', async () => {
    // await setupDrive();
    const config = await window.electronAPI.getAppConfig();
    console.log(config);
    syncData = await window.electronAPI.getSyncData();
    //startAutoSync(syncData);
    //await window.electronAPI.getMappedDrive();//
    let currentDir = config.drivePath;
    // if (config.platform === "win32") {
    //     // Example: "F:\"
    //     currentDir = config.drivePath;
    // } else if (config.platform === "darwin") {
    //     // Example: "/Volumes/Centris-Drive"
    //     currentDir = config.drivePath + config.volume_label;
    // }
    //let currentDir = Object.keys(mappedDir)[0];
    //console.log(mappedDrive);
    let local_stored = localStorage.getItem("customer_data");

    if (local_stored) {
        customer_data = JSON.parse(localStorage.getItem("customer_data"));
        domain_data = JSON.parse(localStorage.getItem("domain_data"));
        user_data = JSON.parse(localStorage.getItem("user_data"));
    } else {
        customer_data = syncData.customer_data;
        domain_data = syncData.domain_data;
        user_data = syncData.user_data;
    }
    console.log(currentDir);
    console.log(config.platform + ' = ' + config.volume_label);
    // Tab switching
    window.secret_key = localStorage.getItem('secret_key');
    window.secret_gen_key = localStorage.getItem('secret_gen_key');
    window.apiUrl = syncData.apiUrl;

    let currentUser = {
        customer_id: syncData.customer_data.id,
        domain_id: syncData.domain_data.id,
        domain_name: syncData.domain_data.domain_name,
        user_id: syncData.user_data.id,
        apiUrl: syncData.apiUrl
    };



    await loadUsersFromSession(syncData, user_list);

    const syncEnabled = await window.electronAPI.getSyncStatus(currentUser);

    if (navigator.onLine) {
        checkServer(syncEnabled, navigator.onLine, syncData);
        startPing(syncData);
    } else {
        updateUI({ enabled: syncEnabled, online: navigator.onLine, syncData });
    }

    if (syncEnabled) {
        window.electronAPI.onFSChange(() => {
            if (isSyncRunning) return;

            isSyncRunning = true;

            triggerSync(syncData, false)
                .finally(() => {
                    isSyncRunning = false;
                });
        });
    }

    console.log('DD - >' + syncEnabled);

    // if (!syncEnabled) {
    //     console.log("Sync disabled by user");
    // }else{
    //     window.electronAPI.startServerPolling(syncData);
    //     window.electronAPI.startDriveWatcher(syncData);
    // }

    if (!syncEnabled) {
        console.log("Sync disabled by user");
    } else {
        // 🔧 FIX: run first S2C to completion BEFORE starting the watcher
        (async () => {
            try {
                await window.electronAPI.startServerPolling(syncData);
                console.log("✅ First S2C done — starting watcher");
                await window.electronAPI.startDriveWatcher(syncData);
            } catch (e) {
                console.error("Initial S2C failed; watcher will start after 30s retry:", e);
                setTimeout(() => {
                    window.electronAPI.startDriveWatcher(syncData).catch(() => { });
                }, 30_000);
            }
        })();
    }

    var apiUrl = window.apiUrl;
    var secret_gen_key = window.secret_gen_key;
    var secret_key = window.secret_key;

    // console.log("API URL:", apiUrl);
    // console.log("Secret key:", secret_key);


    $(".sidebar .btnload").removeClass("active");
    $("#openDrive").addClass("active");

    // 🔹 Optionally trigger loadFiles for the default directory

    // history = [currentDir];
    // currentIndex = 0;    
    await initFirstPath(currentDir);
    console.log(history);
    await loadDriveItems(currentDir);

    //await loadFiles(currentDir,true);

    $(document).on("click", ".tab", function (e) {
        const tab = $(this).data('tab');
        $('.tab').removeClass('active');
        $(this).addClass('active');
        $('.tab-content').removeClass('active');
        $('#' + tab).addClass('active');
    });


    let isDragging = false;
    let lastX = 0;
    let rafId = null;

    const $container = $("#main-content");
    const $fileList = $("#file-list");
    const $preview = $("#preview-panel");
    const $dragBar = $("#drag-bar");

    $dragBar.on("mousedown", function (e) {
        e.preventDefault();
        isDragging = true;
        lastX = e.pageX;
        $("body").addClass("dragging");
    });

    $(document).on("mousemove", function (e) {
        if (!isDragging) return;
        lastX = e.pageX;

        // throttle with RAF
        if (!rafId) {
            rafId = requestAnimationFrame(updateLayout);
        }
    });

    $(document).on("mouseup mouseleave", function () {
        stopDrag();
    });

    function updateLayout() {
        rafId = null;
        if (!isDragging) return;

        const containerOffset = $container.offset().left;
        const containerWidth = $container.width();
        const dragBarWidth = $dragBar.width();

        let newLeftWidth = lastX - containerOffset;

        // limits
        const min = 180;
        const max = containerWidth - 240;

        newLeftWidth = Math.max(min, Math.min(max, newLeftWidth));

        // 🚀 minimal DOM writes
        $fileList[0].style.width = newLeftWidth + "px";
        $preview[0].style.width = (containerWidth - newLeftWidth - dragBarWidth) + "px";
    }

    function stopDrag() {
        if (!isDragging) return;
        isDragging = false;
        $("body").removeClass("dragging");
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }



    // document.getElementById("stopSyncBtn").addEventListener("click", () => {
    //    // window.electronAPI.stopSync();
    //     window.electronAPI.hardStop();
    // });

    // --- Local Files ---

    $(document).on("click", "#chooseFolder", async function (e) {
        const folderPath = await window.electronAPI.chooseFolder();
        var customer_data = JSON.parse(localStorage.getItem('customer_data'));
        var domain_data = JSON.parse(localStorage.getItem('domain_data'));
        console.log(customer_data);
        console.log(domain_data);
        if (!folderPath) return;
        $('#folderPath').text(folderPath);
        const files = await window.electronAPI.listFiles(folderPath);

        // Recursively get files/folders
        const filesTree = await window.electronAPI.listFilesRecursively(folderPath);
        renderFileList('#localFileList', filesTree);
        console.log(filesTree);
        // Send to Laravel API
        try {
            const res = await fetch(apiUrl + '/api/sync-files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer_id: customer_data.id,
                    domain_id: domain_data.id,
                    root_path: folderPath,
                    files: filesTree
                })
            });
            const data = await res.json();
            console.log('Sync Result:', data);
        } catch (err) {
            console.error('Sync Error:', err);
        }
    });

    // --- Remote Files ---

    $(document).on("click", "#loadRemote", async function (e) {
        const remoteList = $('#remoteFileList');
        remoteList.html('<li>Loading...</li>');
        console.log(secret_key);
        console.log(apiUrl);
        if (apiUrl.length <= 0) {
            console.log("invalid secret key provided");
            return false;
        }
        try {
            const res = await fetch(apiUrl + '/api/getFiles');
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            renderTree('#remoteFileList', data);
        } catch (err) {
            remoteList.html(`<li style="color:red;">Error: ${err.message}</li>`);
        }
    });

    let currentMenu = null;
    let currentBtn = null;

    // $(document).on("click", "#openDrive", async function (e) {
    //     //e.preventDefault();

    //     // 👇 Example mapped folder path on Desktop (adjust as needed)
    //     console.log('kii');
    //     const desktopPath = "F:\\";

    //     // Call the backend (Electron main process)
    //     const result = await window.electronAPI.listRecurFiles(desktopPath);
    //     console.log('prince');
    //     const fileList = $("#file-list");
    //     const breadcrumb = $("#breadcrumb");

    //     if (result.error) {
    //         fileList.html(`<p style='color:red'>${result.error}</p>`);
    //         return;
    //     }

    //     breadcrumb.text("Path: " + result.currentPath);
    //     fileList.empty();

    //     result.items.forEach(item => {
    //         const icon = item.isDirectory ? "📁" : "📄";
    //         const div = $(`
    //             <div class='file-item' style='cursor:pointer;margin:4px 0'>
    //                 <span>${icon} ${item.name}</span>
    //             </div>
    //         `);

    //         div.on("click", () => {
    //             if (item.isDirectory) {
    //                 window.electronAPI.listRecurFiles(item.path).then(subResult => {
    //                     // recursively show next folder content
    //                     fileList.empty();
    //                     breadcrumb.text("Path: " + subResult.currentPath);
    //                     subResult.items.forEach(subItem => {
    //                         const subIcon = subItem.isDirectory ? "📁" : "📄";
    //                         fileList.append(`<div>${subIcon} ${subItem.name}</div>`);
    //                     });
    //                 });
    //             }
    //         });

    //         fileList.append(div);
    //     });
    // });



    // Load the initial directory (triggered by your “Open Drive” button)
    $(document).on("click", "#openDrive", async function (e) {
        e.preventDefault();
        await loadFiles(currentDir, true);
    });

    // 🔹 Scroll listener for lazy loading
    // $("#file-list").on("scroll", function () {
    //     const scrollTop = $(this).scrollTop();
    //     const scrollHeight = $(this)[0].scrollHeight;
    //     const clientHeight = $(this).height();

    //     // if user scrolled near bottom, load next batch
    //     if (scrollTop + clientHeight >= scrollHeight - 50) {
    //         if (visibleCount < allItems.length) {
    //             renderNextBatch();
    //         }
    //     }
    // });

    // 🔹 Breadcrumb navigation
    $(document).on("click", ".crumb", async function () {
        const path = $(this).data("path");
        if (path == '#') return;
        await loadFiles(path, true);
    });

    // Infinite scroll handler
    $("#file-list").on("scroll", async function () {

        if (isLoading) return;

        // if (currentMenu && currentBtn) {
        //     const offset = currentBtn.offset();
        //     currentMenu.css({
        //         top: offset.top + currentBtn.outerHeight() + 4,
        //         left: offset.left - 100,
        //     });
        // }

        if (currentMenu) {
            $('.floating-menu').remove();
            currentMenu = null;
            currentBtn = null;
        }
        console.log(loadedItems + ' = ' + totalItems);
        const nearBottom = this.scrollTop + this.clientHeight >= this.scrollHeight - 50;
        if (nearBottom && loadedItems < totalItems) {
            await loadFiles(currentDir, false);
        }
    });



    $(document).on("click", "#uploadFolder", function (e) {
        e.stopPropagation();
        const menu = $("#uploadMenu");
        $(".upload-menu").not(menu).removeClass("show"); // close others
        menu.toggleClass("show");

        // Correct button reference
        const rect = e.currentTarget.getBoundingClientRect();
        menu.css({
            top: rect.bottom + window.scrollY + "px",
            left: rect.left + "px"
        });
    });


    $(document).on("click", () => $(".file-menu").addClass("hidden"));

    $(document).on("click", function () {
        $(".upload-menu").removeClass("show");
    });

    /* ============================================================
       CREATE NEW EMPTY FOLDER
    ============================================================ */
    function openNewFolderModal() {
        $(".upload-menu").removeClass("show");
        $("#newFolderNameInput").val("New Folder");
        $("#newFolderError").text("");
        $("#newFolderModal").removeClass("hidden");
        setTimeout(() => {
            $("#newFolderNameInput").focus().select();
        }, 100);
    }

    function closeNewFolderModal() {
        $("#newFolderModal").addClass("hidden");
        $("#newFolderError").text("");
    }

    $(document).on("click", "#createFolderBtn, #createFolderMenuOption", function (e) {
        e.stopPropagation();
        openNewFolderModal();
    });

    $(document).on("click", "#closeNewFolderModal, #cancelNewFolderBtn", function () {
        closeNewFolderModal();
    });

    $(document).on("click", "#newFolderModal", function (e) {
        if ($(e.target).is("#newFolderModal")) {
            closeNewFolderModal();
        }
    });

    $(document).on("keydown", "#newFolderNameInput", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            $("#confirmNewFolderBtn").click();
        } else if (e.key === "Escape") {
            e.preventDefault();
            closeNewFolderModal();
        }
    });

    $(document).on("click", "#confirmNewFolderBtn", async function () {
        const folderName = $("#newFolderNameInput").val().trim();
        const errorEl = $("#newFolderError");

        if (!folderName) {
            errorEl.text("Please enter a folder name.");
            return;
        }

        const illegalCharsRegex = /[\\/:*?"<>|]/;
        if (illegalCharsRegex.test(folderName)) {
            errorEl.text('Folder name cannot contain \\ / : * ? " < > |');
            return;
        }

        let targetDir = currentDir;
        if (!targetDir) {
            const crumbs = document.querySelectorAll('#breadcrumb .crumb');
            if (crumbs.length > 0) {
                targetDir = crumbs[crumbs.length - 1].getAttribute("data-path");
            } else {
                targetDir = await window.electronAPI.getMappedDrive();
            }
        }

        if (!targetDir) {
            errorEl.text("Unable to determine current drive location.");
            return;
        }

        try {
            const result = await window.electronAPI.createEmptyFolder(targetDir, folderName);
            if (!result.success) {
                errorEl.text(result.error || "Failed to create folder.");
                return;
            }

            closeNewFolderModal();
            showValidation(`Folder "${folderName}" created successfully!`, "success", 2500);

            // Refresh current folder view
            await loadDriveItems(currentDir, true);

            // Trigger sync if enabled
            if (syncData) {
                triggerSync(syncData, false);
            }
        } catch (err) {
            console.error("createEmptyFolder error:", err);
            errorEl.text("Error: " + err.message);
        }
    });

    $(document).on("click", ".delete-btn", function (e) {
        e.preventDefault();

        const selectedCount = document.querySelectorAll(".file-item.selected").length;

        if (selectedCount === 0) {
            alert("Please select at least one item to delete.");
            return;
        }

        const confirmDelete = confirm(
            `Are you sure you want to delete ${selectedCount} item(s)?`
        );

        if (!confirmDelete) return;

        deleteSelectedItems();
    });



    // This is for single Folder Selection , but work inside recursively
    $(document).on("click", "#uploadFolderSingleOption", async function () {
        try {
            $(".upload-menu").removeClass("show");

            const folderPath = await window.electronAPI.openFolder();
            if (!folderPath) {
                showValidation("No folder selected.", 'info');
                return;
            }

            let mappedDrive;
            const crumbs = document.querySelectorAll('#breadcrumb .crumb');
            if (crumbs.length > 0) {
                mappedDrive = crumbs[crumbs.length - 1].getAttribute('data-path');
            } else {
                mappedDrive = await window.electronAPI.getMappedDrive();
            }

            if (!confirm(`Upload contents of "${folderPath}" to ${mappedDrive}?`)) return;

            showC2SProgress("upload", "Uploading folder...", 50);

            const result = await window.electronAPI.uploadFolderToDrive(folderPath, mappedDrive);

            if (!result.success) {
                alert("Error uploading: " + result.error);
                return;
            }

            completeC2SProgress("✅ C2S Upload complete! 100%");
            // alert("Folder uploaded successfully!");
            showValidation("The folder and files have been uploaded to Centris Local Drive successfully.", 'success');
            console.log(folderPath);
            console.log(mappedDrive);
            loadFiles(mappedDrive, true);
            await wait(2000);

            showValidation("Syncing files to Centris Local Drive. Please wait...", 'info', 0);

            // const filesTree = await window.electronAPI.listFilesRecursively(mappedDrive);
            // console.log("File Tree:", filesTree);

            const res = await fetch(`${apiUrl}/api/sync-folders-and-files`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer_id: customer_data.id,
                    domain_id: domain_data.id,
                    user_id: user_data.id,
                    root_path: folderPath
                })
            });
            const oldSnapshot = await window.electronAPI.loadTracker(false);
            console.log(oldSnapshot);
            const newSnapshot = await window.electronAPI.getDirectorySnapshot(mappedDrive, oldSnapshot);
            //console.log(newSnapshot['snapshot']);
            const saveShots = await window.electronAPI.saveTracker(newSnapshot['snapshot']);

            const data = await res.json();
            console.log("Sync Result:", data);
            await wait(2000);

            showValidation(data.message, 'success');

        } catch (err) {
            console.error("Upload or Sync Error:", err);
            showValidation("An error occurred: " + err.message, 'error');
        }
    });


    $(document).on("click", "#uploadFolderOption", async function () {
        try {
            if (isSyncing) {
                showValidation("⚠️ Sync already in progress, skipping...", "warning");
                return;
            }

            $(".upload-menu").removeClass("show");

            // ===============================
            // 1. SELECT MULTIPLE FOLDERS
            // ===============================
            let folderPaths = await window.electronAPI.openFolders();
            if (!folderPaths || folderPaths.length === 0) {
                showValidation("No folder selected.", "info");
                return;
            }

            // ===============================
            // 2. GET MAPPED DRIVE
            // ===============================
            let mappedDrive;
            const crumbs = document.querySelectorAll("#breadcrumb .crumb");

            let mappedConfigDrive = config.drivePath;

            if (config.platform === "win32") {
                // Example: "F:\"
                mappedDrive = crumbs.length > 0
                    ? crumbs[crumbs.length - 1].getAttribute("data-path")
                    : await window.electronAPI.getMappedDrive();
            } else if (config.platform === "darwin") {
                // Example: "/Volumes/Centris-Drive"
                mappedDrive = crumbs.length > 0
                    ? crumbs[crumbs.length - 1].getAttribute("data-path")
                    : mappedConfigDrive;
            }

            if (!confirm(`Upload ${folderPaths.length} folder(s) to ${mappedDrive}?`)) return;

            // ===============================
            // 3. PROCESS EACH SELECTED FOLDER
            // ===============================
            const allScans = [];
            let totalFilesInFolders = 0;
            for (const folderPath of folderPaths) {
                showValidation(`Scanning folder: ${folderPath}`, "info", 1500);
                const scanResult = await window.electronAPI.scanFolder(folderPath);
                const fileList = scanResult.files || [];
                totalFilesInFolders += fileList.length;
                allScans.push({ folderPath, scanResult, fileList });
            }

            if (totalFilesInFolders > 0) {
                showC2SProgress("upload", `Uploading... 0% (0/${totalFilesInFolders})`, 0);
            }

            let copiedFiles = 0;
            for (const { folderPath, scanResult, fileList } of allScans) {
                const folderList = scanResult.folders || [];
                if (fileList.length === 0 && folderList.length === 0) {
                    showValidation(`Folder empty: ${folderPath}`, "info");
                    continue;
                }

                // Root target folder name
                const rootName = await window.electronAPI.basename(folderPath);
                await window.electronAPI.createFolderInDrive(rootName, mappedDrive);

                for (const fullFile of fileList) {
                    const rel = await window.electronAPI.pathRelative(folderPath, fullFile);
                    const cleanRel = rootName + "/" + rel;

                    const parent = cleanRel.substring(0, cleanRel.lastIndexOf("/"));
                    if (parent) {
                        await window.electronAPI.createFolderInDrive(parent, mappedDrive);
                    }

                    // copy file to mapped drive
                    await window.electronAPI.copyFileToDrive(fullFile, cleanRel, mappedDrive);

                    copiedFiles++;
                    const percent = Math.round((copiedFiles / totalFilesInFolders) * 100);
                    showC2SProgress("upload", `Uploading... ${percent}% (${copiedFiles}/${totalFilesInFolders})`, percent);
                }
            }

            if (totalFilesInFolders > 0) {
                completeC2SProgress(`✅ C2S Upload complete! 100% (${copiedFiles}/${totalFilesInFolders})`);
            }

            // ===============================
            // 7. REFRESH VIEW + TRIGGER SYNC
            // ===============================
            loadFiles(mappedDrive, true);
            await wait(1000);

            if (syncData) {
                triggerSync(syncData, false);
            }

        } catch (err) {
            console.error(err);
            showValidation("Error: " + err.message, "error");
        }
    });


    $(document).on("click", "#uploadFileOption", async function () {
        try {
            $(".upload-menu").removeClass("show");

            // Load user session
            const local_stored = localStorage.getItem("customer_data");
            if (local_stored) {
                customer_data = JSON.parse(localStorage.getItem("customer_data"));
                domain_data = JSON.parse(localStorage.getItem("domain_data"));
                user_data = JSON.parse(localStorage.getItem("user_data"));
            }

            // 1️⃣ SELECT FILES
            const filePaths = await window.electronAPI.openFiles();
            if (!filePaths || filePaths.length === 0) {
                return showValidation("No files selected.", "info");
            }

            // 2️⃣ GET MAPPED DRIVE
            let mappedDrive;
            const crumbs = document.querySelectorAll('#breadcrumb .crumb');

            let mappedConfigDrive = config.drivePath;

            if (config.platform === "win32") {
                // Example: "F:\"
                mappedDrive = crumbs.length > 0
                    ? crumbs[crumbs.length - 1].getAttribute("data-path")
                    : await window.electronAPI.getMappedDrive();
            } else if (config.platform === "darwin") {
                // Example: "/Volumes/Centris-Drive"
                mappedDrive = crumbs.length > 0
                    ? crumbs[crumbs.length - 1].getAttribute("data-path")
                    : mappedConfigDrive;
            }

            // mappedDrive = crumbs.length > 0
            //     ? crumbs[crumbs.length - 1].getAttribute("data-path")
            //     : await window.electronAPI.getMappedDrive();

            if (!confirm(`Upload ${filePaths.length} file(s) to ${mappedDrive}?`)) return;

            // 3️⃣ READ FILE DETAILS + COPY LOCALLY
            const fileItems = [];
            const totalFiles = filePaths.length;
            showC2SProgress("upload", `Uploading... 0% (0/${totalFiles})`, 0);

            let copiedCount = 0;
            for (const fullPath of filePaths) {
                const fileName = await window.electronAPI.basename(fullPath);
                const fileContentBase64 = await window.electronAPI.readFileBase64(fullPath);
                const stats = await window.electronAPI.fileStat(fullPath);

                const destination = mappedDrive + "/" + fileName;

                // Copy file to mapped drive
                await window.electronAPI.copyFile(fullPath, destination);

                copiedCount++;
                const percent = Math.round((copiedCount / totalFiles) * 100);
                showC2SProgress("upload", `Uploading... ${percent}% (${copiedCount}/${totalFiles})`, percent);

                fileItems.push({
                    full_path: fullPath,
                    mapped_path: destination,
                    file_name: fileName,
                    size: stats.size,
                    mtime: stats.mtimeMs,
                    content_base64: fileContentBase64
                });
            }

            completeC2SProgress(`✅ C2S Upload complete! 100% (${copiedCount}/${totalFiles})`);
            showValidation("All files copied to Centris Local Drive.", "success", 2000);

            // 6️⃣ REFRESH FILE VIEW
            loadFiles(mappedDrive, true);

            await wait(500);

            if (syncData) {
                triggerSync(syncData, false);
            }

            // // 7️⃣ UPDATE TRACKER SNAPSHOT
            // const oldSnapshot = await window.electronAPI.loadTracker(false);
            // const newSnapshot = await window.electronAPI.getDirectorySnapshot(
            //     mappedDrive,
            //     oldSnapshot
            // );

            // await window.electronAPI.saveTracker(newSnapshot.snapshot);

            // // 8️⃣ DONE
            // showValidation("Files uploaded, synced & tracker updated successfully!", "success");

        } catch (err) {
            console.error("Upload Error:", err);
            showValidation("An error occurred: " + err.message, "error");
        }
    });


    $(document).on("click", "#back-btn", async function (e) {
        console.log('back - ' + currentIndex);
        if (currentIndex > 0) {
            currentIndex--;
            await loadDriveItems(history[currentIndex], true);
        }
        console.log(history);
    });

    $(document).on("click", "#forward-btn", async function (e) {
        console.log('next - ' + currentIndex + (history.length - 1));
        if (currentIndex < history.length - 1) {
            currentIndex++;
            await loadDriveItems(history[currentIndex], true);
        }
        console.log(history);
    });

    $(document).on("click", ".logout-icon", async function (e) {
        if (confirm("Logout this user?")) {
            await window.electronAPI.fullLogoutCleanup();
            await SessionLogout();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const autoExpireVal = true; // or from storage/config
            const result = await window.electronAPI.checkSessionAndRedirect(autoExpireVal);
            // call API / IPC / AJAX here
        }
    });

    $(document).on("click", "#deleteSecretKeyOption", async function (e) {
        e.stopPropagation();
        if (confirm("Are you sure you want to delete the saved Secret Key? You will need to enter it again on your next login.")) {
            try {
                if (window.electronAPI && window.electronAPI.deleteSavedSecretKey) {
                    await window.electronAPI.deleteSavedSecretKey();
                }
                localStorage.removeItem('secret_key');
                alert("Saved Secret Key deleted successfully.");
                $("#deleteSecretKeyOption").slideUp(200);
            } catch (err) {
                console.error("Error deleting secret key:", err);
                alert("Failed to delete secret key: " + (err.message || err));
            }
        }
    });



    $("#grid-view").on("click", async function () {
        currentView = "grid";
        $("#file-list").empty();
        $("#list-view").removeClass("active");
        $(this).addClass("active");
        $("#file-list").removeClass("list-view").addClass("grid-view");
        $("#file-list-header").addClass("hidden");
        var mappedDrive = await window.electronAPI.getMappedDrive();

        let mappedConfigDrive = config.drivePath;

        const crumbs = document.querySelectorAll('#breadcrumb .crumb');
        if (crumbs.length > 0) {
            const lastCrumb = crumbs[crumbs.length - 1];
            mappedDrive = lastCrumb.getAttribute('data-path');
            console.log("mappedDrive path:", mappedDrive);
        } else {
            // Get mapped drive dynamically
            if (config.platform === "win32") {
                mappedDrive = await window.electronAPI.getMappedDrive();
            } else if (config.platform === "darwin") {
                // Example: "/Volumes/Centris-Drive"
                mappedDrive = mappedConfigDrive;
            }

        }
        await loadFiles(mappedDrive, true);
    });

    $("#list-view").on("click", async function () {
        currentView = "list";
        $("#file-list").empty();
        $("#grid-view").removeClass("active");
        $(this).addClass("active");
        $("#file-list").removeClass("grid-view").addClass("list-view");
        $("#file-list-header").removeClass("hidden");
        var mappedDrive = await window.electronAPI.getMappedDrive();
        let mappedConfigDrive = config.drivePath;
        const crumbs = document.querySelectorAll('#breadcrumb .crumb');
        if (crumbs.length > 0) {
            const lastCrumb = crumbs[crumbs.length - 1];
            mappedDrive = lastCrumb.getAttribute('data-path');
            console.log("mappedDrive path:", mappedDrive);
        } else {
            if (config.platform === "win32") {
                // Get mapped drive dynamically
                mappedDrive = await window.electronAPI.getMappedDrive();

            } else if (config.platform === "darwin") {
                // Example: "/Volumes/Centris-Drive"
                mappedDrive = mappedConfigDrive;

            }
        }
        await loadFiles(mappedDrive, true);
    });

    $(document).on("click", "#SyncDrive", async function () {
        const btn = $(this);
        console.log(currentUser);
        const syncEnabled = await window.electronAPI.getSyncStatus(currentUser);
        if (syncEnabled) {
            btn.prop("disabled", true).html('<i class="bi bi-arrow-repeat spin"></i> Syncing...');

            await triggerSync(syncData, true);

            btn.prop("disabled", false).html('<i class="bi bi-arrow-repeat"></i> 🔄 Sync Drive');
        } else {
            showValidation("Sync is Disabled", "warning");
        }
    });

    $(document).on('click', '.file-menu-btn', function (e) {
        e.stopPropagation();

        // Close any open menu first
        $('.floating-menu').remove();
        currentMenu = null;
        currentBtn = null;

        const $btn = $(this);
        const $menu = $btn.siblings('.file-menu').clone();
        const offset = $btn.offset();

        // Clone and append to body
        $menu
            .removeClass('hidden')
            .addClass('floating-menu')
            .css({
                position: 'fixed',
                top: offset.top + $btn.outerHeight() + 4,
                left: offset.left - 100,
                zIndex: 999999,
            })
            .appendTo('body');

        currentMenu = $menu;
        currentBtn = $btn;
    });

    $(document).on("click", ".file-item", function (e) {
        if ($(e.target).closest(".file-menu, .file-menu-btn").length) return;
        // $(this).toggleClass("selected");
        // hideMiddleSection();  
        // 👇 read from parent .file-menu
        // prevent preview when clicking menu or checkbox

        const $menu = $(this).find(".file-menu");

        const targetPath = $menu.data("path");
        const type = $menu.data("type");
        console.log(targetPath, type);
        if (type == 'folder') return;

        openPreview(targetPath, type);

        // Add check icon only once
        // if ($item.find(".check-icon").length === 0) {
        //  $item.append('<div class="check-icon"></div>');
        // }


    });

    $(document).on("click", ".file-item .check-icon", function (e) {
        e.stopPropagation(); // prevent parent clicks

        const fileItem = $(this).closest(".file-item");

        fileItem.toggleClass("selected");
        $(this).toggleClass("checked"); // optional visual state

        hideMiddleSection();
    });



    // Hide when clicking outside
    $(document).on('click', function () {
        $('.floating-menu').remove();
        currentMenu = null;
        currentBtn = null;
    });

    // Handle menu actions
    $(document).on('click', '.floating-menu .menu-item', function (e) {
        e.stopPropagation();
        const action = $(this).data('action');

        // 👇 get data from parent menu
        const $menu = $(this).closest('.floating-menu');
        const targetPath = $menu.data('path');
        const type = $menu.data('type');

        $('.floating-menu').remove();
        currentMenu = null;
        currentBtn = null;

        if (!targetPath) return;
        if (action === 'open') openFolder(targetPath, type);
        if (action === 'view') openPreview(targetPath, type);
        if (action === 'delete') deleteFile(targetPath, type);
        if (action === 'move') moveFile(targetPath, type);
        if (action === 'rename') renameFile(targetPath, type);

    });

    const userIcon = document.getElementById("userIcon");
    const userdropdown = document.getElementById("userDropdown");
    const userList = document.getElementById("userList");

    userIcon.addEventListener("click", () => {
        userdropdown.style.display =
            userdropdown.style.display === "block" ? "none" : "block";
        renderUsers(syncData, user_list);
    });

    const drivePropsBtn = document.getElementById("drivePropertiesBtn");
    const drivePropsWrapper = document.getElementById("drivePropertiesWrapper");
    const drivePropsPopup = document.getElementById("drivePropertiesPopup");

    if (drivePropsWrapper) {
        drivePropsWrapper.addEventListener("mouseenter", () => {
            loadRootDriveProperties();
        });
    }

    if (drivePropsBtn) {
        drivePropsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (drivePropsPopup) {
                drivePropsPopup.classList.toggle("show");
                if (drivePropsPopup.classList.contains("show")) {
                    loadRootDriveProperties();
                }
            }
        });
    }

    // Close userdropdown and drivePropertiesPopup on outside click
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".user-menu")) {
            userdropdown.style.display = "none";
        }
        if (!e.target.closest(".drive-properties-wrapper")) {
            if (drivePropsPopup) {
                drivePropsPopup.classList.remove("show");
            }
        }
    });

    // Initial load of root drive properties
    loadRootDriveProperties();

    const previewToggleBtn = document.getElementById("previewToggle");
    const mainContent = document.getElementById("main-content");
    const previewPanel = document.getElementById("preview-panel");

    // previewToggleBtn.addEventListener("click", () => {
    //     mainContent.classList.toggle("preview-mode");
    //     previewPanel.classList.toggle("hidden");
    // });

    previewToggleBtn.addEventListener("click", () => {
        const isActive = mainContent.classList.toggle("preview-mode");

        previewPanel.classList.toggle("hidden", !isActive);
        previewToggleBtn.classList.toggle("active", isActive);
    });

    document.getElementById("searchInput").addEventListener("input", e => {
        clearTimeout(searchTimer);

        const query = e.target.value.trim();

        if (!query) {
            hideResults();
            return;
        }

        searchTimer = setTimeout(async () => {
            const results = await window.electronAPI.searchPaths(query);
            console.log("Results:", results);
            renderResults(results, query.toLowerCase());
        }, 500);
    });

    const searchInput = document.getElementById("searchInput");
    const searchResults = document.getElementById("searchResults");
    const searchContainer = document.querySelector(".search-container");
    const clearBtn = document.getElementById("clearSearchBtn");

    /* --------------------------
    SHOW WHEN TYPING & RESULTS EXIST
    ---------------------------*/
    searchInput.addEventListener("input", () => {
        if (searchResults.children.length > 0) {
            showResults();
        } else {
            hideResults();
        }
        clearBtn.style.display = searchInput.value.trim() ? "block" : "none";
    });

    clearBtn.addEventListener("click", () => {
        // 1️⃣ Clear input
        searchInput.value = "";

        // 2️⃣ Hide search results
        searchResults.innerHTML = "";
        searchResults.style.display = "none";

        // 3️⃣ Hide clear button
        clearBtn.style.display = "none";

        // 4️⃣ Optional: refocus input
        searchInput.focus();
    });

    /* --------------------------
    SHOW WHEN INPUT FOCUSED
    ---------------------------*/
    searchInput.addEventListener("focus", () => {
        if (searchResults.children.length > 0) {
            showResults();
        }
    });

    /* --------------------------
    CLICK OUTSIDE → HIDE
    ---------------------------*/
    document.addEventListener("mousedown", (e) => {
        if (!searchContainer.contains(e.target)) {
            hideResults();
        }
    });

    /* --------------------------
    CLICK RESULT → HIDE
    ---------------------------*/
    searchResults.addEventListener("click", () => {
        hideResults();
    });

    searchInput.addEventListener("input", () => {
        if (searchInput.value.trim() === "") {
            activeSearchFilter = null;
            hideResults();
            loadFiles(currentDir, true); // reload without filter
        }
    });

    // Toggle click



    // sync_toggle.addEventListener("change", async () => {
    //     const enabled = sync_toggle.checked;
    //     sync_icon.classList.add("syncing");
    //     // Save to DB / main process
    //     await window.electronAPI.setSyncStatus(currentUser, enabled);

    //     updateUI({ enabled : enabled, online: navigator.onLine });
    //     console.log(syncData);
    //     if (enabled) {
    //         startPing();
    //         window.electronAPI.startDriveWatcher(syncData);
    //     } else {
    //         stopPing();
    //         window.electronAPI.stopDriveWatcher();   
    //     }
    // });


    sync_toggle.addEventListener("change", async () => {
        const enabled = sync_toggle.checked;
        sync_icon.classList.add("syncing");

        // Save toggle state to DB / main process
        await window.electronAPI.setSyncStatus(currentUser, enabled);

        updateUI({ enabled, online: navigator.onLine, syncData });

        if (enabled) {
            // startPing(syncData);
            // window.electronAPI.startServerPolling(syncData);
            // window.electronAPI.startDriveWatcher(syncData);
            startPing(syncData);
            (async () => {
                try {
                    await window.electronAPI.startServerPolling(syncData);
                    console.log("✅ S2C started, watcher next");
                    await window.electronAPI.startDriveWatcher(syncData);
                } catch (e) {
                    console.error("S2C start failed:", e);
                }
            })();

            // Attach FS listener if not already
            if (!fsListenerAttached) {
                window.electronAPI.onFSChange(() => {
                    if (!sync_toggle.checked) return;  // extra guard
                    if (isSyncRunning) return;

                    isSyncRunning = true;

                    triggerSync(syncData, false)
                        .finally(() => {
                            isSyncRunning = false;
                        });
                });

                fsListenerAttached = true;
            }

        } else {
            stopPing();
            window.electronAPI.stopServerPolling();
            window.electronAPI.stopDriveWatcher();

        }

        sync_icon.classList.remove("syncing");
    });

    // Optional: hide when input loses focus AND mouse is not over results
    // searchInput.addEventListener("blur", () => {
    //     setTimeout(() => {
    //         if (!searchResults.matches(":hover")) {
    //             hideResults();
    //         }
    //     }, 500);
    // });

});

window.electronAPI.onMainLog((message) => {
    console.log('%c[MAIN]', 'color: #4CAF50; font-weight: bold;', message);
});

function renderUsers(syncData, user_list = []) {
    userList.innerHTML = "";

    user_list.forEach(user => {
        const li = document.createElement("li");
        li.className = user.active ? "active" : "";

        const hasImage =
            user.profile_image &&
            user.profile_image.trim() !== "";

        let fullPathProfileImg = syncData.config_data.storage_relative_path + user.profile_image;

        const avatarHTML = hasImage
            ? `<img src="${fullPathProfileImg}"
                    class="user-avatar-img"
                    onerror="this.replaceWith(createDefaultAvatar())" />`
            : getDefaultAvatarHTML();

        li.innerHTML = `
            <div class="user-row">
                <div class="user-info-left">
                    ${avatarHTML}
                    <span class="user-name">${user.name}</span>
                </div>
                ${user.active ? `<span class="check" title="Active">✔</span>` : ''}
            </div>
            ${user.active
            ? `
            <div class="user-dropdown-actions">
                <div class="delete-secret-key-option" id="deleteSecretKeyOption" title="Delete saved secret key">
                    <i class="fas fa-key"></i>
                    <span>Delete Secret Key</span>
                </div>
                <div class="logout-icon dropdown-logout-btn" 
                      title="Logout user" 
                      data-user-id="${user.id}">
                    <i class="fa fa-sign-out-alt"></i>
                    <span>Logout</span>
                </div>
            </div>
            `
            : ''
        }
        `;

        userList.appendChild(li);

        if (user.active && window.electronAPI && window.electronAPI.getSavedSecretKey) {
            window.electronAPI.getSavedSecretKey().then(savedKey => {
                if (!savedKey) {
                    const opt = li.querySelector("#deleteSecretKeyOption");
                    if (opt) opt.style.display = "none";
                }
            }).catch(() => {});
        }
    });
}

function getDefaultAvatarHTML() {
    return `
        <span class="user-avatar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#143b64"
                 xmlns="http://www.w3.org/2000/svg">
                <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/>
            </svg>
        </span>
    `;
}

function createDefaultAvatar() {
    const span = document.createElement("span");
    span.className = "user-avatar";
    span.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#143b64"
             xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/>
        </svg>
    `;
    return span;
}


async function loadUsersFromSession(syncData, user_list = []) {
    const sessionUser = await window.electronAPI.getSessionUser();

    if (sessionUser) {
        user_list.push({
            id: sessionUser.id,
            name: `${sessionUser.first_name} ${sessionUser.last_name}`,
            profile_image: `${sessionUser.profile_image}`,
            active: true
        });
    }

    renderUsers(syncData, user_list);
}

async function SessionLogout() {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('user_data');
    localStorage.removeItem('customer_data');
    localStorage.removeItem('domain_data');
    const clearSessionData = await window.electronAPI.clearSession();
    return clearSessionData;
};

function setSyncDone() {
    document.getElementById("sync-indicator").className = "sync-dot green";
    document.getElementById("sync-text").innerText = "Sync Enabled · Up to date";

    const icon = document.getElementById("sync-icon");
    icon.className = "fas fa-check-circle";
}

/* --------------------------
HELPERS
---------------------------*/
function showResults() {
    searchResults.style.display = "block";
}

function hideResults() {
    searchResults.style.display = "none";
    searchResults.innerHTML = "";
}

function performFuzzySearch(query) {
    const q = query.toLowerCase();

    let results = normalizedPaths
        .filter(path => fuzzyMatch(path.toLowerCase(), q))
        .sort((a, b) => a.split("/").length - b.split("/").length); // parent → child

    renderResults(results, q);
}

function fuzzyMatch(text, pattern) {
    let t = 0;
    for (let p = 0; p < pattern.length; p++) {
        t = text.indexOf(pattern[p], t);
        if (t === -1) return false;
        t++;
    }
    return true;
}


function highlightText(text, query) {
    const regex = new RegExp(`(${query})`, "ig");
    return text.replace(regex, `<span class="highlight">$1</span>`);
}

function viewFile(targetPath) {
    //const filePath = $(this).data("path");
    const filePath = targetPath;
    console.log(filePath);
    if (filePath.toLowerCase().endsWith(".pdf")) {
        openPDF(`file:///${filePath.replace(/\\/g, "/")}`, "PDF Preview");
    }
};

async function triggerSync(syncData, manual = false) {
    if (isSyncing) {
        console.log("⚠️ Sync already in progress, skipping...");
        if (manual) showValidation("Sync already in progress.", "warning");
        return;
    }

    isSyncing = true;
    console.log(manual ? "🔄 Manual sync started..." : "🔄 Auto sync started...");
    console.log(syncData);
    try {

        if (!customer_data || !domain_data || !user_data) {
            console.error("Missing customer or domain or User data !");
            return;
        }


        const result = await window.electronAPI.autoSync({
            customer_id: customer_data.id,
            domain_id: domain_data.id,
            apiUrl: apiUrl,
            syncData: syncData,
        });

        console.log(result.message);
        if (manual) showValidation(result.message, result.success ? 'success' : 'error');
    } catch (err) {
        console.error("❌ Sync failed:", err);
        if (manual) showValidation("Sync failed: " + err.message, 'error');
    } finally {
        isSyncing = false;
    }
}


function startAutoSync(syncData) {
    if (autoSyncInterval) clearInterval(autoSyncInterval); // avoid duplicates
    autoSyncInterval = setInterval(() => triggerSync(syncData, false), 2 * 60 * 1000);
}

function tick(ms = 16) {
    return new Promise(res => setTimeout(res, ms));
}

function showLoader() {
    $("#loader-overlay").removeClass("hidden");       // full-screen overlay
    $("#file-list .inline-loader").remove();          // remove any previous inline loader
    $("#file-list").append(`<div class="inline-loader" style="width:100%;text-align:center;padding:12px;">
        <div class="loader" style="display:inline-block;margin-bottom:6px"></div>
        <div>Loading files, please wait...</div>
    </div>`);
}

function hideLoader() {
    $("#loader-overlay").addClass("hidden");
    $("#file-list .inline-loader").remove();
}

function hideMiddleSection() {
    const selectedCount = $(".file-item.selected").length;
    if (selectedCount > 0) {
        $(".middle-section").removeClass("hidden");
    } else {
        $(".middle-section").addClass("hidden");
    }
}


async function loadFilesYes(dirPath, reset = false) {
    if (isLoading) return;
    isLoading = true;

    const targetDir = reset ? dirPath : currentDir;

    if (!targetDir || targetDir.trim() === "") {
        console.error("INVALID DIRECTORY PATH", targetDir);
        isLoading = false;
        return;
    }

    if (reset) {
        if (currentIndex === -1) {
            history = [targetDir];
            currentIndex = 0;

        } else if (history[currentIndex] !== targetDir) {

            // Prevent adding duplicates anywhere in history
            const alreadyExists = history.includes(targetDir);
            if (!alreadyExists) {

                // Remove forward history (browser style)
                history = history.slice(0, currentIndex + 1);

                history.push(targetDir);
                currentIndex++;
            } else {
                // If duplicate exists, jump to that index instead
                currentIndex = history.indexOf(targetDir);
            }
        }

        updateNavButtons();

        console.log("HISTORY UPDATE:", history, "Index:", currentIndex);

        loadedItems = 0;
        currentDir = targetDir;
        $("#file-list").empty();
        $("#breadcrumb").html(buildBreadcrumb(currentDir));
    }

    //await loadDriveItems(targetDir);

    const local_stored = localStorage.getItem("customer_data");

    if (local_stored) {
        customer_data = JSON.parse(localStorage.getItem("customer_data"));
        domain_data = JSON.parse(localStorage.getItem("domain_data"));
        user_data = JSON.parse(localStorage.getItem("user_data"));
    } else {
        customer_data = syncData.customer_data;
        domain_data = syncData.domain_data;
        user_data = syncData.user_data;
    }

    // Show loader and allow a paint before heavy work
    showLoader();
    await tick(); // give browser a frame to render loader

    try {
        console.log(`Loading files from: ${targetDir} (offset ${loadedItems})`);
        const result = await window.electronAPI.listRecurFiles(targetDir, loadedItems, BATCH_SIZE);

        if (result.error) {
            $("#file-list").html(`<p style="color:red">${result.error}</p>`);
            return;
        }

        totalItems = result.total;
        currentDir = result.currentPath;
        // if (reset) {
        //     $("#breadcrumb").html(buildBreadcrumb(currentDir));
        // }

        const res_icon = await fetch(apiUrl + '/api/folder-files-icons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_id: customer_data.id,
                domain_id: domain_data.id,
                user_id: user_data.id
            })
        });
        const iconMap = await res_icon.json();

        // Append batch of items
        result.items.forEach(item => {
            //const icon = getFileIcon(item.name, item.isDirectory);

            let icon = '';
            let iconHTML = '';
            let type = '';

            if (item.isDirectory) {
                // Use folder icon
                if (iconMap.data['folder'].type == 'path') {
                    icon = iconMap.data['folder'].value;
                }

                iconHTML = `<div class="file-icon">${iconMap.data['folder'].value}</div>`;
                type = 'folder';
            } else {
                // Extract file extension safely
                const parts = item.name.split('.');
                const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
                //console.log(item.path);
                // Find icon from Laravel map or use default
                type = 'file';
                if (iconMap.data && iconMap.data.hasOwnProperty(ext)) {
                    // Extension found in iconMap
                    const iconData = iconMap.data[ext];
                    if (iconData.type === 'path') {
                        iconHTML = `<img src="${iconData.value}" class="file-icon-img" alt="${ext} icon">`;
                    } else {
                        iconHTML = `${iconData.value}`;
                    }
                } else {
                    // Extension not found → use default
                    const defaultIcon = iconMap.data['default'];
                    if (defaultIcon.type === 'path') {
                        iconHTML = `<img src="${defaultIcon.value}" class="file-icon-img" alt="file icon">`;
                    } else {
                        iconHTML = `${defaultIcon.value}`;
                    }
                }

            }


            const menuHTML = type === "folder"
                ? `
                    <div class="menu-item" data-action="open">📂 Open Folder</div>
                    <div class="menu-item" data-action="delete">🗑 Delete</div>
                    <div class="menu-item" data-action="move">📁 Move</div>
                    <div class="menu-item" data-action="rename">✏️ Rename</div>
                `
                : `
                    <div class="menu-item" data-action="view">👁️ View</div>
                    <div class="menu-item" data-action="delete">🗑 Delete</div>
                    <div class="menu-item" data-action="move">📁 Move</div>
                    <div class="menu-item" data-action="rename">✏️ Rename</div>`;

            const isListView = $("#file-list").hasClass("list-view");
            const div = $(`
            <div class="file-item">
                ${isListView
                    ? `<div class="check-icon"></div>
                    <div class="file-icon">${iconHTML}</div>
                    <div class="file-name" title="${item.name}">${item.name}</div>
                    <div class="modified-by">${item.modified_by || "-"}</div>
                    <div class="modified-date">${item.modified_date || "-"}</div>
                    <div class="file-size">${item.size || "-"}</div>
                    <div class="share">${item.shared ? "🔗" : ""}</div>
                    <div class="file-menu-btn">⋮</div>
                    <div class="file-menu hidden" data-path="${item.path}" data-type="${type}">
                        ${menuHTML}
                    </div>
                    `
                    : `
                    
                    <div class="file-header">  
                        <div class="check-icon"></div>                      
                        <div class="file-icon">${iconHTML}</div>
                        <div class="file-name" title="${item.name}">${item.name}</div>
                    </div>                    
                    <div class="file-menu-btn">⋮</div>
                    <div class="file-menu hidden" data-path="${item.path}" data-type="${type}">
                        ${menuHTML}
                    </div>
                    `
                }
            </div>
            `);


            // open directory on name/icon click
            div.find(".file-name, .file-icon").on("dblclick", () => {
                if (item.isDirectory) loadFiles(item.path, true);
            });

            // div.find(".file-menu-btn").on("click", (e) => {
            //     e.stopPropagation();
            //     $(".file-menu").addClass("hidden");
            //     div.find(".file-menu").toggleClass("hidden");
            // });


            div.find(".file-menu .menu-item").on("click", (e) => {
                e.stopPropagation();

                const $menuItem = $(e.currentTarget);
                const action = $menuItem.data("action");

                // 👇 read from parent .file-menu
                const $menu = $menuItem.closest(".file-menu");
                const targetPath = $menu.data("path");
                const type = $menu.data("type");

                console.log('INDIA = > ' + targetPath);

                if (!targetPath) return;

                if (action === "open") openFolder(targetPath, type);
                if (action === "view") openPreview(targetPath, type);
                if (action === "delete") deleteFile(targetPath, type);
                if (action === "move") moveFile(targetPath, type);
                if (action === "rename") renameFile(targetPath, type);

                $menu.addClass("hidden");
            });

            $("#file-list").append(div);
        });

        loadedItems += result.items.length;
        hideMiddleSection();

        // If there are more items, append a "load more" button / sentinel
        // if (result.hasMore) {
        //     if ($("#file-list .load-more").length === 0) {
        //         $("#file-list").append(`<div class="load-more" style="width:100%;text-align:center;padding:10px;">
        //             <button id="loadMoreBtn">Load more</button>
        //         </div>`);
        //         $(document).on("click", "#loadMoreBtn", async () => {
        //             $("#loadMoreBtn").prop("disabled", true).text("Loading...");
        //             await loadFiles(dirPath, false);
        //             $("#loadMoreBtn").prop("disabled", false).text("Load more");
        //         });
        //     }
        // } else {
        //     $("#file-list .load-more").remove();
        // }

    } catch (err) {
        console.error("Error loading files:", err);
        $("#file-list").html(`<p style="color:red">${err.message}</p>`);
    } finally {
        $("#file-list")
            .removeClass("grid-view list-view")
            .addClass(currentView === "grid" ? "grid-view" : "list-view");
        hideLoader();
        isLoading = false;
    }
}

async function loadFiles(dirPath, reset = false, filterPath = null) {
    if (isLoading) return;
    isLoading = true;

    const targetDir = reset ? dirPath : currentDir;

    if (!targetDir || targetDir.trim() === "") {
        console.error("INVALID DIRECTORY PATH", targetDir);
        isLoading = false;
        return;
    }

    /* ---------------------------
       RESET / HISTORY HANDLING
    ----------------------------*/
    if (reset) {

        // 🔥 SET SEARCH FILTER (ONLY FROM SEARCH)
        activeSearchFilter = filterPath || null;

        if (currentIndex === -1) {
            history = [targetDir];
            currentIndex = 0;
        } else if (history[currentIndex] !== targetDir) {

            const existsIndex = history.indexOf(targetDir);
            if (existsIndex === -1) {
                history = history.slice(0, currentIndex + 1);
                history.push(targetDir);
                currentIndex++;
            } else {
                currentIndex = existsIndex;
            }
        }

        updateNavButtons();

        loadedItems = 0;
        currentDir = targetDir;
        $("#file-list").empty();
        $("#breadcrumb").html(buildBreadcrumb(currentDir));
    }

    /* ---------------------------
       LOAD USER CONTEXT
    ----------------------------*/
    const local_stored = localStorage.getItem("customer_data");

    if (local_stored) {
        customer_data = JSON.parse(localStorage.getItem("customer_data"));
        domain_data = JSON.parse(localStorage.getItem("domain_data"));
        user_data = JSON.parse(localStorage.getItem("user_data"));
    } else {
        customer_data = syncData.customer_data;
        domain_data = syncData.domain_data;
        user_data = syncData.user_data;
    }

    showLoader();
    await tick();

    try {
        const result = await window.electronAPI.listRecurFiles(
            targetDir,
            loadedItems,
            BATCH_SIZE
        );

        if (result.error) {
            $("#file-list").html(`<p style="color:red">${result.error}</p>`);
            updateFooterStatus(targetDir, { folderCount: 0, fileCount: 0, totalSizeFormatted: "0 B" });
            return;
        }

        totalItems = result.total;
        currentDir = result.currentPath;

        // Update footer with current breadcrumb and folder/file properties
        updateFooterStatus(currentDir, result);

        const res_icon = await fetch(apiUrl + "/api/folder-files-icons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                customer_id: customer_data.id,
                domain_id: domain_data.id,
                user_id: user_data.id
            })
        });

        const iconMap = await res_icon.json();

        /* ---------------------------
           RENDER ITEMS
        ----------------------------*/
        result.items.forEach(item => {

            /* 🔍 SEARCH FILTER LOGIC */

            if (activeSearchFilter) {
                const filterNorm = activeSearchFilter.replace(/\\/g, "/");
                const itemNorm = item.path.replace(/\\/g, "/");
                const filterName = filterNorm.split("/").pop();

                // Folder search → show folder + children
                if (
                    itemNorm === filterNorm ||
                    itemNorm.startsWith(filterNorm + "/")
                ) {
                    // allowed
                }
                // File search → show only that file
                else if (item.name === filterName) {
                    // allowed
                }
                else {
                    return;
                }
            }

            let iconHTML = "";
            let type = item.isDirectory ? "folder" : "file";

            if (item.isDirectory) {
                iconHTML = iconMap.data.folder.value;
            } else {
                const ext = item.name.split(".").pop().toLowerCase();
                const iconData = iconMap.data[ext] || iconMap.data.default;

                iconHTML = iconData.type === "path"
                    ? `<img src="${iconData.value}" class="file-icon-img">`
                    : iconData.value;
            }

            const menuHTML = type === "folder"
                ? `
                    <div class="menu-item" data-action="open">📂 Open Folder</div>
                    <div class="menu-item" data-action="delete">🗑 Delete</div>
                    <div class="menu-item" data-action="move">📁 Move</div>
                    <div class="menu-item" data-action="rename">✏️ Rename</div>
                `
                : `
                    <div class="menu-item" data-action="view">👁️ View</div>
                    <div class="menu-item" data-action="delete">🗑 Delete</div>
                    <div class="menu-item" data-action="move">📁 Move</div>
                    <div class="menu-item" data-action="rename">✏️ Rename</div>
                `;


            const isListView = $("#file-list").hasClass("list-view");

            const div = $(`
            <div class="file-item">
                ${isListView
                    ? `<div class="check-icon"></div>
                    <div class="file-icon">${iconHTML}</div>
                    <div class="file-name" title="${item.name}">${item.name}</div>
                    <div class="modified-by">${item.modified_by || "-"}</div>
                    <div class="modified-date">${item.modified_date || "-"}</div>
                    <div class="file-size">${item.size || "-"}</div>
                    <div class="share">${item.shared ? "🔗" : ""}</div>
                    <div class="file-menu-btn">⋮</div>
                    <div class="file-menu hidden" data-path="${item.path}" data-type="${type}">
                        ${menuHTML}
                    </div>
                    `
                    : `
                    
                    <div class="file-header">  
                        <div class="check-icon"></div>                      
                        <div class="file-icon">${iconHTML}</div>
                        <div class="file-name" title="${item.name}">${item.name}</div>
                    </div>                    
                    <div class="file-menu-btn">⋮</div>
                    <div class="file-menu hidden" data-path="${item.path}" data-type="${type}">
                        ${menuHTML}
                    </div>
                    `
                }
            </div>
            `);

            /* ---------------------------
               EVENTS
            ----------------------------*/
            div.find(".file-name, .file-icon").on("dblclick", () => {
                activeSearchFilter = null; // 🔥 exit search mode
                if (item.isDirectory) loadFiles(item.path, true);
            });

            div.find(".menu-item").on("click", e => {
                const action = $(e.currentTarget).data("action");
                const path = item.path;

                if (action === "open") loadFiles(path, true);
                if (action === "view") openPreview(path, type);
                if (action === "delete") deleteFile(path, type);
                if (action === "move") moveFile(path, type);
                if (action === "rename") renameFile(path, type);
            });

            $("#file-list").append(div);
        });

        loadedItems += result.items.length;
        hideMiddleSection();

    } catch (err) {
        console.error(err);
        $("#file-list").html(`<p style="color:red">${err.message}</p>`);
    } finally {
        $("#file-list")
            .removeClass("grid-view list-view")
            .addClass(currentView === "grid" ? "grid-view" : "list-view");

        hideLoader();
        isLoading = false;
    }
}


function getFileIcon(fileName, isDirectory) {
    if (isDirectory) return "📁";

    const ext = fileName.split('.').pop().toLowerCase();

    switch (ext) {
        case 'pdf': return "📕";
        case 'doc':
        case 'docx': return "📝";
        case 'xls':
        case 'xlsx': return "📊";
        case 'ppt':
        case 'pptx': return "📈";
        case 'zip':
        case 'rar':
        case '7z': return "🗜️";
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'bmp': return "🖼️";
        case 'txt': return "📄";
        case 'mp3':
        case 'wav': return "🎵";
        case 'mp4':
        case 'mkv':
        case 'avi': return "🎬";
        default: return "📄";
    }
}

function buildBreadcrumb1(fullPath) {
    const parts = fullPath.split(/[\\/]+/).filter(Boolean);

    return parts.map((p, i) => {
        // For first breadcrumb → data-path="#"
        const subPath = i === 0
            ? "#"
            : parts.slice(0, i + 1).join("\\") + "\\";

        return `<span class="crumb" data-path="${subPath}">${p}</span>`;
    }).join(" › ");
}

function buildBreadcrumbold(fullPath) {
    if (!fullPath) return "";

    // Normalize path
    const normalized = fullPath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);

    return parts.map((p, i) => {
        const subPath = parts.slice(0, i + 1).join("/");

        return `
            <span class="crumb" data-path="${subPath}">
                ${p}
            </span>
        `;
    }).join(" › ");
}


function buildBreadcrumb(fullPath) {
    if (!fullPath) return "";

    // Normalize slashes
    const normalized = fullPath.replace(/\\/g, "/");

    const isMacRoot = normalized.startsWith("/");

    // Split WITHOUT losing root
    const parts = normalized.split("/").filter(p => p !== "");

    // 👉 Skip logic
    let startIndex = 0;
    if (isMacRoot) {
        startIndex = 2; // skip first two on mac/linux
    } else {
        startIndex = 1; // skip first on windows
    }

    return parts
        .slice(startIndex)
        .map((p, i) => {

            let subPath;

            if (isMacRoot) {
                // macOS/Linux: keep leading slash
                subPath = "/" + parts.slice(0, startIndex + i + 1).join("/");
            } else {
                // Windows: drive letter path
                subPath = parts.slice(0, startIndex + i + 1).join("/");
            }

            return `
                <span class="crumb" data-path="${subPath}">
                    ${p}
                </span>
            `;
        })
        .join(" › ");
}

function buildFooterBreadcrumb(fullPath) {
    if (!fullPath) return '<span class="crumb" data-path="#">My Drive</span>';

    const normalized = fullPath.replace(/\\/g, "/");
    const isMacRoot = normalized.startsWith("/");
    const parts = normalized.split("/").filter(p => p !== "");

    if (parts.length === 0) {
        return `<span class="crumb" data-path="${fullPath}">My Drive</span>`;
    }

    const crumbs = [];

    // Root crumb
    let rootPath = isMacRoot ? "/" + parts.slice(0, 2).join("/") : parts[0] + "/";
    crumbs.push(`<span class="crumb" data-path="${rootPath}" title="${rootPath}">My Drive</span>`);

    let startIndex = isMacRoot ? 2 : 1;
    for (let i = startIndex; i < parts.length; i++) {
        let subPath = isMacRoot
            ? "/" + parts.slice(0, i + 1).join("/")
            : parts.slice(0, i + 1).join("/");
        crumbs.push(`<span class="crumb" data-path="${subPath}" title="${subPath}">${parts[i]}</span>`);
    }

    return crumbs.join(" › ");
}

function updateFooterStatus(dirPath, result = {}) {
    const breadcrumbContainer = document.getElementById("footerBreadcrumbContent");
    if (breadcrumbContainer) {
        breadcrumbContainer.innerHTML = buildFooterBreadcrumb(dirPath);
    }

    let folderCount = result.folderCount;
    let fileCount = result.fileCount;
    let totalSizeFormatted = result.totalSizeFormatted;

    // Fallback if result.items is available
    if (folderCount === undefined && Array.isArray(result.items)) {
        folderCount = result.items.filter(i => i.isDirectory).length;
        fileCount = result.items.filter(i => !i.isDirectory).length;
    }

    folderCount = folderCount !== undefined ? folderCount : 0;
    fileCount = fileCount !== undefined ? fileCount : 0;
    totalSizeFormatted = totalSizeFormatted || "0 B";

    const foldersEl = document.querySelector("#footerFoldersCount .val");
    if (foldersEl) {
        foldersEl.textContent = `${folderCount} ${folderCount === 1 ? 'Folder' : 'Folders'}`;
    }

    const filesEl = document.querySelector("#footerFilesCount .val");
    if (filesEl) {
        filesEl.textContent = `${fileCount} ${fileCount === 1 ? 'File' : 'Files'}`;
    }

    const sizeEl = document.querySelector("#footerTotalSize .val");
    if (sizeEl) {
        sizeEl.textContent = totalSizeFormatted;
    }
}

let rootDriveProperties = null;
let isLoadingDriveProperties = false;

async function loadRootDriveProperties() {
    if (isLoadingDriveProperties) return;
    try {
        if (!window.electronAPI || !window.electronAPI.getDriveProperties) return;
        isLoadingDriveProperties = true;
        const config = await window.electronAPI.getAppConfig();
        const rootPath = config ? config.drivePath : null;
        const props = await window.electronAPI.getDriveProperties(rootPath);
        if (props) {
            rootDriveProperties = props;
            renderDrivePropertiesPopup(props);
        }
    } catch (err) {
        console.error("loadRootDriveProperties error:", err);
    } finally {
        isLoadingDriveProperties = false;
    }
}

function renderDrivePropertiesPopup(props) {
    if (!props) return;
    const titleEl = document.getElementById("propPopupTitle");
    const pathEl = document.getElementById("propRootPath");
    const foldersEl = document.getElementById("propFoldersCount");
    const filesEl = document.getElementById("propFilesCount");
    const sizeEl = document.getElementById("propTotalSize");

    if (titleEl) titleEl.textContent = "Centris-Drive";
    if (pathEl) {
        pathEl.textContent = props.rootPath || "Centris-Drive";
        pathEl.title = props.rootPath || "";
    }
    if (foldersEl) foldersEl.textContent = `${(props.folderCount || 0).toLocaleString()} ${props.folderCount === 1 ? 'Folder' : 'Folders'}`;
    if (filesEl) filesEl.textContent = `${(props.fileCount || 0).toLocaleString()} ${props.fileCount === 1 ? 'File' : 'Files'}`;
    if (sizeEl) sizeEl.textContent = props.totalSizeFormatted || "0 B";
}

// --- Render File List ---
function renderFileList(selector, files) {
    const container = $(selector);
    container.empty();
    if (!files || files.length === 0) {
        container.append('<li>No files found</li>');
        return;
    }
    files.forEach(f => container.append(`<li>${f.file_name}</li>`));
}

function renderTree(containerSelector, files) {
    const container = $(containerSelector);
    container.empty();

    function createTreeNode(data) {
        if (data.folder_id === null) {
            return `<li><span class="file">${data.file_name}</span></li>`;
        } else if (data.folder_id !== null) {
            const childrenHTML = data.children ? data.children.map(createTreeNode).join('') : '';
            return `
                <li>
                    <span class="folder">${data.file_name}</span>
                    <ul>${childrenHTML}</ul>
                </li>
            `;
        }
    }

    const html = files.map(createTreeNode).join('');
    container.append(html);

    // Optional: toggle folder expand/collapse
    container.find('.folder').click(function (e) {
        e.stopPropagation();
        $(this).siblings('ul').slideToggle();
        $(this).toggleClass('expanded');
    });

    // hide all subfolders initially
    container.find('ul').hide();
}

function updateNavButtons() {
    const backBtn = document.getElementById("back-btn");
    const forwardBtn = document.getElementById("forward-btn");

    // Nothing in history → disable both
    if (history.length === 0 || currentIndex === -1) {
        backBtn.disabled = true;
        forwardBtn.disabled = true;
        return;
    }

    // Back is disabled if already at first item
    backBtn.disabled = currentIndex <= 0;

    // Forward disabled if at last item
    forwardBtn.disabled = currentIndex >= history.length - 1;
}

async function loadDriveItems(path, fromHistory = false, filterPath = null) {
    if (!path) return;

    currentDir = path;

    // LOAD DIRECTORY
    await loadFiles(path, true, filterPath);

    if (!fromHistory) {

        // Remove future history positions
        history = history.slice(0, currentIndex + 1);

        // 🚫 Prevent duplicates
        if (history[history.length - 1] !== path) {
            history.push(path);
            currentIndex = history.length - 1;
        }
    }

    updateNavButtons();
}

async function initFirstPath(path) {
    if (!path) return;

    history.push(path);
    currentIndex = 0;
    currentDir = path;
}

function openFolder(targetPath, type) {
    if (targetPath) loadFiles(targetPath, true);
}

function openPreview(filePath, type) {

    const ext = filePath.split(".").pop().toLowerCase();

    const previewPanel = document.getElementById("preview-panel");
    //const canvas = document.getElementById("pdfPreviewCanvas");
    const pdfContainer = document.getElementById("pdfViewerFrame");
    const officePreview = document.getElementById("officePreview");

    // Reset state
    previewPanel.classList.remove("hidden");
    //canvas.style.display = "none";
    officePreview.classList.add("hidden");
    console.log(ext);
    if (ext === "pdf") {
        // 🔹 PDF → canvas
        //canvas.style.display = "block";
        pdfContainer.innerHTML = "";          // clear previous PDF pages
        pdfContainer.classList.remove("hidden");
        openPDF(filePath);
    } else if (["xls", "xlsx", "doc", "docx", "ppt", "pptx", "csv", "zip", "rar", "gz", "cad", "txt"].includes(ext)) {
        // 🔹 Office → placeholder
        officePreview.classList.remove("hidden");
        pdfContainer.classList.add("hidden");

        document.getElementById("officeFileName").textContent =
            filePath.split("/").pop();

        //$("#officeFileName").text(filePath.split("/").pop());
        $("#officeFileType").text("View only");

        setOfficeIcon(ext);

        document.getElementById("openOfficeBtn").onclick = () => {
            window.electronAPI.openExternalFile(filePath);
        };
    } else {
        // 🔹 Fallback
        window.electronAPI.openExternalFile(filePath);
    }
}

async function deleteFile(targetPath, type) {
    if (!targetPath) return;

    const confirmDelete = confirm(
        type === "folder"
            ? "Delete this folder and all its contents?"
            : "Delete this file?"
    );

    if (!confirmDelete) return;

    const result = await window.electronAPI.deleteItem({
        path: targetPath,
        type
    });

    if (result.success) {
        showValidation("Deleted successfully", "success");
        setTimeout(() => {
            loadDriveItems(history[currentIndex], true);
        }, 3000);
        // refresh UI here if needed
    } else {
        alert("Delete failed: " + result.error);
    }
}


function setOfficeIcon(ext) {
    const icon = document.getElementById("officeIcon");

    icon.className = "fas";

    if (ext === "xls" || ext === "xlsx") {
        icon.classList.add("fa-file-excel");
    } else if (ext === "doc" || ext === "docx") {
        icon.classList.add("fa-file-word");
    } else if (ext === "ppt" || ext === "pptx") {
        icon.classList.add("fa-file-powerpoint");
    } else {
        icon.classList.add("fa-file");
    }
}

async function deleteSelectedItems() {
    const selectedItems = document.querySelectorAll(".file-item.selected");

    if (selectedItems.length === 0) {
        alert("No items selected");
        return;
    }

    let deletedCount = 0;
    for (const item of selectedItems) {
        const menu = item.querySelector(".file-menu");

        if (!menu) continue;

        const targetPath = menu.dataset.path;
        const type = menu.dataset.type; // "file" or "folder"

        try {
            const result = await window.electronAPI.deleteItem({
                path: targetPath,
                type: type
            });

            if (result.success) {
                // Remove from UI after successful delete
                deletedCount++;
                item.remove();
            } else {
                console.error("Delete failed:", result.error);
            }
        } catch (err) {
            console.error("IPC error:", err);
        }
    }

    if (deletedCount > 0) {
        const message =
            deletedCount === 1
                ? "1 item deleted successfully."
                : deletedCount + " items deleted successfully.";

        showValidation(message, "success");
        setTimeout(() => {
            loadDriveItems(history[currentIndex], true);
        }, 3000);
        // refresh UI here if needed
    } else {
        alert("Delete failed: " + result.error);
    }
}

function renderFileList1(container, files) {
    container.innerHTML = "";
    if (files.error) {
        container.innerHTML = `<li style="color:red;">${files.error}</li>`;
        return;
    }
    files.forEach(f => {
        const li = document.createElement("li");
        li.textContent = f;
        container.appendChild(li);
    });
}

function getFileIcon1(fileName, isDirectory) {
    if (isDirectory) return "<img src='assets/icons/folder.png' width='28'>";
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        pdf: "pdf.png",
        doc: "word.png",
        docx: "word.png",
        xls: "excel.png",
        xlsx: "excel.png",
        ppt: "ppt.png",
        pptx: "ppt.png",
        zip: "zip.png",
        rar: "zip.png",
        '7z': "zip.png",
        jpg: "image.png",
        jpeg: "image.png",
        png: "image.png",
        gif: "image.png",
        mp3: "audio.png",
        wav: "audio.png",
        mp4: "video.png",
        mkv: "video.png",
    };
    const iconFile = iconMap[ext] || "file.png";
    return `<img src='assets/icons/${iconFile}' width='28'>`;
}

async function setupDrive() {
    console.log("⏳ Creating and mounting VHDX...");

    const drivePath = await window.vhdx.create();  // IPC call to main → admin PowerShell

    if (!drivePath) {
        alert("Failed to create/mount VHDX drive.");
        return;
    }

    console.log("✅ Drive Mounted At:", drivePath);
    alert("Drive mounted at: " + drivePath);
}

function getIconHTMLForItem(item, iconMap) {
    // 📂 Folder
    if (item.isDirectory) {
        const folderIcon = iconMap.data.folder;
        return folderIcon.type === "path"
            ? `<img src="${folderIcon.value}" class="file-icon-img" alt="folder">`
            : folderIcon.value;
    }

    // 📄 File
    const parts = item.name.split(".");
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : "default";

    const iconData = iconMap.data[ext] || iconMap.data.default;

    return iconData.type === "path"
        ? `<img src="${iconData.value}" class="file-icon-img" alt="${ext}">`
        : iconData.value;
}


async function renderResults(results, query) {
    const config = await window.electronAPI.getAppConfig();
    console.log(config);
    syncData = await window.electronAPI.getSyncData();
    //startAutoSync(syncData);
    //await window.electronAPI.getMappedDrive();//
    let currentDir = config.drivePath;

    const container = document.getElementById("searchResults");
    container.innerHTML = "";

    if (!results.length) {
        hideResults();
        return;
    }

    //${buildBreadcrumb(currentDirectory)}

    const res_icon = await fetch(apiUrl + '/api/folder-files-icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customer_id: customer_data.id,
            domain_id: domain_data.id,
            user_id: user_data.id
        })
    });
    const iconMap = await res_icon.json();

    results.forEach(fullPath => {
        const normalized = fullPath.replace(/\\/g, "/");
        const parts = normalized.split("/");
        const name = parts.pop();
        const parent = parts.join("/");
        const depth = parts.length;

        const currentDirectory = currentDir + '/' + parent;
        const currentnormalized = currentDir + '/' + normalized;

        const isFileItem = isFile(name);

        const item = document.createElement("div");
        item.className = "search-item";

        const itemData = {
            name,
            isDirectory: !isFileItem
        };

        const iconHTML = getIconHTMLForItem(itemData, iconMap);

        item.innerHTML = `
        <div class="search-row">
            <div class="search-icon">
                ${iconHTML}
            </div>
            <div class="search-text">
                <div class="search-name">
                    ${highlightText(name, query)}
                </div>
                <div class="search-path" data-name="${name}">
                    ${currentnormalized}
                </div>
            </div>
        </div>
    `;

        // ✅ Navigate on click
        // item.addEventListener("click", () => {

        //     const openDir = isFileItem
        //     ? currentDirectory      // 👈 parent folder
        //     : currentnormalized;    // 👈 folder itself

        //     const filterPath = isFileItem
        //         ? currentnormalized     // 👈 file path
        //         : null;                 // 👈 show full folder
        //         loadDriveItems(openDir,false,filterPath);
        //         hideResults();
        // });

        item.addEventListener("click", (e) => {

            // 👉 Get real name from DOM (not partial query)
            const realName = item.querySelector(".search-path")?.dataset.name;

            // 👉 Put full name into search input
            const searchInput = document.getElementById("searchInput");
            if (searchInput && realName) {
                searchInput.value = realName;
            }

            let openDir;
            let filterPath = null;

            if (isFileItem) {
                openDir = currentDirectory;
                filterPath = currentnormalized;
            } else {
                openDir = currentnormalized;
            }

            loadDriveItems(openDir, false, filterPath);
            hideResults();
        });

        container.appendChild(item);
    });

    container.style.display = "block";
}

function isFile(name) {
    return /\.[a-z0-9]+$/i.test(name);
}

function updateUI2({ enabled, online, server = true }) {
    sync_toggle.checked = enabled;
    if (!enabled) {
        sync_indicator.className = "sync-dot red";
        sync_text.innerText = "Sync Disabled";
        sync_icon.classList.remove("syncing");
        return;
    }

    if (!online) {
        sync_indicator.className = "sync-dot orange";
        sync_text.innerText = "Offline · Waiting for connection";
        sync_icon.classList.remove("syncing");
        return;
    }

    // 🔥 NEW CONDITION
    if (!server) {
        sync_indicator.className = "sync-dot orange";
        sync_text.innerText = "Server Unreachable · Waiting";
        sync_icon.classList.remove("syncing");
        return;
    }

    sync_indicator.className = "sync-dot green";
    sync_text.innerText = "Sync Enabled · Up to date";
    sync_icon.classList.remove("syncing");
}

async function updateUI({ enabled, online, server = true, syncData }) {
    sync_toggle.checked = enabled;

    // -----------------------
    // SYNC DISABLED
    // -----------------------
    if (!enabled) {
        sync_indicator.className = "sync-dot red";
        sync_text.innerText = "Sync Disabled";
        sync_icon.classList.remove("syncing");
        return;
    }

    // -----------------------
    // OFFLINE
    // -----------------------
    if (!online) {
        sync_indicator.className = "sync-dot orange";
        sync_text.innerText = "Offline · Waiting for connection";
        sync_icon.classList.remove("syncing");
        return;
    }

    // -----------------------
    // SERVER DOWN
    // -----------------------
    if (!server) {
        sync_indicator.className = "sync-dot orange";
        sync_text.innerText = "Server Unreachable · Waiting";
        sync_icon.classList.remove("syncing");
        return;
    }

    // -----------------------
    // SYNC ENABLED (SHOW LAST SYNC TIME)
    // -----------------------
    let lastSyncAt = 0;

    try {
        if (syncData) {
            lastSyncAt = await window.electronAPI.getSettingFromDB(syncData, 'last_sync_at', 0);
        }
    } catch (e) {
        console.error('❌ Failed to read last_sync_at', e);
    }

    let text = "Sync Enabled · Up to date";

    if (lastSyncAt && lastSyncAt > 0) {
        const formatted = formatUnixTimestamp(lastSyncAt);
        text = `Sync Enabled · Last sync: ${formatted}`;
    } else {
        text = "Sync Enabled · Never synced";
    }

    sync_indicator.className = "sync-dot green";
    sync_text.innerText = text;
    sync_icon.classList.remove("syncing");
}


function formatUnixTimestamp(ts) {
    if (!ts || ts <= 0) return 'Never';

    const d = new Date(ts * 1000);

    return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}


async function checkServer(syncEnabled, online, syncData) {
    try {
        const res = await fetch(`${apiUrl}/api/ping`, {
            method: "GET",
            headers: { "Accept": "application/json" },
            cache: "no-store"
        });

        if (!res.ok) throw new Error("Server not reachable");

        const data = await res.json();

        updateUI({
            enabled: syncEnabled,
            online: online,
            server: true,
            serverTime: data.data?.server_time,
            syncData: syncData
        });

    } catch (err) {
        updateUI({
            enabled: syncEnabled,
            online: online,
            server: false,
            syncData: syncData
        });
    }
}


function startPing(syncData) {
    if (pingInterval) return;

    pingInterval = setInterval(() => {
        checkServer(sync_toggle.checked, navigator.onLine, syncData);
    }, 15_000);
}

function stopPing() {
    clearInterval(pingInterval);
    pingInterval = null;
}







