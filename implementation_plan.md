# Unity Conversion Plan

This plan outlines how to migrate your Three.js shooter game into a Unity project. We will generate C# scripts directly into your existing `trytomakea3dshooter` project, mirroring your JavaScript logic, along with a guide on how to set them up.

## User Review Required

> [!IMPORTANT]
> **Asset Loading**: This migration focuses on **logic and code**. You will need to manually import your 3D models (GLB/FBX) into Unity and assign them to the provided scripts.
> **Physics**: This kit assumes you will use Unity's built-in `CharacterController` for the player and standard `NavMeshAgent` for enemies (optional, but recommended for pathfinding).

## Proposed Changes

We will generate the C# scripts directly into your Unity project at `c:\Users\zamee\Documents\shooter-game\trytomakea3dshooter\Assets\Scripts`.

### [NEW] [Unity Migration Kit](file:///c:/Users/zamee/Documents/shooter-game/trytomakea3dshooter/Assets)

#### [NEW] [PlayerController.cs](file:///c:/Users/zamee/Documents/shooter-game/trytomakea3dshooter/Assets/Scripts/PlayerController.cs)
- Translates `PlayerSystem.js` logic.
- Implements WASD/Shift movement using `CharacterController`.
- Implements mouse look with pitch clamping.
- Handles recoil recovery (decaying `pitch` offset).
- Implements weapon bobbing logic.

#### [NEW] [WeaponSystem.cs](file:///c:/Users/zamee/Documents/shooter-game/trytomakea3dshooter/Assets/Scripts/WeaponSystem.cs)
- Translates `WeaponSystem.js`.
- Implements Raycast-based shooting.
- Handles Ammo (Mag/Reserve) and Reloading.
- **Perfect Reload Mechanic**: Implements the 50% progress window for bonus ammo.
- Supports weapon stats (FireRate, Damage, Recoil, Spread, Pellets).

#### [NEW] [EnemyManager.cs](file:///c:/Users/zamee/Documents/shooter-game/trytomakea3dshooter/Assets/Scripts/EnemyManager.cs)
- Translates `EntityManager.js` wave logic.
- Manages wave progression, spawn timings, and archetypes (Normal, Flanker, Exploder).
- Handles enemy instantiation/pooling.

#### [NEW] [EnemyLogic.cs](file:///c:/Users/zamee/Documents/shooter-game/trytomakea3dshooter/Assets/Scripts/EnemyLogic.cs)
- Translates the AI states from `EntityManager.js`.
- **Normal**: Chase and attack.
- **Flanker**: Chase, then strafe/lean at medium range with occasional bursts.
- **Exploder**: Chase until trigger range, then fuse and explode (SphereOverlap for blast damage).

#### [NEW] [MigrationGuide.md](file:///c:/Users/zamee/Documents/shooter-game/trytomakea3dshooter/Assets/MigrationGuide.md)
- Step-by-step instructions on:
    - Setting up the Unity project (URP recommended).
    - Setting up the Player GameObject (Camera, CharacterController).
    - Setting up Enemy Prefabs.
    - Configuring the `WeaponSystem` component with your weapon stats.

## Open Questions

> [!NOTE]
> 1. Do you have a specific Unity version installed (e.g., 2022.3 LTS)?
> 2. Do you want to use the Universal Render Pipeline (URP) or the Built-In pipeline? (URP is recommended for better performance and lighting).

## Verification Plan

### Automated Tests
- Syntax check of C# scripts (ensuring types and Unity API calls are correct).

### Manual Verification
- The user will need to:
    1. Open your existing project `trytomakea3dshooter` in Unity.
    2. The scripts will appear in the `Assets/Scripts` folder in Unity.
    3. Follow the `MigrationGuide.md` (found in `Assets/`).
