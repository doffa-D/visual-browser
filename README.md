# Visual Browser for VS Code

<p align="center">
  <img src="https://raw.githubusercontent.com/doffa-D/visual-browser/main/logo.png" alt="Visual Browser Logo" width="128" height="128"/>
</p>

> Integrated web browser for VS Code with AI-powered element inspection tools

Visual Browser is the missing bridge between your web app and AI. Browse websites directly in VS Code and capture elements with one click for your AI coding assistant.

## Overview

Built a website and need AI to help modify it? Visual Browser lets you:
- Browse any website (local or remote) inside VS Code
- Click any element to capture its HTML, styles, and context
- Take screenshots and paste directly into Copilot Chat
- Inspect network requests and console logs

## Features

### 🌐 Full-Featured Browser
- Browse localhost and external websites within VS Code
- URL persistence - your last visited page is restored on reload
- Bookmarks support with persistent storage
- Modern, VS Code-native toolbar

### 🎯 AI Element Picker
- Click any element to capture full context (DOM path, styles, HTML)
- Perfect for describing UI elements to AI assistants
- High-quality 2x resolution captures

### 📸 Smart Screenshots
- Drag to select any region
- Automatically copies to clipboard
- Paste directly into Copilot Chat

### 🔧 Developer Tools
- Integrated DevTools panel (network, console, elements)
- Proxy support for localhost deep inspection
- Works with Vite, React, Angular, Vue, and more

### 💾 Persistent Storage
- Cookies saved between sessions
- localStorage/sessionStorage preserved
- IndexedDB support

## Requirements

- VS Code 1.96.0 or later
- GitHub Copilot (for AI features)

## Installation

1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=doffa.visual-browser)
2. Or search "Visual Browser" in VS Code Extensions

## Usage

### Opening the Browser
- Click the **Globe icon** in the editor title bar
- Or press `F1` and run `Open Visual Browser`

### Browsing
1. Enter any URL in the address bar
2. For localhost (e.g., `http://localhost:5173`), deep inspection is enabled

### Picking Elements
1. Click the **Cursor icon** in the toolbar
2. Hover over any element - it will be highlighted
3. Click to capture - the element info is copied to clipboard

### Taking Screenshots
1. Click the **Camera icon**
2. Drag to select an area
3. Screenshot is copied - paste into Copilot Chat

### DevTools
1. Click the **Terminal icon** to open inspection panel
2. Available: Console, Network, Elements

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open Browser | `Ctrl+Shift+G` |
| Pick Element | `Ctrl+Shift+P` |
| Screenshot | `Ctrl+Shift+S` |

## Configuration

```json
{
  "visualBrowser.enableDebugLogs": true
}
```

Enable debug logs for troubleshooting proxy issues.

## Release Notes

### 1.0.4
- Fixed URL persistence - last visited page restored on reload

### 1.0.3
- Added persistent storage (cookies, localStorage, sessionStorage)
- Improved external site stability with iframe isolation

### 1.0.2
- Added bookmarks support
- High-quality element picker (2x resolution)

### 1.0.1
- Initial release

---

<p align="center">
Made with ❤️ for AI-powered development
</p>


