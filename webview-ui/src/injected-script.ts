import { formatElementDetails } from './common/dom-utils';
import { domToPng } from 'modern-screenshot';

declare global {
    interface Window {
        __visualBrowserPickerInjected: boolean;
    }
}

(function() {
    // Prevent duplicate injection
    if (window.__visualBrowserPickerInjected) return;
    window.__visualBrowserPickerInjected = true;

    let pickerEnabled = false;
    let hovered: HTMLElement | null = null;
    let snipperEnabled = false;
    
    // Create UI Elements
    const overlay = document.createElement('div');
    overlay.id = 'visual-browser-injected-overlay';
    overlay.style.cssText = `
        position: fixed;
        pointer-events: none;
        background: rgba(59, 130, 246, 0.1);
        border: 1px solid rgba(59, 130, 246, 0.5);
        z-index: 2147483646;
        display: none;
        transition: all 0.05s ease-out;
    `;

    const badge = document.createElement('span');
    badge.style.cssText = `
        position: absolute;
        top: -24px;
        left: 0;
        background: #3b82f6;
        color: white;
        padding: 2px 6px;
        font-family: Consolas, monospace;
        font-size: 12px;
        border-radius: 2px;
        pointer-events: none;
        white-space: nowrap;
    `;
    overlay.appendChild(badge);

    function init() {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }
        document.body.appendChild(overlay);
    }
    init();

    // Message Handler
    window.addEventListener('message', (event) => {
        if (event.data && event.data.command === 'togglePicker') {
            pickerEnabled = event.data.enabled;
            // Disable snipper if picker is toggled
            if (pickerEnabled) snipperEnabled = false;

            if (!pickerEnabled) {
                overlay.style.display = 'none';
                hovered = null;
                document.body.style.cursor = '';
            } else {
                document.body.style.cursor = 'crosshair';
            }
        }
        if (event.data && event.data.command === 'toggleSnipper') {
            snipperEnabled = event.data.enabled;
            // Disable picker if snipper is toggled
            if (snipperEnabled) pickerEnabled = false;
            
            if (snipperEnabled) {
                document.body.style.cursor = 'crosshair';
                createSnipperOverlay();
            } else {
                document.body.style.cursor = '';
                removeSnipperOverlay();
            }
        }
    });

    // Snipper Logic
    let snipperOverlay: HTMLElement | null = null;
    let selectionBox: HTMLElement | null = null;
    let startX = 0, startY = 0, isDragging = false;

    function createSnipperOverlay() {
        if (snipperOverlay) return;
        
        snipperOverlay = document.createElement('div');
        snipperOverlay.id = 'visual-browser-snipper-overlay';
        snipperOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 2147483647;
            background: rgba(0, 0, 0, 0.3);
            cursor: crosshair;
        `;

        selectionBox = document.createElement('div');
        selectionBox.style.cssText = `
            position: absolute;
            border: 2px solid #3b82f6;
            background: rgba(59, 130, 246, 0.1);
            display: none;
            pointer-events: none;
        `;
        snipperOverlay.appendChild(selectionBox);

        document.body.appendChild(snipperOverlay);

        snipperOverlay.addEventListener('mousedown', onSnipperMouseDown);
        snipperOverlay.addEventListener('mousemove', onSnipperMouseMove);
        snipperOverlay.addEventListener('mouseup', onSnipperMouseUp);
    }

    function removeSnipperOverlay() {
        if (snipperOverlay) {
            snipperOverlay.remove();
            snipperOverlay = null;
            selectionBox = null;
        }
    }

    function onSnipperMouseDown(e: MouseEvent) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        // console.log('[Screenshot Debug] Mouse Down:', { startX, startY, scrollX: window.scrollX, scrollY: window.scrollY });
        if (selectionBox) {
            selectionBox.style.display = 'block';
            selectionBox.style.left = startX + 'px';
            selectionBox.style.top = startY + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
        }
    }

    function onSnipperMouseMove(e: MouseEvent) {
        if (!isDragging || !selectionBox) return;
        
        const currentX = e.clientX;
        const currentY = e.clientY;
        
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        const left = Math.min(currentX, startX);
        const top = Math.min(currentY, startY);
        
        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
    }

    function onSnipperMouseUp(e: MouseEvent) {
        isDragging = false;
        
        if (!selectionBox || !snipperOverlay) return;
        const rect = selectionBox.getBoundingClientRect();
        
        // Capture screenshot of the area
        if (rect.width > 5 && rect.height > 5) {
            
            // Calculate absolute coordinates (viewport + scroll)
            const captureX = rect.left + window.scrollX;
            const captureY = rect.top + window.scrollY;
            
            /*
            console.log('[Screenshot Debug] Mouse Up / Selection Finalized:', {
                selectionRect: {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                },
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                },
                scroll: {
                    x: window.scrollX,
                    y: window.scrollY
                },
                captureX,
                captureY
            });
            */
            
            // Hide overlays for capture
            snipperOverlay.style.display = 'none';
            if (overlay) overlay.style.display = 'none';

            // Wait a frame for overlays to fully hide
            requestAnimationFrame(async () => {
                try {
                    // console.time('[Screenshot] Total Capture Process');
                    // console.time('[Screenshot] domToPng Rendering');
                    
                    // OPTIMIZATION: Use a much faster rendering approach
                    const viewportDataUrl = await domToPng(document.body, {
                        width: window.innerWidth,
                        height: window.innerHeight,
                        scale: 1,
                        filter: (node) => {
                            const element = node as HTMLElement;
                            if (element.style?.display === 'none' || element.style?.visibility === 'hidden') return false;
                            return element.id !== 'visual-browser-injected-overlay' && 
                                   element.id !== 'visual-browser-snipper-overlay' &&
                                   element.id !== 'react-toolbar-root' &&
                                   element.id !== 'visual-browser-devtools-overlay';
                        }
                    });
                    // console.timeEnd('[Screenshot] domToPng Rendering');

                    // Crop the image using canvas
                    // console.time('[Screenshot] Canvas Cropping/Encoding');
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return;

                        canvas.width = rect.width;
                        canvas.height = rect.height;

                        const sourceX = rect.left;
                        const sourceY = rect.top;

                        ctx.drawImage(img, sourceX, sourceY, rect.width, rect.height, 0, 0, rect.width, rect.height);

                        const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
                        // console.timeEnd('[Screenshot] Canvas Cropping/Encoding');
                        // console.timeEnd('[Screenshot] Total Capture Process');
                        
                        window.parent.postMessage({
                            command: 'screenshotCaptured',
                            data: croppedDataUrl
                        }, '*');
                    };
                    img.src = viewportDataUrl;
                } catch (err) {
                    console.error('[Screenshot Debug] Capture failed:', err);
                }
            });
            
            // Cleanup after a short delay or immediately
            removeSnipperOverlay();
            window.parent.postMessage({ command: 'toggleSnipper', enabled: false }, '*');
        } else {
             removeSnipperOverlay();
             window.parent.postMessage({ command: 'toggleSnipper', enabled: false }, '*');
        }
    }

    let rAF: number | null = null;

    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!pickerEnabled) return;
        
        if (rAF) return;

        rAF = requestAnimationFrame(() => {
            rAF = null;
            
            const target = e.target as HTMLElement;
            if (target === overlay || target === badge) return;
    
            if (hovered !== target) {
                hovered = target;
                const rect = target.getBoundingClientRect();
                
                // Batch visual updates
                overlay.style.display = 'block';
                overlay.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
                overlay.style.width = rect.width + 'px';
                overlay.style.height = rect.height + 'px';
                overlay.style.top = '0';
                overlay.style.left = '0';
                
                const idStr = target.id ? '#' + target.id : '';
                const tagStr = target.tagName ? target.tagName.toLowerCase() : '';
                badge.textContent = tagStr + idStr + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
            }
        });
    }, true);

    document.addEventListener('click', (e: MouseEvent) => {
        if (!pickerEnabled) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const target = e.target as HTMLElement;
        const detailedInfo = formatElementDetails(target);

        // Send to parent window (the VS Code Webview)
        window.parent.postMessage({
            command: 'elementPicked',
            text: detailedInfo
        }, '*');

    }, true);
})();
