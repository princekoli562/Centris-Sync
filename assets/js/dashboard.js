
const BATCH_SIZE = 500; // how many files to show per scroll
let allItems = [];
let visibleCount = 0;

let totalItems = 0;
let loadedItems = 0;
let isLoading = false;

let currentView = "grid";

const customer_data = JSON.parse(localStorage.getItem('customer_data'));
const domain_data = JSON.parse(localStorage.getItem('domain_data'));
const apiUrl = localStorage.getItem('apiUrl');
let syncData = JSON.parse(localStorage.getItem('config_data'));
const progressContainer = document.getElementById('syncProgressContainer');
const progressLabel = document.getElementById('syncProgressLabel');
const progressBar = document.getElementById('syncProgressBar');
progressContainer.style.display = 'block';
let isSyncing = false;
let autoSyncInterval = null;

if (customer_data && domain_data) {
   
    syncData = { ...syncData, customer_name:customer_data.customer_name, domain_name: domain_data.domain_name };
    console.log(syncData);
    startAutoSync();
   
    // setInterval(async () => {
    //     if (isSyncing) {
    //         console.log("⚠️ Sync already in progress, skipping this interval...");
    //         return;
    //     }

    //     isSyncing = true;
    //     console.log("🔄 Starting sync...");

    //     try {
    //         await window.electronAPI.autoSync({
    //                 customer_id: customer_data.id,
    //                 domain_id: domain_data.id,
    //                 apiUrl: apiUrl,
    //                 syncData: syncData

    //         });
    //         console.log("✅ Sync completed successfully");
    //     } catch (err) {
    //         console.error("❌ Sync failed:", err);
    //     } finally {
    //         isSyncing = false; // Always reset flag after completion
    //     }
    // }, 2 * 60 * 1000);
}

// window.electronAPI.onSyncProgress(({ done, total, file }) => {
//     const percent = Math.round((done / total) * 100);
//     progressBar.value = percent;
//     progressLabel.textContent = `Syncing... ${percent}% (${done}/${total})`;

//     if (percent === 100) {
//         progressLabel.textContent = '✅ Sync complete!';
//     }
// });

// window.electronAPI.onSyncProgress((_event, data) => {
//     const { done, total } = data;
//     const percent = Math.round((done / total) * 100);

//     progressContainer.style.display = 'block';
//     progressBar.value = percent;
//     progressLabel.textContent = `Syncing... ${percent}% (${done}/${total})`;

//     if (percent >= 100) {
//         progressLabel.textContent = '✅ Sync complete!';
//     }
// });

window.electronAPI.onSyncProgress(({ done, total, file }) => {
  const percent = Math.round((done / total) * 100);
  progressBar.value = percent;
  progressLabel.textContent = `Syncing... ${percent}% (${done}/${total})`;
  if (percent === 100) progressLabel.textContent = '✅ Sync complete!';
});

// window.electronAPI.onSyncProgress(({ done, total, file }) => {
//   const percent = Math.round((done / total) * 100);
//   const progressBar = document.getElementById('syncProgressBar');
//   const progressLabel = document.getElementById('syncProgressLabel');

//   progressBar.value = percent;
//   progressLabel.textContent = `Syncing... ${percent}% (${done}/${total})`;
// });

window.electronAPI.onSyncStatus((_event, statusMsg) => {
    console.log("📦 Sync status:", statusMsg);
});

// Apply initial class
$("#file-list").addClass("grid-view");

document.addEventListener('DOMContentLoaded', async () => {
    const config = await  window.electronAPI.getAppConfig();
    console.log(config);


    let currentDir = config.drivePath;
     // Tab switching
    window.secret_key = localStorage.getItem('secret_key');
    window.secret_gen_key = localStorage.getItem('secret_gen_key');
    window.apiUrl = localStorage.getItem('apiUrl');
    

    var apiUrl = window.apiUrl;
    var secret_gen_key = window.secret_gen_key;
    var secret_key = window.secret_key;

    console.log("API URL:", apiUrl);
    console.log("Secret key:", secret_key);
    

    $(".sidebar .btnload").removeClass("active");
    $("#openDrive").addClass("active");

    // 🔹 Optionally trigger loadFiles for the default directory
    await loadFiles(currentDir);
    
    $(document).on("click",".tab",function(e) {
        const tab = $(this).data('tab');
        $('.tab').removeClass('active');
        $(this).addClass('active');
        $('.tab-content').removeClass('active');
        $('#' + tab).addClass('active');
    });

      // --- Local Files ---
    
    $(document).on("click","#chooseFolder",async function(e) {
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
        } catch(err) {
            console.error('Sync Error:', err);
        }
    });

      // --- Remote Files ---
     
    $(document).on("click","#loadRemote",async function(e) {
        const remoteList = $('#remoteFileList');
        remoteList.html('<li>Loading...</li>');
        console.log(secret_key);
        console.log(apiUrl);
        if(apiUrl.length <= 0) {
            console.log("invalid secret key provided");
            return false;
        }
        try {
          const res = await fetch(apiUrl +'/api/getFiles');
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          const data = await res.json();
          renderTree('#remoteFileList', data);
        } catch(err) {
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
        await loadFiles(currentDir);
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

   
    $(document).on("click", "#uploadFolderOption", async function () {
        try {
            $(".upload-menu").removeClass("show");

            var customer_data = JSON.parse(localStorage.getItem('customer_data'));
            var domain_data = JSON.parse(localStorage.getItem('domain_data'));

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

            const result = await window.electronAPI.uploadFolderToDrive(folderPath, mappedDrive);

            if (!result.success) {
                alert("Error uploading: " + result.error);
                return;
            }

           // alert("Folder uploaded successfully!");
            showValidation("The folder and files have been uploaded to Centris Local Drive successfully.", 'success');
            console.log(folderPath);
            console.log(mappedDrive);
            loadFiles(mappedDrive, true);
            await wait(2000);

            showValidation("Syncing files to Centris Local Drive. Please wait...", 'info',0);
        
           // const filesTree = await window.electronAPI.listFilesRecursively(mappedDrive);
           // console.log("File Tree:", filesTree);

            const res = await fetch(`${apiUrl}/api/sync-folders-and-files`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer_id: customer_data.id,
                    domain_id: domain_data.id,
                    root_path: folderPath
                })
            });

            const newSnapshot = await window.electronAPI.getDirectorySnapshot(mappedDrive);
            const saveShots  = await window.electronAPI.saveTracker(newSnapshot);

            const data = await res.json();
            console.log("Sync Result:", data);
            await wait(2000);
          
            showValidation(data.message, 'success');
    
        } catch (err) {
            console.error("Upload or Sync Error:", err);
            showValidation("An error occurred: " + err.message , 'error');
        }
    });

    // document.getElementById('grid-view').addEventListener('click', function() {
    //     this.classList.add('active');
    //     document.getElementById('list-view').classList.remove('active');
    //     // your logic to switch to grid view
    // });

    // document.getElementById('list-view').addEventListener('click', function() {
    //     this.classList.add('active');
    //     document.getElementById('grid-view').classList.remove('active');
    //     // your logic to switch to list view
    // });
    

    $(document).on("click", "#uploadFileOption", async function () {
        try {
            $(".upload-menu").removeClass("show");
            const customer_data = JSON.parse(localStorage.getItem('customer_data'));
            const domain_data = JSON.parse(localStorage.getItem('domain_data'));

            const filePaths = await window.electronAPI.openFiles(); // now returns array
            if (!filePaths || filePaths.length === 0) return alert("No files selected.");

            let mappedDrive;
            const crumbs = document.querySelectorAll('#breadcrumb .crumb');
            if (crumbs.length > 0) {
                mappedDrive = crumbs[crumbs.length - 1].getAttribute('data-path');
            } else {
                mappedDrive = await window.electronAPI.getMappedDrive();
            }

            if (!confirm(`Upload ${filePaths.length} file(s) to ${mappedDrive}?`)) return;

            const result = await window.electronAPI.uploadFileToDrive(filePaths, mappedDrive);
            if (result.success) {
                showValidation("The files have been uploaded to Centris Local Drive successfully.", 'success');
                loadFiles(mappedDrive, true);
            } else {
                alert("Error uploading: " + result.error);
            }
            console.log(filePaths);
            await wait(2000);
            showValidation("Syncing files to Centris Local Drive. Please wait...", 'info');

            const res = await fetch(`${apiUrl}/api/sync-files`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    customer_id: customer_data.id,
                    domain_id: domain_data.id,
                    files: filePaths  // send all files for sync
                })
            });

            const data = await res.json();
            console.log("Sync Result:", data);

            await wait(2000);
            showValidation(data.message, 'success');

        } catch (err) {
            console.error("Upload or Sync Error:", err);
            showValidation("An error occurred: " + err.message, 'error');
        }
    });

    $("#grid-view").on("click",async function() {
        currentView = "grid";
        $("#file-list").empty();
        $("#list-view").removeClass("active");
        $(this).addClass("active");
        $("#file-list").removeClass("list-view").addClass("grid-view");
        $("#file-list-header").addClass("hidden"); 
        var  mappedDrive = await window.electronAPI.getMappedDrive();
        const crumbs = document.querySelectorAll('#breadcrumb .crumb');
        if (crumbs.length > 0) {
            const lastCrumb = crumbs[crumbs.length - 1];
            mappedDrive = lastCrumb.getAttribute('data-path');
            console.log("mappedDrive path:", mappedDrive);
        }else{
            // Get mapped drive dynamically
            mappedDrive = await window.electronAPI.getMappedDrive();    
        }
        await loadFiles(mappedDrive,true);       
    });

    $("#list-view").on("click",async function() {
        currentView = "list";
        $("#file-list").empty();
        $("#grid-view").removeClass("active");
        $(this).addClass("active");
        $("#file-list").removeClass("grid-view").addClass("list-view");
        $("#file-list-header").removeClass("hidden");
        var  mappedDrive = await window.electronAPI.getMappedDrive();
        const crumbs = document.querySelectorAll('#breadcrumb .crumb');
        if (crumbs.length > 0) {
            const lastCrumb = crumbs[crumbs.length - 1];
            mappedDrive = lastCrumb.getAttribute('data-path');
            console.log("mappedDrive path:", mappedDrive);
        }else{
            // Get mapped drive dynamically
            mappedDrive = await window.electronAPI.getMappedDrive();    
        }
        await loadFiles(mappedDrive,true);
    });

    // $(document).on("click", "#SyncDrive", async function () {
    //     const btn = $(this);
    //     btn.prop("disabled", true);
    //     btn.html('<i class="bi bi-arrow-repeat spin"></i> Syncing...');
    //     const customer_data = JSON.parse(localStorage.getItem("customer_data"));
    //     const domain_data = JSON.parse(localStorage.getItem("domain_data"));

    //     if (isSyncing) {
    //         console.log("⚠️ Sync already in progress, skipping this interval...");
    //         return;
    //     }

    //     isSyncing = true;
        
    //     try {
    //         const result = await window.electronAPI.autoSync({
    //             customer_id: customer_data.id,
    //             domain_id: domain_data.id,
    //             apiUrl:apiUrl,
    //             syncData : syncData
    //         });
          
    //         showValidation(result.message, result.success ? 'success' : 'error');
    //     } catch (err) {
    //         console.error("Auto sync error:", err);
    //         showValidation("Sync failed: " + err.message, 'error');
    //     } finally {
    //         isSyncing = false; 
    //     }

    //     btn.prop("disabled", false);
    //     btn.html('<i class="bi bi-arrow-repeat"></i> Sync Drive');
    // });

    $(document).on("click", "#SyncDrive", async function () {
        const btn = $(this);
        btn.prop("disabled", true).html('<i class="bi bi-arrow-repeat spin"></i> Syncing...');

        await triggerSync(true);

        btn.prop("disabled", false).html('<i class="bi bi-arrow-repeat"></i> Sync Drive');
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
        $(this).toggleClass("selected");

        // Add check icon only once
        // if ($item.find(".check-icon").length === 0) {
        //  $item.append('<div class="check-icon"></div>');
        // }

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
        $('.floating-menu').remove();
        currentMenu = null;
        currentBtn = null;

        const targetPath = $(this).closest('.file-item').data('path');
        if (action === 'delete') deleteFile(targetPath);
        if (action === 'move') moveFile(targetPath);
        if (action === 'rename') renameFile(targetPath);
    });
    

});

window.electronAPI.onMainLog((message) => {
  console.log('%c[MAIN]', 'color: #4CAF50; font-weight: bold;', message);
});

async function triggerSync(manual = false) {
    if (isSyncing) {
        console.log("⚠️ Sync already in progress, skipping...");
        if (manual) showValidation("Sync already in progress.", "warning");
        return;
    }

    isSyncing = true;
    console.log(manual ? "🔄 Manual sync started..." : "🔄 Auto sync started...");

    try {
        const customer_data = JSON.parse(localStorage.getItem("customer_data"));
        const domain_data = JSON.parse(localStorage.getItem("domain_data"));

        if (!customer_data || !domain_data) {
            console.error("Missing customer or domain data");
            return;
        }

        const result = await window.electronAPI.autoSync({
            customer_id: customer_data.id,
            domain_id: domain_data.id,
            apiUrl: apiUrl,
            syncData: syncData
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


function startAutoSync() {
    if (autoSyncInterval) clearInterval(autoSyncInterval); // avoid duplicates
    autoSyncInterval = setInterval(() => triggerSync(false), 2 * 60 * 1000);
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

function hideMiddleSection(){
    const selectedCount = $(".file-item.selected").length;
    if (selectedCount > 0) {
        $(".middle-section").removeClass("hidden");
    } else {
        $(".middle-section").addClass("hidden");
    }
}


async function loadFiles(dirPath, reset = false) {
    if (isLoading) return;
    isLoading = true;

    if (reset) {
        loadedItems = 0;
        currentDir = dirPath;
        $("#file-list").empty();
    }

    // Show loader and allow a paint before heavy work
    showLoader();
    await tick(); // give browser a frame to render loader

    try {
        console.log(`Loading files from: ${dirPath} (offset ${loadedItems})`);
        const result = await window.electronAPI.listRecurFiles(dirPath, loadedItems, BATCH_SIZE);

        if (result.error) {
            $("#file-list").html(`<p style="color:red">${result.error}</p>`);
            return;
        }

        totalItems = result.total;
        currentDir = result.currentPath;
        $("#breadcrumb").html(buildBreadcrumb(result.currentPath));

         const res_icon = await fetch(apiUrl + '/api/folder-files-icons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_id: customer_data.id,
                domain_id: domain_data.id
            })
        });
        const iconMap = await res_icon.json();
        
        // Append batch of items
        result.items.forEach(item => {
            //const icon = getFileIcon(item.name, item.isDirectory);

            let icon = '';
            let iconHTML = '';

            if (item.isDirectory) {
                // Use folder icon
                if(iconMap.data['folder'].type == 'path'){
                    icon = iconMap.data['folder'].value;
                }

                iconHTML = `<div class="file-icon">${iconMap.data['folder'].value}</div>`;
                
            } else {
                // Extract file extension safely
                const parts = item.name.split('.');
                const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
                console.log(ext);
                // Find icon from Laravel map or use default

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

            const isListView = $("#file-list").hasClass("list-view");
            const div = $(`
            <div class="file-item">
                ${
                isListView
                    ? `<div class="check-icon"></div>
                    <div class="file-icon">${iconHTML}</div>
                    <div class="file-name" title="${item.name}">${item.name}</div>
                    <div class="modified-by">${item.modified_by || "-"}</div>
                    <div class="modified-date">${item.modified_date || "-"}</div>
                    <div class="file-size">${item.size || "-"}</div>
                    <div class="share">${item.shared ? "🔗" : ""}</div>
                    <div class="file-menu-btn">⋮</div>
                    <div class="file-menu hidden">
                        <div class="menu-item" data-action="delete">🗑 Delete</div>
                        <div class="menu-item" data-action="move">📁 Move</div>
                        <div class="menu-item" data-action="rename">✏️ Rename</div>
                    </div>
                    `
                    : `
                    
                    <div class="file-header">  
                        <div class="check-icon"></div>                      
                        <div class="file-icon">${iconHTML}</div>
                        <div class="file-name" title="${item.name}">${item.name}</div>
                    </div>                    
                    <div class="file-menu-btn">⋮</div>
                    <div class="file-menu hidden">
                        <div class="menu-item" data-action="delete">🗑 Delete</div>
                        <div class="menu-item" data-action="move">📁 Move</div>
                        <div class="menu-item" data-action="rename">✏️ Rename</div>
                    </div>
                    `
                }
            </div>
            `);

            // const div = $(`
            //     <div class="file-item">
            //         ${
            //             isListView
            //                 ? `
            //                     <div class="file-icon">${icon}</div>
            //                     <div class="file-name" title="${item.name}">${item.name}</div>
            //                     <div class="file-menu-btn">⋮</div>
            //                     <div class="file-menu hidden">
            //                         <div class="menu-item" data-action="delete">🗑 Delete</div>
            //                         <div class="menu-item" data-action="move">📁 Move</div>
            //                         <div class="menu-item" data-action="rename">✏️ Rename</div>
            //                     </div>
            //                 `
            //                 : `
            //                     <div class="file-header">
            //                         <div class="file-icon">${icon}</div>
            //                         <div class="file-name" title="${item.name}">${item.name}</div>
            //                     </div>
            //                     <div class="file-menu-btn">⋮</div>
            //                     <div class="file-menu hidden">
            //                         <div class="menu-item" data-action="delete">🗑 Delete</div>
            //                         <div class="menu-item" data-action="move">📁 Move</div>
            //                         <div class="menu-item" data-action="rename">✏️ Rename</div>
            //                     </div>
            //                 `
            //         }
            //     </div>
            // `);

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
                const action = $(e.currentTarget).data("action");
                if (action === "delete") deleteFile(item.path);
                if (action === "move") moveFile(item.path);
                if (action === "rename") renameFile(item.path);
                div.find(".file-menu").addClass("hidden");
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


function buildBreadcrumb(fullPath) {
    const parts = fullPath.split(/[\\/]+/).filter(Boolean);
    return parts.map((p, i) => {
        const subPath = parts.slice(0, i + 1).join("\\") + "\\";
        return `<span class="crumb" data-path="${subPath}">${p}</span>`;
    }).join(" › ");
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
    container.find('.folder').click(function(e) {
        e.stopPropagation();
        $(this).siblings('ul').slideToggle();
        $(this).toggleClass('expanded');
    });

    // hide all subfolders initially
    container.find('ul').hide();
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