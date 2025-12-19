//import * as pdfjsLib from "pdfjs-dist/build/pdf";
//import pdfWorker from "pdfjs-dist/build/pdf.worker?url";
const pdfWorker = "assets/pdfjs/pdf.worker.min.js";

if (typeof pdfjsLib === "undefined") {
    console.error("pdf.js not loaded");
}
console.log("pdfjsLib =", window.pdfjsLib);
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const canvas = document.getElementById("pdfCanvas");
const ctx = canvas.getContext("2d");

// async function openPDF(path, title = "PDF Viewer") {
//     $("#pdfTitle").text(title);
//     $("#pdfModal").removeClass("hidden");

//     const pdf = await pdfjsLib.getDocument(path).promise;
//     const page = await pdf.getPage(1);

//     const viewport = page.getViewport({ scale: 1.5 });
//     canvas.width = viewport.width;
//     canvas.height = viewport.height;

//     await page.render({
//         canvasContext: ctx,
//         viewport
//     }).promise;
// }

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

async function openPDF(path, title = "PDF Viewer") {
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



$("#closePdf").on("click", () => {
    $("#pdfModal").addClass("hidden");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// export { openPDF };
