function loadStyleSheet(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href; // Ensure the correct path to the CSS file
    document.head.appendChild(link);
}

function loadScript(src) {
    const script = document.createElement('script');
    script.src = src; // Ensure the correct path to the JS file
    script.defer = true;
    document.head.appendChild(script);
}

window.addEventListener('DOMContentLoaded', () => {
    loadStyleSheet('node_modules/bootstrap/dist/css/bootstrap.min.css');
    loadStyleSheet('assets/css/style.css');
    loadScript('node_modules/jquery/dist/jquery.min.js');
    loadScript('node_modules/bootstrap/dist/js/bootstrap.bundle.min.js');
    loadScript('node_modules/crypto-js/crypto-js.js');
    loadScript('assets/js/renderer.js');
    loadScript('assets/js/functions.js');
});