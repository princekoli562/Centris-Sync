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

async function openPDF(path, title = "PDF Viewer") {
    $("#pdfTitle").text(title);
    $("#pdfModal").removeClass("hidden");

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

$("#closePdf").on("click", () => {
    $("#pdfModal").addClass("hidden");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// export { openPDF };
