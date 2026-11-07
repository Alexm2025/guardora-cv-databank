// Renders a PDF inside the app with pdf.js, page by page as you scroll. Works the same on desktop, Android and iPhone.

import { h, clear } from './ui.js';

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('/vendor/pdfjs/build/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function renderPdf(container, data, { zoom = 1 } = {}) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data, isEvalSupported: false, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/'
  });
  const doc = await task.promise;
  let observer = null;

  async function draw(scaleFactor) {
    if (observer) observer.disconnect();
    const width = Math.min(container.clientWidth - 36, 900) || 600;
    const first = await doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    const scale = (width / base.width) * scaleFactor;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const canvases = [];
    clear(container);
    for (let n = 1; n <= doc.numPages; n++) {
      const c = h('canvas', { 'aria-label': 'Page ' + n, dataset: { page: n } });
      c.style.width = Math.round(base.width * scale) + 'px';
      c.style.aspectRatio = base.width + ' / ' + base.height;
      container.append(c);
      canvases.push(c);
    }
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || e.target.dataset.done) continue;
        e.target.dataset.done = '1';
        const n = Number(e.target.dataset.page);
        doc.getPage(n).then((page) => {
          const vp = page.getViewport({ scale: scale * dpr });
          e.target.width = vp.width;
          e.target.height = vp.height;
          e.target.style.aspectRatio = vp.width + ' / ' + vp.height;
          return page.render({ canvas: e.target, canvasContext: e.target.getContext('2d'), viewport: vp }).promise;
        }).catch(() => {});
      }
    }, { root: container.closest('.panel-body') || null, rootMargin: '600px' });
    canvases.forEach((c) => observer.observe(c));
  }

  await draw(zoom);
  return {
    pages: doc.numPages,
    zoom: (z) => draw(z),
    destroy: () => {
      if (observer) observer.disconnect();
      task.destroy();
    }
  };
}
