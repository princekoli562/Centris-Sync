document.addEventListener('DOMContentLoaded', () => {
    
     // Tab switching
    window.secret_key = localStorage.getItem('secret_key');
    window.secret_gen_key = localStorage.getItem('secret_gen_key');
    window.apiUrl = localStorage.getItem('apiUrl');
    

    var apiUrl = window.apiUrl;
    var secret_gen_key = window.secret_gen_key;
    var secret_key = window.secret_key;

    console.log("API URL:", apiUrl);
    console.log("Secret key:", secret_key);
    
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
        await loadFiles("F:\\");
    });

    // 🔹 Scroll listener for lazy loading
    $("#file-list").on("scroll", function () {
        const scrollTop = $(this).scrollTop();
        const scrollHeight = $(this)[0].scrollHeight;
        const clientHeight = $(this).height();

        // if user scrolled near bottom, load next batch
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            if (visibleCount < allItems.length) {
                renderNextBatch();
            }
        }
    });

    // 🔹 Breadcrumb navigation
    $(document).on("click", ".crumb", async function () {
        const path = $(this).data("path");
        await loadFiles(path, true);
    });

    // Infinite scroll handler
$("#file-list").on("scroll", async function () {
    if (isLoading) return;

    const nearBottom = this.scrollTop + this.clientHeight >= this.scrollHeight - 50;
    if (nearBottom && loadedItems < totalItems) {
        await loadFiles(currentDir, false);
    }
});
    

});


  const BATCH_SIZE = 1000; // how many files to show per scroll
    let allItems = [];
    let visibleCount = 0;
    let currentDir = "F:\\";
    let totalItems = 0;
    let loadedItems = 0;
    let isLoading = false;



async function loadFiles(dirPath, reset = false) {
    if (isLoading) return;
    isLoading = true;

    if (reset) {
        loadedItems = 0;
        currentDir = dirPath;
        $("#file-list").empty();
    }
    console.log(loadedItems + ' = ' + BATCH_SIZE);
    const result = await window.electronAPI.listRecurFiles(dirPath, loadedItems, BATCH_SIZE);
    if (result.error) {
        $("#file-list").html(`<p style="color:red">${result.error}</p>`);
        isLoading = false;
        return;
    }

    totalItems = result.total;
    currentDir = result.currentPath;
    $("#breadcrumb").html(buildBreadcrumb(result.currentPath));

    // Append batch
    result.items.forEach(item => {
        const icon = item.isDirectory ? "📁" : "📄";
        const div = $(`<div class='file-item' style='cursor:pointer;margin:4px 0;'>
            <span>${icon} ${item.name}</span>
        </div>`);

        div.on("click", () => {
            if (item.isDirectory) loadFiles(item.path, true);
        });

        $("#file-list").append(div);
    });

    loadedItems += result.items.length;
    isLoading = false;
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