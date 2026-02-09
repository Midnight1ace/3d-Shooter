# 3D Shooter Game

A first-person shooter game built with Three.js.

## How to Run

### Option 1: Using Node.js (Recommended)

1. Open Command Prompt (cmd)
2. Navigate to the shooter-game folder:
   ```
   cd C:\Users\zamee\Documents\shooter-game
   ```
3. Run the server:
   ```
   node server.js
   ```
4. Open your browser and go to: **http://localhost:3000**

### Option 2: Using Python

If you have Python installed:
```
python -m http.server 3000
```
Then open http://localhost:3000

### Option 3: Using VS Code Live Server

1. Open the shooter-game folder in VS Code
2. Install the "Live Server" extension
3. Right-click on `index.html` and select "Open with Live Server"

## Controls

- **WASD** - Move
- **Mouse** - Look/Aim
- **Left Click** - Shoot
- **R** - Reload
- **ESC** - Pause

## Features

- Wave-based enemy spawning
- Health system
- Ammo/reload mechanics
- Score tracking
- Visual effects (muzzle flash, particles)
- Sound effects
