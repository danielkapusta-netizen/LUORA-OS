'use client';

import { Printer } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/** Rendering resolution; 300 dpi keeps barcodes sharp on label printers. */
const DPI = 300;

// The legacy build polyfills newer JavaScript (e.g. Map.getOrInsertComputed) for browsers that aren't fully up to date.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
    return pdfjs;
  });
  return pdfjsPromise;
}

/** Draws every PDF page as an image, sized in points so it prints at the label's real size. */
async function renderPages(data: ArrayBuffer) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const pages: { url: string; widthPt: number; heightPt: number }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the label'))), 'image/png'));
    pages.push({ url: URL.createObjectURL(blob), widthPt: size.width, heightPt: size.height });
  }
  await task.destroy();
  return pages;
}

/** Opens the browser's print dialog for the pages, from a hidden frame on this page. */
async function printPages(pages: { url: string; widthPt: number; heightPt: number }[]) {
  const { widthPt, heightPt } = pages[0];
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const cleanup = () => {
    frame.remove();
    pages.forEach((p) => URL.revokeObjectURL(p.url));
  };
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><style>
    @page { size: ${widthPt}pt ${heightPt}pt; margin: 0; }
    html, body { margin: 0; padding: 0; }
    img { display: block; width: ${widthPt}pt; height: ${heightPt}pt; break-after: page; }
    img:last-child { break-after: auto; }
  </style></head><body>${pages.map((p) => `<img src="${p.url}" alt="">`).join('')}</body></html>`);
  doc.close();
  await Promise.all(Array.from(doc.images).map((img) => img.decode()));
  const win = frame.contentWindow!;
  win.addEventListener('afterprint', () => setTimeout(cleanup, 500), { once: true });
  // Some browsers never fire afterprint for frames; don't leave the frame behind.
  setTimeout(cleanup, 120_000);
  win.focus();
  win.print();
}

/**
 * "Print label" that opens the print dialog on this page instead of a PDF viewer or Adobe Reader.
 * ZPL labels (thermal printers) can't be printed from a browser, so those are downloaded as before.
 */
export function PrintLabelButton({ href, className, children }: { href: string; className?: string; children?: React.ReactNode }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function print(event: React.MouseEvent<HTMLAnchorElement>) {
    // Ctrl/Cmd-click still opens the file in a new tab.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(href, { credentials: 'same-origin' });
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.includes('application/pdf')) {
        window.location.href = href;
        return;
      }
      await printPages(await renderPages(await response.arrayBuffer()));
    } catch (err) {
      setError(t('Could not print: {reason}', { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a href={href} onClick={print} target="_blank" rel="noreferrer" aria-busy={busy} className={cn(className, busy && 'pointer-events-none opacity-70')}>
        {children ?? (
          <>
            <Printer className="size-3.5" /> {t('Print label')}
          </>
        )}
        {busy && <span className="sr-only"> {t('(preparing…)')}</span>}
      </a>
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </>
  );
}
