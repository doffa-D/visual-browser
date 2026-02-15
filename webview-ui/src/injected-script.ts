import { formatElementDetails } from './common/dom-utils';
import { toPng } from 'html-to-image';

declare global {
    interface Window {
        __visualBrowserPickerInjected: boolean;
    }
}

// Immediate console log to confirm script is loaded
console.log('[VisualBrowser] Injected script loaded!');

(function() {
    // Prevent duplicate injection
    if (window.__visualBrowserPickerInjected) {
        console.log('[VisualBrowser] Script already injected, skipping...');
        return;
    }
    window.__visualBrowserPickerInjected = true;
    console.log('[VisualBrowser] Initializing picker...');

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
            console.log('[DEBUG] 📥 Injected script received togglePicker:', event.data.enabled);
            pickerEnabled = event.data.enabled;
            // Disable snipper if picker is toggled
            if (pickerEnabled) snipperEnabled = false;

            if (!pickerEnabled) {
                overlay.style.display = 'none';
                hovered = null;
                document.body.style.cursor = '';
                console.log('[DEBUG] 🔧 Picker disabled');
            } else {
                document.body.style.cursor = 'crosshair';
                console.log('[DEBUG] 🔧 Picker enabled - click on an element to select it');
            }
        }
        if (event.data && event.data.command === 'toggleSnipper') {
            console.log('[DEBUG] 📥 Injected script received toggleSnipper:', event.data.enabled);
            snipperEnabled = event.data.enabled;
            // Disable picker if snipper is toggled
            if (snipperEnabled) {
                pickerEnabled = false;
                console.log('[DEBUG] 🔧 Disabled picker, enabling snipper mode');
            }
            
            if (snipperEnabled) {
                document.body.style.cursor = 'crosshair';
                console.log('[DEBUG] 🎯 Creating snipper overlay...');
                createSnipperOverlay();
                console.log('[DEBUG] ✅ Snipper overlay created - drag to select area');
            } else {
                document.body.style.cursor = '';
                console.log('[DEBUG] 🗑️ Removing snipper overlay');
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
        console.log('[DEBUG] 🖱️ Mouse DOWN - starting selection');
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
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
        console.log('[DEBUG] 🖱️ Mouse UP - selection complete');
        isDragging = false;
        
        if (!selectionBox || !snipperOverlay) return;
        const rect = selectionBox.getBoundingClientRect();
        
        // More debug info - page dimensions and selection position
        console.log('[DEBUG] 📐 Page dimensions:', { 
            pageWidth: document.documentElement.scrollWidth, 
            pageHeight: document.documentElement.scrollHeight,
            viewportWidth: window.innerWidth, 
            viewportHeight: window.innerHeight,
            scrollX: window.scrollX, 
            scrollY: window.scrollY 
        });
        
        console.log('[DEBUG] 📐 Selected area (viewport):', { 
            width: rect.width, 
            height: rect.height, 
            left: rect.left, 
            top: rect.top 
        });
        
        // Calculate absolute coordinates (viewport + scroll)
        const captureX = rect.left + window.scrollX;
        const captureY = rect.top + window.scrollY;
        
        console.log('[DEBUG] 📐 Selected area (absolute):', { 
            captureX, 
            captureY,
            endX: rect.right + window.scrollX,
            endY: rect.bottom + window.scrollY
        });
        
        // Capture screenshot of the area
        if (rect.width > 5 && rect.height > 5) {
            console.log('[DEBUG] 📸 Starting screenshot capture...');
            
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
                    const startTime = performance.now();
                    
                    // OPTIMIZED: Capture ONLY the selected area directly (much faster!)
                    // Use higher quality for better screenshots
                    const pixelRatio = 2;  // Higher quality (2x)
                    const viewportDataUrl = await toPng(document.documentElement, {
                        // Capture at 2x pixel ratio for better quality
                        pixelRatio: pixelRatio,
                        // Skip expensive operations
                        cacheBust: false,
                        skipFonts: true,  // Skip font embedding
                        skipAutoScale: true,  // Skip auto scaling
                        style: {
                            // Minimize styling work
                            transform: 'none',
                        },
                        // Skip external images to avoid CORS
                        filter: (node) => {
                            const element = node as HTMLElement;
                            
                            // Skip hidden elements
                            if (element.style?.display === 'none' || element.style?.visibility === 'hidden') return false;
                            
                            // Skip overlays
                            if (element.id === 'visual-browser-injected-overlay' || 
                                element.id === 'visual-browser-snipper-overlay' ||
                                element.id === 'react-toolbar-root' ||
                                element.id === 'visual-browser-devtools-overlay') return false;
                            
                            // Skip external images (CORS)
                            if (element.tagName === 'IMG') {
                                const src = element.getAttribute('src') || '';
                                if (src.startsWith('http') && !src.startsWith(window.location.origin)) {
                                    return false;
                                }
                            }
                            
                            return true;
                        }
                    });
                    const captureTime = performance.now();
                    console.log(`[Snipper] toPng captured in ${(captureTime - startTime).toFixed(0)}ms`);

                    // Crop the image using canvas
                    const img = new Image();
                    
                    // Handle both load and error events
                    img.onload = () => {
                        try {
                            console.log('[DEBUG] 🖼️ Image loaded, cropping...');
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            if (!ctx) return;

                            canvas.width = rect.width;
                            canvas.height = rect.height;

                            // The captured image is at pixelRatio: 2, so scale coordinates accordingly
                            const sourceX = (rect.left + window.scrollX) * pixelRatio;
                            const sourceY = (rect.top + window.scrollY) * pixelRatio;
                            const sourceWidth = rect.width * pixelRatio;
                            const sourceHeight = rect.height * pixelRatio;
                            
                            console.log('[DEBUG] 📐 Cropping with scale correction:', { 
                                sourceX, sourceY, sourceWidth, sourceHeight,
                                viewportLeft: rect.left, viewportTop: rect.top,
                                scrollX: window.scrollX, scrollY: window.scrollY,
                                pixelRatio 
                            });

                            ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, rect.width, rect.height);

                            const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
                            console.log('[DEBUG] 📤 Sending screenshotCaptured to webview, size:', croppedDataUrl.length);
                            
                            window.parent.postMessage({
                                command: 'screenshotCaptured',
                                data: croppedDataUrl
                            }, '*');
                            console.log('[DEBUG] ✅ Screenshot sent to webview!');
                        } catch (err) {
                            console.error('[Screenshot Debug] Canvas processing failed:', err);
                        }
                    };
                    
                    img.onerror = () => {
                        console.error('[Screenshot Debug] Image failed to load - possibly due to CORS');
                        console.log('[DEBUG] 📤 Sending FULL screenshot (no crop) as fallback, size:', viewportDataUrl.length);
                        window.parent.postMessage({
                            command: 'screenshotCaptured',
                            data: viewportDataUrl
                        }, '*');
                    };
                    
                    img.src = viewportDataUrl;
                } catch (err) {
                    console.error('[Screenshot Debug] Capture failed:', err);
                }
            });
            
            // Cleanup after a short delay or immediately
            console.log('[DEBUG] 🧹 Cleaning up snipper overlay');
            removeSnipperOverlay();
            window.parent.postMessage({ command: 'toggleSnipper', enabled: false }, '*');
        } else {
             console.log('[DEBUG] ❌ Selection too small, canceling');
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

    document.addEventListener('click', async (e: MouseEvent) => {
        console.log('[DEBUG] 🖱️ CLICK EVENT TRIGGERED! pickerEnabled =', pickerEnabled);
        if (!pickerEnabled) {
            console.log('[DEBUG] ❌ Click ignored - picker not enabled');
            return;
        }
        console.log('[DEBUG] 🔘 Element picker - user clicked on element');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const target = e.target as HTMLElement;
        const detailedInfo = formatElementDetails(target);

        // Hide overlay temporarily for screenshot
        overlay.style.display = 'none';

        // Capture screenshot of the selected element
        let elementScreenshot: string | null = null;
        try {
            const startTime = performance.now();
            console.log('[DEBUG] 📸 Element picker - capturing screenshot...');
            
            // Use html-to-image - capture at higher quality
            // Get computed background color to preserve it
            const computedStyle = window.getComputedStyle(target);
            const bgColor = computedStyle.backgroundColor;
            
            const result = await toPng(target, {
                pixelRatio: 2,  // Higher quality (2x)
                cacheBust: false,
                skipFonts: true,
                style: {
                    // Force background color to be rendered
                    backgroundColor: bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent' ? bgColor : undefined,
                },
            });
            
            const endTime = performance.now();
            console.log(`[DEBUG] 📸 Element screenshot captured in ${(endTime - startTime).toFixed(0)}ms, length: ${result?.length}`);
            
            if (result) {
                elementScreenshot = result;
                console.log('[DEBUG] 📤 Sending elementPicked with screenshot to webview');
            }
        } catch (err) {
            console.error('[DEBUG] ❌ Element screenshot failed:', err);
        }

        // Send to parent window (the VS Code Webview)
        window.parent.postMessage({
            command: 'elementPicked',
            text: detailedInfo,
            elementScreenshot: elementScreenshot
        }, '*');
        
        console.log('[DEBUG] ✅ Element picker message sent');

    }, true);
})();
