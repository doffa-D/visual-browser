# Visual Browser for VS Code

Visual Browser is the missing bridge between your web app and AI. It's a high-fidelity "AI Picker" that lives inside VS Code, designed to close the gap between your browser and your AI-powered development workflow.

## 🚀 The AI-First Workflow

Web development with AI is powerful, but context switching is the bottleneck. Visual Browser removes the friction of copying HTML, describing elements, or taking manual screenshots.

- **AI Element Picker**: Click any element in your live app to instantly capture its full context (DOM, styles, structure) and paste it directly into GitHub Copilot Chat.
- **Visual Context for AI**: No more manual descriptions. Just point, click, and tell the AI what to change.
- **Smart Screenshots**: Select a region to auto-copy and paste visual context directly into your AI workflow.
- **Real-time Feedback**: See your changes instantly without leaving your editor.

## ✨ Features

- **Built-in Browser:** Browse your local or remote sites directly within VS Code.
- **Localhost Proxy:** Seamlessly tunnels your `localhost` traffic into the webview with automatic script injection (optimized for Vite, React, and modern frameworks).
- **Deep Inspection**: Extract DOM paths, computed styles, layout info, and raw HTML snippets with one click.
- **Embedded DevTools:** Integrated Chromium-like Developer Tools panel for network, console, and element inspection.
- **Modern UI:** A sleek, compact toolbar with glassmorphism effects that feels native to VS Code.

## 🛠️ How to use

1. **Activate:** Use the **Globe Icon** in the Editor Title bar or Status Bar, or run the command `Open Visual Browser`.
2. **Localhost Mode:** Enter your local dev server URL (e.g., `http://localhost:5173`). The bridge will proxy the connection to allow deep inspection.
3. **AI Pick:** Click the **Selection Icon** (mouse cursor) to start picking elements. The context is automatically copied to your clipboard.
4. **Snipper:** Click the **Camera Icon** and drag over an area to capture a screenshot and paste it into Copilot Chat.
5. **DevTools:** Click the **Terminal Icon** to open the internal inspection console.

## ⚙️ Configuration

- `visualBrowser.enableDebugLogs`: Toggle internal proxy logging for troubleshooting.

---

*Currently optimized for VS Code with GitHub Copilot. Support for other editors (Cursor, Windsurf) coming soon.*


