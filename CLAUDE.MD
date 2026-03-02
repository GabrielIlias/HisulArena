 # HisulArena Project Guidelines

## Overview
You are building HisulArena, a light-hearted humorous PWA with 3 mini-games themed around IDF eliminations of terrorists (Hamas, Hezbollah, IRGC). Use cute cartoons/caricatures (no real photos), Israeli black humor, dark-red-black design. RTL Hebrew layout. MVP stage: use cards.json for eliminated/alive data. Iterative build, focus on one feature at a time.

## Key Rules
- **Always invoke the front-end design skill** before writing any front-end code (HTML/CSS/JS) in every session, no exceptions. This ensures modern, professional, non-AI-vibe designs with animations where appropriate.
- Keep code clean, modular, and PWA-ready (manifest.json, service worker).
- Use Socket.io for War game multiplayer (1v1 via room code).
- For games: Memory (single-player with eliminated cards), War (multiplayer card battle), Betting (on next elimination from alive list).
- Humor: Light and playful, no graphic violence.
- Assets: Check brand_assets folder for any logos/guidelines/colors (#1a1a1a background, #cc0000 red, #000000 black). If none, default to dark theme.

## Screenshot Workflow
- Use Puppeteer for screenshot loop: After building UI, start local server, take screenshots of key sections (e.g., hero, game boards), review and polish in 2 passes. Store in temporary_screenshots folder.
- If Puppeteer not set up, install it via npm and configure when prompted.

## Data Handling
- Load cards from cards.json: eliminated for memory/War, alive for betting.
- No real-time data; static JSON for MVP.

## Best Practices
- Concise responses: Plan, then execute.
- Test locally: Use localhost for previews.
- Inspiration: If user provides website links, clone/improve using screenshots.
- Update this file if project evolves.