import * as vscode from 'vscode';
import { BrowserPanel } from './BrowserPanel';

export function activate(context: vscode.ExtensionContext) {
    
    // Register the command to open our internal browser
    const openBrowserCmd = vscode.commands.registerCommand('visual-browser.openBrowser', () => {
        BrowserPanel.createOrShow(context.extensionUri, context);
    });

    context.subscriptions.push(openBrowserCmd);

    // Create a Status Bar Item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'visual-browser.openBrowser';
    statusBarItem.text = '$(globe) Visual Browser';
    statusBarItem.tooltip = 'Click to open Visual Browser';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Show a helpful start message
    const msg = 'Visual Browser Ready. Run command "Visual Browser: Open" to start.';
    console.log(msg);
}

export function deactivate() {}