# 3D Shooter Game

A fast, wave-based first-person shooter built with Three.js. The UI and menus emphasize clarity, feedback, and accessibility while keeping gameplay responsive.

## Browser MCP Integration

This project supports Browser MCP for browser automation. This allows AI assistants (VS Code, Cursor, Claude, etc.) to interact with and test the game in a browser.

### Setup

1. **For Cursor/Claude Desktop**: Add this configuration to your MCP settings file:
   ```json
   {
     "mcpServers": {
       "browser": {
         "command": "npx",
         "args": ["-y", "@browserbase/mcp-server-browser"],
         "env": {}
       }
     }
   }
   ```

2. **For VS Code with MCP extension**: Copy `.mcp-config.json` to your settings or use the MCP extension to add the server.

3. Start the game with `node server.js`

### Usage

Once configured, you can ask your AI assistant to:
- Open and test the game in a browser
- Take screenshots of the game
- Interact with UI elements
- Debug game issues

**Note**: Browser MCP will be downloaded automatically via npx when first used.

### Option 1: Node.js (Recommended)

1. Open a terminal in this folder.
2. Run:
   ```
   node server.js
   ```
3. Open http://localhost:3000

### Option 2: Python

1. Open a terminal in this folder.
2. Run:
   ```
   python -m http.server 3000
   ```
3. Open http://localhost:3000

### Option 3: VS Code Live Server

1. Open this folder in VS Code.
2. Install the Live Server extension.
3. Right-click `index.html` and choose "Open with Live Server".

## Controls

- **WASD**: Move
- **Mouse**: Aim / Look
- **Left Click**: Shoot
- **R**: Reload
- **Shift**: Sprint
- **ESC**: Pause
- **Enter / Space**: Start, resume, or restart
- **+ / - / 0**: UI scale up, down, reset

## Features

- Wave-based enemy spawns with scaling difficulty
- Modern HUD with health, ammo, wave, score, and enemy count
- Reload progress indicator and low-ammo prompts
- Damage feedback with directional indicator and screen flash
- Muzzle flash, hit markers, and particle effects
- Ambient UI audio feedback
- Loading progress screen
- UI scale persistence and basic accessibility labels
- Optional debug spawn button via `?debug`

## Notes

- Best played with pointer lock enabled (click the canvas once the match starts).
- If performance dips, the game will auto-reduce some visual effects.
