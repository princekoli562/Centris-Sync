document.addEventListener('DOMContentLoaded', () => {
   
     // Tab switching
    
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
        if (!folderPath) return;
        $('#folderPath').text(folderPath);
        const files = await window.electronAPI.listFiles(folderPath);
        renderFileList('#localFileList', files);
      });

      // --- Remote Files ---
     
    $(document).on("click","#loadRemote",async function(e) {
        const remoteList = $('#remoteFileList');
        remoteList.html('<li>Loading...</li>');
        try {
          const res = await fetch('https://yourserver.com/api/files');
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          const data = await res.json();
          renderFileList('#remoteFileList', data);
        } catch(err) {
          remoteList.html(`<li style="color:red;">Error: ${err.message}</li>`);
        }
    });    

});

 // --- Render File List ---
 function renderFileList(selector, files) {
    const container = $(selector);
    container.empty();
    if (!files || files.length === 0) {
      container.append('<li>No files found</li>');
      return;
    }
    files.forEach(f => container.append(`<li>${f}</li>`));
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