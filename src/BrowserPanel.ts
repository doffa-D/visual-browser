import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { CookieJar } from 'tough-cookie';
import { URL } from 'url';
import { ProxyServer } from './proxy/ProxyServer';
const { copyImg, ErrorCodes, isWayland } = require('img-clipboard');

export class BrowserPanel {
    public static currentPanel: BrowserPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _currentUrl: string = '';
    private _bookmarks: any[] = [];
    private _cookieJar: CookieJar;
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
        this._cookieJar = new CookieJar();
        
        this._proxyServer = new ProxyServer(extensionUri);
        
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
                        this._handleElementPicked(message.text);
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
            // console.log('[Extension Debug] Screenshot received from webview');
            const startTime = Date.now();
            
            // 0. Save original clipboard
            const originalClipboard = await vscode.env.clipboard.readText();

            // 1. Process image data
            const base64Image = base64Data.split(';base64,').pop();
            if (!base64Image) return;

            const buffer = Buffer.from(base64Image, 'base64');
            
            // 2. Use OS temp directory for temporary file storage
            const os = require('os');
            const tempDir = os.tmpdir();
            const filePath = path.join(tempDir, `copilot-screenshot-${Date.now()}.png`);
            
            // 3. Save file temporarily
            // console.time('[Extension] File Write');
            await fs.promises.writeFile(filePath, buffer);
            // console.timeEnd('[Extension] File Write');
            
            // 4. Copy to clipboard using cross-platform img-clipboard
            // console.time('[Extension] Clipboard Copy (img-clipboard)');
            const [err, stdout, stderr] = await copyImg(filePath);
            // console.timeEnd('[Extension] Clipboard Copy (img-clipboard)');
            
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
            // console.time('[Extension] Chat Open & Paste');
            await vscode.commands.executeCommand('workbench.action.chat.open');
            
            setTimeout(async () => {
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                // console.timeEnd('[Extension] Chat Open & Paste');
                // console.log(`[Extension Debug] Total Extension Time: ${Date.now() - startTime}ms`);
                
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

    private async _handleElementPicked(text: string) {
        if (!text) return;
        
        // 1. Save original clipboard
        const originalClipboard = await vscode.env.clipboard.readText();
        
        // 2. Copy picked element (with newline for continuous picking)
        await vscode.env.clipboard.writeText(text + '\n');

        try {
            // 3. Attempt auto-paste
            await vscode.commands.executeCommand('workbench.action.chat.open');
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
            
            // 4. SUCCESS: Restore original clipboard after a short delay
            setTimeout(async () => {
                await vscode.env.clipboard.writeText(originalClipboard);
            }, 1000); 

        } catch (e) {
            // 5. FAILURE: Keep picked element in clipboard for manual paste
            vscode.window.showInformationMessage(`Element details copied to clipboard. Paste manually with Ctrl+V.`);
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
        const client: any = url.startsWith('https') ? https : http;
        
        // Get cookies for this URL
        this._cookieJar.getCookies(url, (err: Error | null, cookies: any[] | undefined) => {
            const cookieHeader = cookies ? cookies.join('; ') : '';
            
            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Cookie': cookieHeader
                }
            };

            const req = client.get(url, options, (res: any) => {
                // Store new cookies
                if (res.headers['set-cookie']) {
                    res.headers['set-cookie'].forEach((cookie: string) => {
                        this._cookieJar.setCookie(cookie, url, () => {});
                    });
                }

                // Handle redirects
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const nextUrl = new URL(res.headers.location, url).href;
                    this._loadUrl(nextUrl);
                    return;
                }

                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    this._updateContent(data, url);
                });

            });
            
            req.on('error', (err: any) => {
                this._updateContent(`<h1>Error loading page</h1><p>${err.message}</p>`, url);
            });
        });
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

    private _updateContent(html: string, baseUrl: string) {
        const webview = this._panel.webview;
        const pageTitle = this._extractPageTitle(html);
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview-bundle.js'));
        const baseTag = `<base href="${baseUrl}">`;
        const scriptTag = `<script src="${scriptUri}"></script>`;
        
        // Root element for React Toolbar
        const toolbarRoot = '<div id="react-toolbar-root" style="position: fixed; top: 0; left: 0; width: 100%; z-index: 10000; height: 75px;"></div>';
        
        // Body Padding Style
        const bodyPaddingStyle = '<style>body { padding-top: 75px !important; margin-top: 0 !important; }</style>';

        // Inject Head (Base + Style)
        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>${baseTag}${bodyPaddingStyle}`);
        } else {
            html = `${baseTag}${bodyPaddingStyle}${html}`;
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
