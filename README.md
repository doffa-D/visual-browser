# Visual Browser for VS Code

An advanced integrated browser tool for VS Code designed for frontend debugging and modern web development.

## Features

- **Built-in Browser:** Browse your local or remote sites directly within VS Code.
- **Localhost Proxy:** Seamlessly tunnels your `localhost` traffic into the webview with automatic script injection.
- **Continuous Element Picker:** Click any element to extract its:
    - DOM Path
    - Absolute Position & Dimensions
    - Computed Styles (Colors, Fonts)
    - Layout Info (Flex/Grid, Padding, Margin)
    - Raw HTML Snippet
- **Smart Snipper (Screenshot):** Drag and select any area of the page to capture a high-quality screenshot.
- **Embedded DevTools:** Features an integrated Chromium-like Developer Tools panel (powered by Chii) for network, console, and element inspection.
- **Modern UI:** A sleek, compact toolbar with glassmorphism effects and customizable tool visibility.

## How to use

1. **Activate:** Use the **Globe Icon** in the Editor Title bar or Status Bar, or run the command `Open Visual Browser`.
2. **Localhost Mode:** Enter your local dev server URL (e.g., `http://localhost:5500`). The bridge will proxy the connection to allow deep inspection.
3. **Element Pick:** Click the **Selection Icon** (mouse cursor) to start picking elements. Multiple elements can be picked in succession.
4. **Snipper:** Click the **Camera Icon** and drag over an area to capture a screenshot.
5. **DevTools:** Click the **Terminal Icon** to open the internal inspection console.
6. **Menu:** Click the **...** icon to access Hard Refresh and toggle tool visibility.


