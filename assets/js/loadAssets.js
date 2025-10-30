// function loadStyleSheet(href) {
//     const link = document.createElement('link');
//     link.rel = 'stylesheet';
//     link.href = href; // Ensure the correct path to the CSS file
//     document.head.appendChild(link);
// }

// function loadScript(src) {
//     const script = document.createElement('script');
//     script.src = src; // Ensure the correct path to the JS file
//     script.defer = true;
//     document.head.appendChild(script);
// }

// window.addEventListener('DOMContentLoaded', () => {
//     loadStyleSheet('node_modules/bootstrap/dist/css/bootstrap.min.css');
//     loadStyleSheet('assets/css/style.css');
//     loadScript('node_modules/jquery/dist/jquery.min.js');
//     loadScript('node_modules/bootstrap/dist/js/bootstrap.bundle.min.js');
//     loadScript('node_modules/crypto-js/crypto-js.js');
//     loadScript('assets/js/renderer.js');
//     loadScript('assets/js/functions.js');
// });


// window.addEventListener('DOMContentLoaded', async () => {
//     function loadStyleSheet(href) {
//         const link = document.createElement('link');
//         link.rel = 'stylesheet';
//         link.href = href;
//         document.head.appendChild(link);
//     }

//     function loadScript(src) {
//         return new Promise((resolve, reject) => {
//             const script = document.createElement('script');
//             script.src = src;
//             script.onload = resolve;
//             script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
//             document.head.appendChild(script);
//         });
//     }

//     // Load CSS
//     loadStyleSheet('node_modules/bootstrap/dist/css/bootstrap.min.css');
//     loadStyleSheet('assets/css/style.css');

//     try {
//         // Load JS sequentially to ensure functions.js loads before dashboard.js
//         await loadScript('node_modules/jquery/dist/jquery.min.js');
//         await loadScript('node_modules/bootstrap/dist/js/bootstrap.bundle.min.js');
//         await loadScript('node_modules/crypto-js/crypto-js.js');
//         await loadScript('assets/js/functions.js');  // Must load before dashboard.js
//         await loadScript('assets/js/renderer.js');        

//         // Initialize global variables
//         if (window.initializeGlobals) await window.initializeGlobals();
//         console.log("Globals ready:", window.secret_key, window.secret_gen_key, window.apiUrl);
//         await loadScript('assets/js/dashboard.js');

//     } catch (err) {
//         console.error(err);
//     }
// });

window.addEventListener("DOMContentLoaded", async () => {
  // ✅ Helper to load CSS dynamically
  function loadStyleSheet(href) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  // ✅ Helper to load JS dynamically
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error(`❌ Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  // ✅ Load JS directly from absolute local path (for node_modules)
  async function loadScriptFromNode(modulePath) {
    const fullPath = `file://${window.appPaths.base}/${modulePath.replace(/\\/g, "/")}`;
    return loadScript(fullPath);
  }

  // --- Load CSS ---
  loadStyleSheet("node_modules/bootstrap/dist/css/bootstrap.min.css");
  loadStyleSheet("assets/css/style.css");

  try {
    // --- Load JS files sequentially ---
    await loadScript("node_modules/jquery/dist/jquery.min.js");
    await loadScript("node_modules/bootstrap/dist/js/bootstrap.bundle.min.js");
    await loadScript("node_modules/crypto-js/crypto-js.js");
    await loadScript("assets/js/functions.js"); // Must load before initializing globals
    await loadScript("assets/js/renderer.js");

    // --- Initialize global variables ---
    if (window.initializeGlobals) {
      console.log("🔐 Initializing global variables...");
      await window.initializeGlobals(); // Wait until secureAPI and DOM are ready
      console.log("✅ Globals ready:", {
        secret_key: window.secret_key,
        secret_gen_key: window.secret_gen_key,
        apiUrl: window.apiUrl,
      });
    } else {
      console.warn("⚠️ initializeGlobals not found. Check functions.js load order.");
    }

    // --- Finally load your dashboard (depends on globals) ---
    await loadScript("assets/js/dashboard.js");
    console.log("🚀 Dashboard loaded successfully.");
  } catch (err) {
    console.error("❌ Asset loading failed:", err);
  }
});


