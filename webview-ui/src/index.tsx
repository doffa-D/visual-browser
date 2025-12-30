import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { Toolbar } from './Toolbar';
import { getVsCodeApi } from './vscode';
import { formatElementDetails } from './common/dom-utils';
import { Z_INDEX, TOOLBAR_HEIGHT } from './common/constants';

// Acquire VS Code API once
const vscode = getVsCodeApi();

// Import navigation interceptor
import './navigationInterceptor';

// Constants
const rootId = 'react-toolbar-root';
const pickerRootId = rootId;

// Wait for DOM to be fully ready
function initializeApp() {
    console.log('Initializing Copilot Browser App...');
    
    // Load Codicons stylesheet
    const codiconsLink = document.createElement('link');
    codiconsLink.rel = 'stylesheet';
    codiconsLink.href = 'https://unpkg.com/@vscode/codicons@latest/dist/codicon.css';
    document.head.appendChild(codiconsLink);
    
    // Mount React Toolbar
    const rootElement = document.getElementById(rootId);
    
    if (!rootElement) {
        console.error('Failed to find #react-toolbar-root');
        return;
    }
    
    try {
        const root = ReactDOM.createRoot(rootElement);
        root.render(
            <React.StrictMode>
                <Toolbar />
            </React.StrictMode>
        );
        console.log('React Toolbar mounted successfully');
    } catch (err) {
        console.error('Failed to mount React:', err);
    }
}

// Wait for DOM to be fully ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM is already ready, initialize immediately
    initializeApp();
}

// 3. Add global picker logic (Overlay Inspector)
// We use a separate overlay element to avoid modifying the DOM of the page being inspected,
// which prevents layout shifting and style conflicts.

// Create Overlay Elements
const overlay = document.createElement('div');
overlay.id = 'copilot-browser-inspector-overlay';
overlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    background: rgba(0, 120, 215, 0.1);
    border: 1px solid rgba(0, 120, 215, 0.5);
    z-index: ${Z_INDEX.PICKER_OVERLAY};
    display: none;
    transition: all 0.05s ease-out;
    box-shadow: 0 0 0 100vw rgba(0, 0, 0, 0.1); /* Dim background */
`;

const badge = document.createElement('span');
badge.style.cssText = `
    position: absolute;
    top: -24px;
    left: 0;
    background: #0078d4;
    color: white;
    padding: 2px 6px;
    font-family: Consolas, monospace;
    font-size: 12px;
    border-radius: 2px;
    pointer-events: none;
    white-space: nowrap;
    z-index: ${Z_INDEX.TOOLBAR};
`;
overlay.appendChild(badge);

if (document.body) {
    document.body.appendChild(overlay);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(overlay);
    });
}

let pickerEnabled = false;
let hovered: HTMLElement | null = null;

// Helper to hide overlay
function hideOverlay() {
    overlay.style.display = 'none';
    hovered = null;
    document.body.style.cursor = '';
}

// Listen for the toggle event from React
window.addEventListener('message', (event) => {
    // SECURITY: Ensure we only listen to TRUSTED messages (from our own window)
    if (event.data && event.data.command === 'togglePicker') {
        pickerEnabled = event.data.enabled;
        console.log("Picker State Toggled:", pickerEnabled);
        
        if (!pickerEnabled) {
            hideOverlay();
        } else {
            document.body.style.cursor = 'crosshair';
            // Disable snipper if picker is enabled
            window.postMessage({ command: 'toggleSnipper', enabled: false }, '*');
        }

        // FORWARD to iframe if it exists
        const iframe = document.getElementById('localhost-iframe') as HTMLIFrameElement;
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                command: 'togglePicker',
                enabled: pickerEnabled
            }, '*');
        }
    }

    // HANDLE Snipper toggle
    if (event.data && event.data.command === 'toggleSnipper') {
        const snipperEnabled = event.data.enabled;
        console.log("Snipper State Toggled:", snipperEnabled);
        
        if (snipperEnabled) {
            // Disable picker if snipper is enabled
            pickerEnabled = false;
            hideOverlay();
        }

        // FORWARD to iframe if it exists
        const iframe = document.getElementById('localhost-iframe') as HTMLIFrameElement;
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                command: 'toggleSnipper',
                enabled: snipperEnabled
            }, '*');
        }
    }

    // HANDLE message FROM iframe
    if (event.data && event.data.command === 'elementPicked' && event.source !== window) {
        console.log("Element Picked from Iframe:", event.data.text);
        vscode.postMessage({ command: 'elementPicked', text: event.data.text });
        
        // Reset local state too
        pickerEnabled = false;
        window.postMessage({ command: 'togglePicker', enabled: false }, '*'); 
        hideOverlay();
    }

    // HANDLE Screenshot Captured
    if (event.data && event.data.command === 'screenshotCaptured') {
        console.log("Screenshot Captured, sending to VS Code");
        vscode.postMessage({ 
            command: 'screenshotCaptured', 
            data: event.data.data 
        });
    }

    // HANDLE Chii URL update (background discovery)
    if (event.data && event.data.command === 'updateChiiUrl') {
        const chiiUrl = event.data.chiiUrl;
        console.log("Chii URL Updated (Background):", chiiUrl);
        
        if (chiiUrl) {
            let devToolsOverlay = document.getElementById('copilot-devtools-overlay') as HTMLDivElement;
            if (devToolsOverlay) {
                const iframe = devToolsOverlay.querySelector('iframe');
                if (iframe && iframe.src !== chiiUrl) {
                    iframe.src = chiiUrl;
                }
            }
        }
    }

    // HANDLE DevTools toggle from backend
    if (event.data && event.data.command === 'toggleInternalDevTools') {
        const chiiUrl = event.data.chiiUrl;
        const autoOpen = event.data.autoOpen !== false; // Default to true
        console.log("DevTools Message Received:", { chiiUrl, autoOpen });
        
        if (chiiUrl) {
            // Create or toggle iframe overlay for DevTools
            let devToolsOverlay = document.getElementById('copilot-devtools-overlay') as HTMLDivElement;
            
            if (devToolsOverlay) {
                // Toggle visibility only if autoOpen is true
                if (autoOpen) {
                    const isVisible = devToolsOverlay.style.display !== 'none';
                    devToolsOverlay.style.display = isVisible ? 'none' : 'flex';
                }
                
                // Update iframe src if it changed
                const iframe = devToolsOverlay.querySelector('iframe');
                if (iframe && iframe.src !== chiiUrl) {
                    iframe.src = chiiUrl;
                }
            } else {
                // Create new overlay (resizable, bottom half of screen)
                devToolsOverlay = document.createElement('div');
                devToolsOverlay.id = 'copilot-devtools-overlay';
                devToolsOverlay.style.cssText = `
                    position: fixed;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    height: 50%;
                    background: rgba(0, 0, 0, 0.9);
                    z-index: ${Z_INDEX.DEVTOOLS};
                    display: ${autoOpen ? 'flex' : 'none'};
                    flex-direction: column;
                    resize: vertical;
                    overflow: hidden;
                    min-height: 200px;
                    max-height: 90%;
                `;

                // Loading indicator
                const loadingOverlay = document.createElement('div');
                loadingOverlay.id = 'devtools-loading';
                loadingOverlay.style.cssText = `
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-size: 16px;
                    font-family: var(--vscode-font-family);
                    text-align: center;
                    z-index: ${Z_INDEX.TOOLBAR};
                `;
                loadingOverlay.innerHTML = `
                    <div style="margin-bottom: 10px;">⏳ Loading DevTools...</div>
                    <div style="font-size: 12px; opacity: 0.7;">This may take a few seconds</div>
                `;

                // DevTools iframe
                const devToolsIframe = document.createElement('iframe');
                devToolsIframe.src = chiiUrl;
                devToolsIframe.style.cssText = `
                    width: 100%;
                    height: 100%;
                    border: none;
                    background: white;
                `;
                
                // Remove loading indicator when iframe loads
                devToolsIframe.onload = () => {
                    const loading = document.getElementById('devtools-loading');
                    if (loading) loading.remove();
                };

                devToolsOverlay.appendChild(loadingOverlay);
                devToolsOverlay.appendChild(devToolsIframe);
                document.body.appendChild(devToolsOverlay);
            }
        } else {
            console.error('No Chii URL provided');
        }
    }
});

let rAF: number | null = null;

document.addEventListener('mousemove', (e) => {
    if (!pickerEnabled) return;
    
    if (rAF) return;

    rAF = requestAnimationFrame(() => {
        rAF = null;
    
    const target = e.target as HTMLElement;
    
        // IGNORE IFRAME -> Let the injected script handle it
        if (target.id === 'localhost-iframe') {
            overlay.style.display = 'none';
            hovered = null;
            return;
        }
        
        // Safety: ignore toolbar interactions
        if (target.closest(`#${pickerRootId}`) || target === overlay || target === badge) return;

    if (hovered !== target) {
        hovered = target;
            
            const rect = target.getBoundingClientRect();
            
            // Update Overlay Position (Optimized with transform)
            overlay.style.display = 'block';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = `${rect.width}px`;
            overlay.style.height = `${rect.height}px`;
            overlay.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    
            // Update Badge Text (Tag + generic info)
            const idStr = target.id ? `#${target.id}` : '';
            const tagName = target.tagName ? target.tagName.toLowerCase() : '';
            const classStr = target.className && typeof target.className === 'string' 
                ? `.${target.className.split(' ')[0]}` 
                : '';
            badge.textContent = `${tagName}${idStr}${classStr} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
        }
    });
}, true); // Capture phase

document.addEventListener('click', (e) => {
    if (!pickerEnabled) return;
    
    const target = e.target as HTMLElement;
    
    // IGNORE IFRAME -> Let the injected script handle it
    if (target.id === 'localhost-iframe') return;

    if (target.closest(`#${pickerRootId}`)) return;

    console.log("Element Clicked:", target);

    // STOP EVERYTHING
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const detailedInfo = formatElementDetails(target);
   
    // Visual feedback handled by extension
    vscode.postMessage({ command: 'elementPicked', text: detailedInfo });
    
    // CONTINUOUS PICKING: Keep picker enabled
    // pickerEnabled = false;
    // window.postMessage({ command: 'togglePicker', enabled: false }, '*'); 
    // hideOverlay();
}, true); // Capture phase
