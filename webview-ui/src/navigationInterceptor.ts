import { getVsCodeApi } from './vscode';

// Use the singleton instance
const vscode = getVsCodeApi();

// --- Add Navigation Interceptor ---
let localPickerEnabled = false;

// Listen for picker state from the main file
window.addEventListener('message', (event) => {
    if (event.data && event.data.command === 'togglePicker') {
        localPickerEnabled = event.data.enabled;
    }
});

document.addEventListener('click', (e) => {
    // 1. If Picking is active, do NOTHING (let the picker logic below handle it)
    if (localPickerEnabled) return;

    // 2. Navigation Logic
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    
    if (link && link.href) {
        // Only intercept standard clicks (not new tab ctrl/cmd clicks)
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            
            // Check if it's an anchor link on the same page (#section)
            const url = new URL(link.href);
            if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash) {
                // Let default anchor behavior work
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            
            // Send navigation request to VS Code
            vscode.postMessage({ command: 'loadUrl', url: link.href });
        }
    }
}, true); // Capture phase to intervene early

// --- Form Submission Interceptor (Basic GET support) ---
document.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    
    // Only handle GET forms for MVP ease (search boxes mostly)
    if (!form.method || form.method.toLowerCase() === 'get') {
        const formData = new FormData(form);
        const params = new URLSearchParams();
        
        formData.forEach((value, key) => {
            params.append(key, value.toString());
        });
        
        // Construct target URL
        let action = form.action || window.location.href;
        if (action.includes('?')) {
            action += '&' + params.toString();
        } else {
            action += '?' + params.toString();
        }
        
        vscode.postMessage({ command: 'loadUrl', url: action });
    } else {
        // Notify user about POST limitation
        // vscode.postMessage({ command: 'alert', text: 'POST forms are not supported in Proxy Browser yet.' });
        console.warn("POST form submission intercepted but not fully implemented.");
    }
}, true);