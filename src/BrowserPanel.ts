import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CookieJar } from 'tough-cookie';
import { URL } from 'url';
import { ProxyServer } from './proxy/ProxyServer';
import { StorageManager } from './storage/StorageManager';
const { copyImg, ErrorCodes, isWayland } = require('img-clipboard');

export class BrowserPanel {
    public static currentPanel: BrowserPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _currentUrl: string = '';
    private _bookmarks: any[] = [];
    private _storageManager: StorageManager;
    private _proxyServer: ProxyServer;

    private _context: vscode.ExtensionContext;

    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (BrowserPanel.currentPanel) {
            BrowserPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'visualBrowser',
            'Visual Browser',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    extensionUri
                ],
                portMapping: [
                    { webviewPort: 5173, extensionHostPort: 5173 }, // Vite
                    { webviewPort: 3000, extensionHostPort: 3000 }, // React/Node
                    { webviewPort: 8080, extensionHostPort: 8080 }, // Vue/Others
                    { webviewPort: 4200, extensionHostPort: 4200 }, // Angular
                    { webviewPort: 8000, extensionHostPort: 8000 }  // Python/Django
                ],
                enableCommandUris: true
            }
        );

        BrowserPanel.currentPanel = new BrowserPanel(panel, extensionUri, context);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;
        
        // Initialize storage manager with persistent storage
        // Use extension's global storage directory
        const storageDir = path.join(context.globalStoragePath, 'browser-storage');
        this._storageManager = new StorageManager(storageDir);
        this._storageManager.initialize();
        
        // Create proxy server and pass storage manager to it
        this._proxyServer = new ProxyServer(extensionUri);
        this._proxyServer.setStorageManager(this._storageManager);
        
        // Restore bookmarks
        this._bookmarks = this._context.globalState.get('copilot-bridge-bookmarks', []);
        // console.log('[BrowserPanel] Restored bookmarks from globalState:', this._bookmarks);

        this._update(); // Initial Load

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'loadUrl':
                        this._loadUrl(message.url);
                        return;
                    case 'elementPicked':
                        this._handleElementPicked(message.text, message.elementScreenshot);
                        return;
                    case 'getBookmarks':
                        this._sendBookmarks();
                        return;
                    case 'saveBookmarks':
                        this._saveBookmarks(message.bookmarks);
                        return;
                    case 'takeScreenshot':
                        // Handled in UI, but if we need backend logic:
                        vscode.window.showInformationMessage('Screenshot capture started. Select area to copy.');
                        return;
                    case 'screenshotCopied':
                        this._handleScreenshotCopied();
                        return;
                    case 'screenshotCaptured':
                        this._handleScreenshotCaptured(message.data);
                        return;
                    case 'openDevTools':
                        // console.log('[BrowserPanel] TRIGGER: openDevTools command received from UI');
                        
                        // Check if a localhost URL is loaded
                        if (!this._currentUrl || (!this._currentUrl.includes('localhost') && !this._currentUrl.includes('127.0.0.1'))) {
                            vscode.window.showWarningMessage('DevTools is only available when viewing a localhost URL. Please load a localhost page first.');
                            return;
                        }
                        
                        if (!this._proxyServer) {
                            console.error('[BrowserPanel] ERROR: _proxyServer is undefined');
                            vscode.window.showErrorMessage('Internal Error: Browser Proxy is not initialized.');
                            return;
                        }

                        // Make getChiiUrl async to allow backend target discovery with retries
                        this._proxyServer.getChiiUrl().then(result => {
                            // console.log(`[BrowserPanel] STEP: Fetched Chii URL from ProxyServer:`, result);
                            
                            if (result.error) {
                                console.error('[BrowserPanel] ERROR:', result.error);
                                vscode.window.showErrorMessage(`DevTools Error: ${result.error}`);
                                return;
                            }
                            
                            if (!result.url) {
                                console.warn('[BrowserPanel] WARNING: No URL returned from ProxyServer');
                                vscode.window.showErrorMessage('DevTools is not ready. Please load a localhost URL first.');
                                return;
                            }

                            // console.log('[BrowserPanel] SUCCESS: Sending toggleInternalDevTools message to Webview');
                            this._panel.webview.postMessage({ 
                                command: 'toggleInternalDevTools', 
                                chiiUrl: result.url
                            });
                        }).catch(err => {
                            console.error('[BrowserPanel] ERROR: getChiiUrl failed:', err);
                            vscode.window.showErrorMessage(`Failed to start DevTools: ${err.message}`);
                        });
                        return;
                    
                    // Handle storage requests from webview
                    case 'storageRequest':
                        this._handleStorageRequest(message.storageType);
                        return;
                    
                    // Handle storage updates from webview
                    case 'storageUpdate':
                        this._handleStorageUpdate(message.storageType, message.action, message.key, message.value);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private _sendBookmarks() {
        // console.log('[BrowserPanel] Sending bookmarks to webview:', this._bookmarks);
        this._panel.webview.postMessage({
            command: 'loadBookmarks',
            bookmarks: this._bookmarks
        });
    }

    private _saveBookmarks(bookmarks: any[]) {
        this._bookmarks = bookmarks;
        this._context.globalState.update('copilot-bridge-bookmarks', bookmarks);
        // console.log('[BrowserPanel] Bookmarks saved to globalState:', bookmarks);
    }

    private async _handleScreenshotCopied() {
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open');
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        } catch (e) {
            vscode.window.showErrorMessage(`Screenshot copied to clipboard. (Auto-paste failed: ${e})`);
        }
    }

    private async _handleScreenshotCaptured(base64Data: string) {
        try {
            console.log('[DEBUG] 🔧 Extension received screenshotCaptured, size:', base64Data?.length);
            const startTime = Date.now();
            
            // 0. Save original clipboard
            console.log('[DEBUG] 📋 Reading original clipboard...');
            const originalClipboard = await vscode.env.clipboard.readText();
            console.log('[DEBUG] ✅ Original clipboard saved');

            // 1. Process image data
            console.log('[DEBUG] 🔄 Processing image data...');
            const base64Image = base64Data.split(';base64,').pop();
            if (!base64Image) {
                console.error('[DEBUG] ❌ Invalid image data - no base64 found');
                return;
            }
            console.log('[DEBUG] ✅ Base64 extracted, length:', base64Image.length);

            const buffer = Buffer.from(base64Image, 'base64');
            console.log('[DEBUG] ✅ Buffer created, size:', buffer.length);
            
            // 2. Use OS temp directory for temporary file storage
            const os = require('os');
            const tempDir = os.tmpdir();
            const filePath = path.join(tempDir, `copilot-screenshot-${Date.now()}.png`);
            
            // 3. Save file temporarily
            console.log('[DEBUG] 💾 Writing temp file:', filePath);
            await fs.promises.writeFile(filePath, buffer);
            console.log('[DEBUG] ✅ Temp file written');
            
            // 4. Copy to clipboard using cross-platform img-clipboard
            console.log('[DEBUG] 📋 Copying image to clipboard...');
            const [err, stdout, stderr] = await copyImg(filePath);
            console.log('[DEBUG] 📋 Clipboard copy result - err:', err ? err.message : 'SUCCESS');
            
            if (err) {
                // Handle platform-specific errors
                if (err.code === ErrorCodes.COMMAND_NOT_FOUND && process.platform === 'linux') {
                    const missingPackage = isWayland() ? 'wl-clipboard' : 'xclip';
                    vscode.window.showErrorMessage(
                        `Screenshot failed: ${missingPackage} is not installed. Please install it using your package manager.`
                    );
                } else {
                    vscode.window.showErrorMessage(`Screenshot clipboard error: ${stdout || stderr || err.message}`);
                }
                // Cleanup temp file on error
                try {
                    await fs.promises.unlink(filePath);
                } catch (cleanupErr) {
                    console.error('[BrowserPanel] Failed to delete temp screenshot:', cleanupErr);
                }
                return;
            }
            
            // 5. Open chat and paste
            console.log('[DEBUG] 💬 Opening Copilot Chat...');
            await vscode.commands.executeCommand('workbench.action.chat.open');
            console.log('[DEBUG] ✅ Chat opened');
            
            setTimeout(async () => {
                console.log('[DEBUG] 📋 Pasting to chat...');
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                console.log('[DEBUG] ✅ Pasted to chat!');
                console.log(`[DEBUG] ⏱️ Total time: ${Date.now() - startTime}ms`);
                
                // 6. Cleanup: Delete temp file and restore original clipboard
                setTimeout(async () => {
                    await vscode.env.clipboard.writeText(originalClipboard);
                    // Delete the temporary file
                    try {
                        await fs.promises.unlink(filePath);
                    } catch (err) {
                        console.error('[BrowserPanel] Failed to delete temp screenshot:', err);
                    }
                }, 1000);
            }, 100);
            
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to handle screenshot: ${e.message}`);
        }
    }

    private async _handleElementPicked(text: string, elementScreenshot?: string) {
        if (!text) return;
        
        console.log('[DEBUG] 🔧 Extension received elementPicked');
        console.log('[DEBUG] 📸 Element screenshot length:', elementScreenshot?.length || 0);
        
        // Always log to output panel
        vscode.window.showInformationMessage(`Element picked! Screenshot: ${elementScreenshot ? 'YES' : 'NO'}`);
        console.log('[VisualBrowser] Element picked - screenshot length:', elementScreenshot?.length || 0);
        
        const startTime = Date.now();
        
        // 0. Save original clipboard
        console.log('[DEBUG] 📋 Reading original clipboard...');
        const originalClipboard = await vscode.env.clipboard.readText();
        console.log('[DEBUG] ✅ Original clipboard saved');

        let filePath: string | undefined;
        
        // 1. If there's an element screenshot, process and copy it FIRST (like snipper)
        if (elementScreenshot) {
            console.log('[DEBUG] 🔄 Processing element screenshot...');
            try {
                // Process image data (same as snipper)
                const base64Image = elementScreenshot.split(';base64,').pop();
                if (!base64Image) {
                    console.error('[DEBUG] ❌ Invalid image data - no base64 found');
                    return;
                }
                
                const buffer = Buffer.from(base64Image, 'base64');
                
                // Use OS temp directory
                const os = require('os');
                const tempDir = os.tmpdir();
                filePath = path.join(tempDir, `copilot-element-${Date.now()}.png`);
                
                // Save file temporarily
                console.log('[DEBUG] 💾 Writing temp file:', filePath);
                await fs.promises.writeFile(filePath, buffer);
                console.log('[DEBUG] ✅ Temp file written');
                
                // Copy to clipboard using cross-platform img-clipboard
                console.log('[DEBUG] 📋 Copying image to clipboard...');
                const [err, stdout, stderr] = await copyImg(filePath);
                console.log('[DEBUG] 📋 Clipboard copy result - err:', err ? err.message : 'SUCCESS');
                
                if (err) {
                    console.error('[DEBUG] ❌ Image clipboard failed:', err.message);
                    vscode.window.showErrorMessage(`Screenshot clipboard error: ${err.message}`);
                    try {
                        if (filePath) await fs.promises.unlink(filePath);
                    } catch {}
                    return;
                }
                
                // 2. Open chat and paste image FIRST
                console.log('[DEBUG] 💬 Opening Copilot Chat...');
                await vscode.commands.executeCommand('workbench.action.chat.open');
                console.log('[DEBUG] ✅ Chat opened');
                
                // Wait longer for chat to fully open
                await new Promise(resolve => setTimeout(resolve, 300));
                
                console.log('[DEBUG] 📋 Pasting image to chat...');
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                console.log('[DEBUG] ✅ Image pasted to chat!');
                
                console.log('[DEBUG] ⏱️ Image paste done, time so far:', Date.now() - startTime, 'ms');
                
            } catch (imgErr) {
                console.error('[DEBUG] ❌ Element screenshot processing failed:', imgErr);
            }
        }
        
        // 3. NOW copy picked element text to clipboard and paste
        console.log('[DEBUG] 📝 Copying text to clipboard...');
        await vscode.env.clipboard.writeText(text + '\n');
        console.log('[DEBUG] ✅ Text copied to clipboard');

        try {
            // 4. Open chat (or ensure it's open) and paste text
            await vscode.commands.executeCommand('workbench.action.chat.open');
            console.log('[DEBUG] 💬 Chat opened for text');
            
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
            console.log('[DEBUG] ✅ Text pasted to chat!');
            
            console.log(`[DEBUG] ⏱️ Total time: ${Date.now() - startTime}ms`);
            
            // 5. SUCCESS: Restore original clipboard after a short delay
            setTimeout(async () => {
                await vscode.env.clipboard.writeText(originalClipboard);
                // Clean up temp file AFTER everything is done
                if (filePath) {
                    try {
                        await fs.promises.unlink(filePath);
                    } catch {}
                }
            }, 1000);

        } catch (e) {
            // 5. FAILURE: Keep picked element in clipboard for manual paste
            console.error('[DEBUG] ❌ Failed to paste to chat:', e);
            vscode.window.showInformationMessage(`Element details + screenshot copied. Paste manually with Ctrl+V.`);
            // Still try to clean up
            if (filePath) {
                try {
                    await fs.promises.unlink(filePath);
                } catch {}
            }
        }
    }

    private async _copyImageToClipboard(base64Data: string): Promise<void> {
        // Extract base64 image data
        const base64Image = base64Data.split(';base64,').pop();
        if (!base64Image) {
            console.log('[BrowserPanel] No base64 data found');
            return;
        }

        console.log('[BrowserPanel] Copying image to clipboard, size:', base64Image.length);
        
        // Use Electron's native clipboard API (built into VS Code)
        try {
            const nativeImage = require('electron').nativeImage;
            const { clipboard } = require('electron');
            
            if (nativeImage && clipboard) {
                const image = nativeImage.createFromBuffer(Buffer.from(base64Image, 'base64'));
                clipboard.writeImage(image);
                console.log('[BrowserPanel] Image copied via Electron clipboard!');
                vscode.window.showInformationMessage('Screenshot copied to clipboard!');
                return;
            }
        } catch (e) {
            console.log('[BrowserPanel] Electron clipboard error:', e);
            vscode.window.showErrorMessage('Failed to copy screenshot to clipboard');
        }
    }

    private async _loadUrl(url: string) {
        // Handle protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            if (url.includes('localhost') || url.includes('127.0.0.1')) {
                 url = 'http://' + url;
            } else {
                 url = 'https://' + url;
            }
        }
        
        // Resolve relative links if we have a current URL context
        try {
            if (this._currentUrl && !url.startsWith('http')) {
                url = new URL(url, this._currentUrl).href;
            }
        } catch (e) {
            // Ignore invalid URL construction
        }

        this._currentUrl = url;
        
        // Check if this is a localhost URL
        const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
        
        if (isLocalhost) {
            // Use PROXY for localhost (replacing iframe method to support picker)
            await this._loadLocalhostViaProxy(url);
        } else {
            // Use proxy fetch for external sites
            this._loadExternalSite(url);
        }
    }

    private async _loadLocalhostViaProxy(url: string) {
        try {
            const targetPort = new URL(url).port || (url.startsWith('https') ? '443' : '80');
            
            // Start our proxy server targeting the localhost app
            const proxyPort = await this._proxyServer.start(parseInt(targetPort));
            
            // Generate a localhost URL pointing to our proxy
            const proxyUrl = `http://127.0.0.1:${proxyPort}${new URL(url).pathname}${new URL(url).search}`;
            
            // Use VS Code's tunnel to access our proxy inside the webview
            // VS Code tunneling works great for 127.0.0.1
            const uri = vscode.Uri.parse(proxyUrl);
            const tunneled = await vscode.env.asExternalUri(uri);
            
            // console.log(`Tunneling Localhost via Proxy: ${url} -> Proxy:${proxyPort} -> ${tunneled}`);

            // Send Chii URL to frontend early if available
            setTimeout(async () => {
                 const result = await this._proxyServer.getChiiUrl();
                 // console.log(`[BrowserPanel] Background Chii discovery:`, result);
                 if (result.url) {
                     this._panel.webview.postMessage({ command: 'updateChiiUrl', chiiUrl: result.url });
                 }
            }, 2000);

            // Load the proxy URL into the webview using iframe? No, using fetch/html replacement or direct navigation?
            // If we use simple HTML string injection, we lose HMR.
            // If we use iframe, we lose Picker (Cross Origin).
            // BUT, if the iframe src is receiving the INJECTED script, then it is NOT Cross Origin in terms of *script execution* context if we control the content?
            // WAIT. If we load the proxy URL directly in an iframe, the domain is the proxy domain (tunnel).
            // The extension content script is injected into that frame by the proxy.
            // Since the script is IN the frame, it can access the frame's DOM.
            // So we CAN use iframe + Proxy Injection.
            
            this._updateWithIframe(tunneled.toString(), url, true);
 
             // Notify React toolbar
             setTimeout(() => {
                this._panel.webview.postMessage({ command: 'updateUrl', url: url });
                this._panel.webview.postMessage({ command: 'updatePageTitle', title: 'Localhost App (Proxied)' });
                this._panel.webview.postMessage({ command: 'setLocalhostMode', isLocalhost: true }); // Still mark as localhost for UI badges, but we enable picker?
                // actually, we should tell UI that picker IS available.
                // We'll trust the injected script to work.
                this._panel.webview.postMessage({ command: 'setLocalhostMode', isLocalhost: false }); // Hack: Tell UI it's "external" (or normal) so it doesn't disable picker.
            }, 100);

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load localhost proxy: ${error.message}`);
            this._updateContent(`<h1>Error loading localhost</h1><p>${error.message}</p>`, url);
        }
    }

    private _loadExternalSite(url: string) {
        // Load external site in an iframe to isolate it from the toolbar
        // This prevents external site JavaScript errors from crashing the UI
        this._loadExternalSiteViaIframe(url);
    }

    private _loadExternalSiteViaIframe(url: string) {
        const webview = this._panel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview-bundle.js'));
        
        this._panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline' ws: wss: data: blob:; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Visual Browser - ${this._escapeHtml(url)}</title>
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        overflow: hidden;
                        background: #1e1e1e;
                    }
                    #external-iframe {
                        position: absolute;
                        top: 75px; 
                        left: 0;
                        width: 100%;
                        height: calc(100% - 75px);
                        border: none;
                    }
                </style>
            </head>
            <body>
                <div id="react-toolbar-root" style="position: fixed; top: 0; left: 0; width: 100%; z-index: 10000; height: 75px;"></div>
                <iframe 
                    id="external-iframe"
                    src="${url}"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation allow-storage-access-by-user-activation"
                    allow="cross-origin-isolated; clipboard-read; clipboard-write; geolocation; microphone; camera;">
                </iframe>
                <script src="${scriptUri}"></script>
                <script>
                    // Notify React when iframe loads
                    document.getElementById('external-iframe').onload = function() {
                        try {
                            window.parent.postMessage({ command: 'updatePageTitle', title: document.getElementById('external-iframe').contentWindow.document.title }, '*');
                        } catch(e) {
                            // Cross-origin - can't access title
                        }
                    };
                    
                    // Handle iframe errors gracefully
                    document.getElementById('external-iframe').onerror = function() {
                        console.log('Iframe failed to load');
                    };
                </script>
            </body>
            </html>
        `;
        
        // Notify toolbar of the URL
        setTimeout(() => {
            this._panel.webview.postMessage({ command: 'updateUrl', url: url });
            this._panel.webview.postMessage({ command: 'updatePageTitle', title: 'External Page' });
            this._panel.webview.postMessage({ command: 'setLocalhostMode', isLocalhost: false });
        }, 100);
    }
    
    private _escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private _updateWithIframe(iframeUrl: string, displayUrl: string, isProxy: boolean = false) {
        // If proxied, the toolbar is INSIDE the iframe (injected).
        // So we only need the iframe here.
        // BUT, the outer React toolbar (the one we built in VS Code extension context) controls the navigation.
        // We have TWO toolbars now?
        // 1. The React App Toolbar (outer frame)
        // 2. The Injected Toolbar (inner frame)
        
        // Strategy: 
        // For Localhost Proxy, we want the OUTER toolbar to control the inner iframe.
        // The inner iframe has the picker script injected.
        // We do NOT need the full toolbar injected into the inner frame if we have the outer one.
        // We only need the picker logic injected.
        
        // HOWEVER, my ProxyServer implementation currently injects the whole toolbar HTML.
        // That's fine for now, but double toolbars might look weird.
        // Let's adjust ProxyServer later to only inject script if needed.
        // For now, let's assume ProxyServer injects the picker script AND listeners.
        
        const webview = this._panel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview-bundle.js'));

        this._panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline' ws: wss: data: blob:; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Copilot Browser - Localhost</title>
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        overflow: hidden;
                        background: #1e1e1e;
                    }
                    #localhost-iframe {
                        position: absolute;
                        top: 75px; 
                        left: 0;
                        width: 100%;
                        height: calc(100% - 75px);
                        border: none;
                    }
                </style>
            </head>
            <body>
                <div id="react-toolbar-root" style="position: fixed; top: 0; left: 0; width: 100%; z-index: 10000; height: 75px;"></div>
                <iframe 
                    id="localhost-iframe"
                    src="${iframeUrl}" 
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation allow-storage-access-by-user-activation"
                    allow="cross-origin-isolated; clipboard-read; clipboard-write; geolocation; microphone; camera;">
                </iframe>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private _extractPageTitle(html: string): string {
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        return titleMatch ? titleMatch[1].trim() : '';
    }

    // In-memory storage for webview communication
    private _webviewLocalStorage: Record<string, string> = {};
    private _webviewSessionStorage: Record<string, string> = {};

    /**
     * Handle storage requests from webview - send stored data back
     */
    private _handleStorageRequest(storageType: string): void {
        let data: Record<string, string>;
        
        if (storageType === 'localStorage') {
            data = this._webviewLocalStorage;
        } else if (storageType === 'sessionStorage') {
            data = this._webviewSessionStorage;
        } else {
            return;
        }

        // Send storage data to webview (will be forwarded to iframe)
        this._panel.webview.postMessage({
            command: 'storageData',
            storageType: storageType,
            data: data
        });
    }

    /**
     * Handle storage updates from webview
     */
    private _handleStorageUpdate(storageType: string, action: string, key?: string, value?: string): void {
        if (storageType === 'localStorage') {
            if (action === 'set' && key !== undefined && value !== undefined) {
                this._webviewLocalStorage[key] = value;
            } else if (action === 'remove' && key !== undefined) {
                delete this._webviewLocalStorage[key];
            } else if (action === 'clear') {
                this._webviewLocalStorage = {};
            }
        } else if (storageType === 'sessionStorage') {
            if (action === 'set' && key !== undefined && value !== undefined) {
                this._webviewSessionStorage[key] = value;
            } else if (action === 'remove' && key !== undefined) {
                delete this._webviewSessionStorage[key];
            } else if (action === 'clear') {
                this._webviewSessionStorage = {};
            }
        }
        
        // Forward to iframe if it exists (for localhost mode)
        this._panel.webview.postMessage({
            command: 'storageData',
            storageType: storageType,
            data: storageType === 'localStorage' ? this._webviewLocalStorage : this._webviewSessionStorage
        });
    }

    private _updateContent(html: string, baseUrl: string) {
        const webview = this._panel.webview;
        const pageTitle = this._extractPageTitle(html);
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview-bundle.js'));
        const baseTag = `<base href="${baseUrl}">`;
        
        // Generate storage polyfill
        const storageInjection = this._generateStoragePolyfill();
        
        const scriptTag = `<script src="${scriptUri}"></script>`;
        
        // Root element for React Toolbar
        const toolbarRoot = '<div id="react-toolbar-root" style="position: fixed; top: 0; left: 0; width: 100%; z-index: 10000; height: 75px;"></div>';
        
        // Body Padding Style
        const bodyPaddingStyle = '<style>body { padding-top: 75px !important; margin-top: 0 !important; }</style>';

        // Inject Head (Base + Style + Storage Polyfill)
        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>${baseTag}${bodyPaddingStyle}${storageInjection}`);
        } else {
            html = `${baseTag}${bodyPaddingStyle}${storageInjection}${html}`;
        }

        // Remove any existing toolbar roots if they exist in the page we fetched
        html = html.replace(/<div id="react-toolbar-root"[^>]*><\/div>/gi, '');

        // Inject Toolbar Root at the start of body
        if (html.includes('<body')) {
            // Handle body tags with attributes
            html = html.replace(/<body([^>]*)>/i, (match, attrs) => {
                return `<body${attrs}>${toolbarRoot}`;
            });
        } else {
            html = toolbarRoot + html;
        }

        // Inject Body Script
        if (html.includes('</body>')) {
            html = html.replace('</body>', `${scriptTag}</body>`);
        } else {
            html += scriptTag;
        }

        this._panel.webview.html = html;
        
        setTimeout(() => {
            this._panel.webview.postMessage({ command: 'updatePageTitle', title: pageTitle });
            this._panel.webview.postMessage({ command: 'updateUrl', url: baseUrl });
            this._panel.webview.postMessage({ command: 'setLocalhostMode', isLocalhost: false });
        }, 100);
    }

    /**
     * Generate optimized storage polyfill for external sites
     */
    private _generateStoragePolyfill(): string {
        return `
<script>
(function() {
    // Optimized Storage Implementation
    
    var _localStorageData = {};
    var _sessionStorageData = {};
    var _initialized = false;

    // Storage Event Dispatcher
    function dispatchStorageEvent(key, newValue, oldValue, url) {
        try {
            var event = new StorageEvent('storage', {
                key: key,
                newValue: newValue,
                oldValue: oldValue,
                url: url || window.location.href
            });
            window.dispatchEvent(event);
        } catch (e) {
            // Ignore - most code doesn't rely on storage events
        }
    }

    // LocalStorage Proxy
    var localStorage = {
        getItem: function(key) { return _localStorageData.hasOwnProperty(key) ? _localStorageData[key] : null; },
        setItem: function(key, value) {
            var oldValue = _localStorageData.hasOwnProperty(key) ? _localStorageData[key] : null;
            _localStorageData[key] = String(value);
            dispatchStorageEvent(key, value, oldValue);
            try { window.parent.postMessage({ command: 'storageUpdate', type: 'localStorage', action: 'set', key: key, value: value }, '*'); } catch(e) {}
        },
        removeItem: function(key) {
            var oldValue = _localStorageData.hasOwnProperty(key) ? _localStorageData[key] : null;
            delete _localStorageData[key];
            dispatchStorageEvent(key, null, oldValue);
            try { window.parent.postMessage({ command: 'storageUpdate', type: 'localStorage', action: 'remove', key: key }, '*'); } catch(e) {}
        },
        clear: function() { _localStorageData = {}; try { window.parent.postMessage({ command: 'storageUpdate', type: 'localStorage', action: 'clear' }, '*'); } catch(e) {} },
        key: function(index) { var keys = Object.keys(_localStorageData); return keys[index] || null; },
        get length() { return Object.keys(_localStorageData).length; }
    };

    Object.defineProperty(window, 'localStorage', { get: function() { return localStorage; }, set: function() {}, configurable: false });

    // SessionStorage Proxy
    var sessionStorage = {
        getItem: function(key) { return _sessionStorageData.hasOwnProperty(key) ? _sessionStorageData[key] : null; },
        setItem: function(key, value) {
            var oldValue = _sessionStorageData.hasOwnProperty(key) ? _sessionStorageData[key] : null;
            _sessionStorageData[key] = String(value);
            dispatchStorageEvent(key, value, oldValue);
            try { window.parent.postMessage({ command: 'storageUpdate', type: 'sessionStorage', action: 'set', key: key, value: value }, '*'); } catch(e) {}
        },
        removeItem: function(key) {
            var oldValue = _sessionStorageData.hasOwnProperty(key) ? _sessionStorageData[key] : null;
            delete _sessionStorageData[key];
            dispatchStorageEvent(key, null, oldValue);
            try { window.parent.postMessage({ command: 'storageUpdate', type: 'sessionStorage', action: 'remove', key: key }, '*'); } catch(e) {}
        },
        clear: function() { _sessionStorageData = {}; try { window.parent.postMessage({ command: 'storageUpdate', type: 'sessionStorage', action: 'clear' }, '*'); } catch(e) {} },
        key: function(index) { var keys = Object.keys(_sessionStorageData); return keys[index] || null; },
        get length() { return Object.keys(_sessionStorageData).length; }
    };

    Object.defineProperty(window, 'sessionStorage', { get: function() { return sessionStorage; }, set: function() {}, configurable: false });

    // Request storage data from parent on load
    try {
        window.parent.postMessage({ command: 'storageRequest', type: 'localStorage' }, '*');
        window.parent.postMessage({ command: 'storageRequest', type: 'sessionStorage' }, '*');
    } catch(e) {}

    // Listen for storage data from parent
    window.addEventListener('message', function(event) {
        try {
            if (event.data && event.data.command === 'storageData') {
                if (event.data.storageType === 'localStorage' && event.data.data) {
                    _localStorageData = event.data.data;
                    _initialized = true;
                } else if (event.data.storageType === 'sessionStorage' && event.data.data) {
                    _sessionStorageData = event.data.data;
                }
            }
        } catch(e) {}
    });

    console.log('[Storage] Optimized storage initialized');
})();
</script>
        `;
    }

    private _update() {
        const webview = this._panel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview-bundle.js'));
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'logo.png'));

        this._panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline' data: blob:; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Visual Browser</title>
                <style>
                    :root {
                      --text-primary: var(--vscode-foreground);
                      --text-secondary: var(--vscode-descriptionForeground);
                      --bg-main: var(--vscode-editor-background);
                    }

                    body {
                      margin: 0;
                      font-family: var(--vscode-font-family);
                      background: var(--bg-main);
                      color: var(--text-primary);
                      overflow: hidden;
                    }

                    #landing-container {
                        position: absolute;
                        top: 75px;
                        left: 0;
                        width: 100%;
                        height: calc(100% - 75px);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        text-align: center;
                    }

                    .welcome-content {
                      max-width: 400px;
                      padding: 2rem;
                      animation: fadeIn 0.5s ease-out;
                      display: flex;
                      flex-direction: column;
                      align-items: center;
                    }

                    @keyframes fadeIn {
                      from { opacity: 0; transform: translateY(10px); }
                      to { opacity: 1; transform: translateY(0); }
                    }

                    .logo {
                        width: 120px;
                        height: 120px;
                        margin-bottom: 1.5rem;
                        border-radius: 24px;
                        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                    }

                    h1 {
                      margin: 0 0 1rem 0;
                      font-size: 2rem;
                      font-weight: 500;
                      color: var(--vscode-editor-foreground);
                    }

                    p {
                      margin: 0;
                      line-height: 1.6;
                      font-size: 1.1rem;
                      color: var(--text-secondary);
                    }

                    .hint {
                      margin-top: 2rem;
                      font-size: 0.9rem;
                      opacity: 0.6;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      gap: 8px;
                    }
                </style>
            </head>
            <body>
                <div id="react-toolbar-root" style="position: fixed; top: 0; left: 0; width: 100%; z-index: 10000; height: 75px;"></div>
                <div id="landing-container">
                    <div class="welcome-content">
                      <img src="${logoUri}" class="logo" alt="Visual Browser Logo">
                      <h1>Welcome to Visual Browser</h1>
                      <p>Enter a URL in the toolbar above to start browsing.</p>
                      <div class="hint">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        Integrated web view for VS Code
                      </div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    public dispose() {
        BrowserPanel.currentPanel = undefined;
        this._panel.dispose();
        
        // Async cleanup for proxy server
        if (this._proxyServer) {
            this._proxyServer.stop();
            // Give servers time to close gracefully
            setTimeout(() => {
                // console.log('[BrowserPanel] Cleanup complete');
            }, 100);
        }
        
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
