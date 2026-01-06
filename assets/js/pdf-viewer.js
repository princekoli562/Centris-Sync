//import * as pdfjsLib from "pdfjs-dist/build/pdf";
//import pdfWorker from "pdfjs-dist/build/pdf.worker?url";
// const pdfWorker = "assets/pdfjs/pdf.worker.min.js";

// if (typeof pdfjsLib === "undefined") {
//     console.error("pdf.js not loaded");
// }
// console.log("pdfjsLib =", window.pdfjsLib);
// pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const canvas = document.getElementById("pdfCanvas");
if (canvas) {
    const ctx = canvas.getContext("2d");
    // draw logic here
} else {
    console.warn("Canvas not found on this page");
}

let pdfDoc = null;
let currentScale = 1;
let isPreview = false;
let currentContainer = null;

async function openPDF1(path, title = "PDF Viewer") {
    const isPreviewMode = document
        .getElementById("main-content")
        .classList
        .contains("preview-mode");

    let canvas, ctx;

    if (isPreviewMode) {
        // 🔹 INSIDE preview panel
        canvas = document.getElementById("pdfPreviewCanvas");
        document.getElementById("preview-panel").classList.remove("hidden");
    } else {
        // 🔹 OUTSIDE modal viewer
        $("#pdfTitle").text(title);
        $("#pdfModal").removeClass("hidden");
        canvas = document.getElementById("pdfCanvas");
    }

    if (!canvas) {
        console.error("Canvas not found");
        return;
    }

    ctx = canvas.getContext("2d");

    const pdf = await pdfjsLib.getDocument(path).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 1.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
        canvasContext: ctx,
        viewport
    }).promise;
}

async function openPDF2(path, title = "PDF Viewer") {
    const mainContent = document.getElementById("main-content");
    const isPreviewMode = mainContent.classList.contains("preview-mode");

    let canvas, ctx, container;

    if (isPreviewMode) {
        canvas = document.getElementById("pdfPreviewCanvas");
        container = document.getElementById("preview-panel");
        container.classList.remove("hidden");
    } else {
        $("#pdfTitle").text(title);
        $("#pdfModal").removeClass("hidden");
        canvas = document.getElementById("pdfCanvas");
        container = document.querySelector(".pdf-body");
    }

    if (!canvas || !container) return;

    ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pdf = await pdfjsLib.getDocument(path).promise;
    const page = await pdf.getPage(1);

    // 🔑 STEP 1: get viewport at scale 1
    const unscaledViewport = page.getViewport({ scale: 1 });

    // 🔑 STEP 2: calculate scale to fit container width
    const containerWidth = container.clientWidth - 20; // padding buffer
    const scale = isPreviewMode
        ? containerWidth / unscaledViewport.width
        : 1.5;

    // 🔑 STEP 3: apply scaled viewport
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
        canvasContext: ctx,
        viewport
    }).promise;
}

async function openPDF3(path, title = "PDF Viewer") {
    const mainContent = document.getElementById("main-content");
    isPreview = mainContent.classList.contains("preview-mode");

    let containerWrapper;

    if (isPreview) {
        containerWrapper = document.getElementById("preview-panel");
        containerWrapper.classList.remove("hidden");
    } else {
        $("#pdfTitle").text(title);
        $("#pdfModal").removeClass("hidden");
        containerWrapper = document.querySelector(".pdf-body");
    }

    currentContainer = containerWrapper.querySelector("#pdfScrollContainer");
    currentContainer.innerHTML = ""; // clear previous pages

    pdfDoc = await pdfjsLib.getDocument(path).promise;

    // 🔑 Auto scale for preview mode
    if (isPreview) {
        const firstPage = await pdfDoc.getPage(1);
        const vp = firstPage.getViewport({ scale: 1 });
        const width = containerWrapper.clientWidth - 30;
        currentScale = width / vp.width;
    } else {
        currentScale = 1.2;
    }

    renderAllPages();
    updatePageInfo();
}

async function openPDF(filePath) {
    const frame = document.getElementById("pdfViewerFrame");

    // Convert to file:// for Electron
    const fileUrl = filePath.startsWith("file://")
        ? filePath
        : "file://" + filePath.replace(/\\/g, "/");

    const viewerUrl =
        `assets/pdf.js/web/viewer.html?file=${encodeURIComponent(fileUrl)}`;

    // Reset iframe before loading new PDF
    frame.src = "";
    frame.src = viewerUrl;
}


async function renderAllPages() {
    currentContainer.innerHTML = "";

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: currentScale });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        currentContainer.appendChild(canvas);

        await page.render({
            canvasContext: ctx,
            viewport
        }).promise;
    }
}

function updatePageInfo() {
    const pageInfo = document.getElementById("pageInfo");

    currentContainer.addEventListener("scroll", () => {
        const canvases = currentContainer.querySelectorAll("canvas");
        let currentPage = 1;

        canvases.forEach((canvas, index) => {
            const rect = canvas.getBoundingClientRect();
            if (rect.top >= 0) {
                currentPage = index + 1;
                return;
            }
        });

        pageInfo.textContent = `Page ${currentPage} / ${pdfDoc.numPages}`;
    });

    pageInfo.textContent = `Page 1 / ${pdfDoc.numPages}`;
}


// document.getElementById("zoomIn").onclick = () => {
//     currentScale += 0.15;
//     renderAllPages();
// };

// document.getElementById("zoomOut").onclick = () => {
//     currentScale = Math.max(0.4, currentScale - 0.15);
//     renderAllPages();
// };



$("#closePdf").on("click", () => {
    $("#pdfModal").addClass("hidden");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// export { openPDF };
