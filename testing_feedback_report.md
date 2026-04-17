# QA Feedback Report: 3D Shooter Security & Architecture Review

**Date:** April 17, 2026
**Audience:** Development Team
**Reviewer:** QA Lead
**Status:** **CRITICAL FAILURES DETECTED**

---

## 1. Introduction

This document provides an unhesitating, unvarnished review of the current game architecture and the recently implemented "security layers". While the initiative to secure the platform is noted, the execution demonstrates a fundamental misunderstanding of secure application design, client-server authority, and persistent data management. 

Frankly, the current implementation is security theater. If this product goes to production as-is, it will immediately suffer from critical data loss, memory leaks, and leaderboard exploitation.

## 2. Key Findings & Critical Flaws

### 2.1. Client-Side Anti-Cheat is Security Theater
The implementation of speedhack detection inside `js/systems/gameplay/PlayerSystem.js` is fundamentally flawed. In a web-based game, the client is entirely under the control of the end-user. 
* **The Flaw:** An attacker can trivially use browser DevTools (Local Overrides) or a custom extension to comment out the `if (dist > maxExpectedDist)` block, instantly disabling the anti-cheat.
* **The Verdict:** Client-side checks are only useful for UX (like rubber-banding physical collisions). Treating them as a "security layer" is unacceptable.

### 2.2. Leaderboard Exploitation is Still Trivial
While `/api/leaderboard` now requires a valid session token to ensure the submitter is authenticated, it blindly trusts the `score` and `wave` payload provided by the client.
* **The Flaw:** A user can legally log in, acquire a valid Bearer token, and then manually issue a `fetch` request sending `{ username: "myUser", score: 9999999, wave: 999 }`. The server performs zero mathematical validation on whether that score was actually earned.
* **The Verdict:** Your leaderboard is completely defenseless against authenticated spoofing. 

### 2.3. Severe Race Conditions in Database Persistence
The server uses a flat `data/users.json` and `data/leaderboard.json` file for persistence, performing `fsp.readFile` followed by `fsp.writeFile`.
* **The Flaw:** Node.js handles requests concurrently. If two users register simultaneously, or two scores are submitted simultaneously, User A reads the file, User B reads the file, User A writes the file, and User B overwrites User A's changes. User A's data is permanently lost.
* **The Verdict:** This is a catastrophic architectural failure for a multiplayer or distributed system.

### 2.4. Unbounded Memory Leak in Session Management
In `server.js`, you implemented `ACTIVE_SESSIONS = new Map()`. When a user logs in, their token is appended to this map.
* **The Flaw:** There is absolutely no garbage collection, expiration logic, or token invalidation implemented. Every single login permanently consumes server RAM. Furthermore, restarting the server wipes the map entirely, forcing all active users to re-authenticate abruptly.
* **The Verdict:** This system will crash itself with `OutOfMemory` exceptions under sustained load. 

---

## 3. Actionable Recommendations

If you want this game to survive contact with real users, you must immediately halt feature development and implement the following architectural corrections:

1. **Implement Server Authority:** Move critical game state and score tabulation to the server. The client should send inputs (or verified kill receipts), and the server must independently calculate and validate the score. Never trust the client's final score payload.
2. **Scrap JSON Flat Files:** Rip out the `users.json` and `leaderboard.json` file system logic. Integrate a legitimate, atomic database solution (e.g., SQLite, PostgreSQL, or Redis) that safely handles concurrent read/write operations and provides ACID guarantees.
3. **Session TTL & Cleanup:** Implement a Time-To-Live (TTL) for session tokens in `server.js`. Run a periodic `setInterval` task to sweep and delete expired tokens from the `ACTIVE_SESSIONS` map, or better yet, transition to stateless JWTs (JSON Web Tokens) to entirely offload session memory overhead.
4. **Obfuscate/Validate Client Logic:** While true security requires server authority, you can raise the barrier to entry by obfuscating/minifying the frontend code. However, you must stop labeling client-side speed distance checks as your primary defense against hackers.

---

## 4. Conclusion

The recent updates give the superficial appearance of security but fail entirely under basic scrutiny. The platform is exposed to automated data corruption, memory exhaustion, and trivial client spoofing. 

The development team must shift away from "quick fixes" and rudimentary implementations. Stop trying to secure the client, and start securing the authority of the server. These issues must be prioritized and resolved before any further gameplay features are added.
