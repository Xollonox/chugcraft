# Reproduce ChugCraft 3.2 tests

Node.js 20+ is recommended. Gameplay itself needs only a modern WebGL browser.

- `npm test`: 21 core tests, 16 farming/husbandry tests and 22 building/fluid/night-visibility tests. The Node import shim uses the bundled Three.js module, so no gameplay dependency download is needed.
- `npm start`: start the local server, then open http://localhost:8080.
- Browser automation: install Playwright separately (`npm install --no-save playwright`, then `npx playwright install chromium`).
- `npm run test:browser`: 3.0, 3.1 and 3.2 gameplay suites.
- `node tests/browser-graphics.mjs`: desktop graphics + touch checks.
- `npm run test:mobile`: a separate legacy mobile subset; not counted twice in the 3.2 report.

Set `CHUGCRAFT_URL` to another local address or `CHROMIUM_PATH` to an installed Chromium executable if needed. The 3.2 suite writes screenshots, results and a synthetic demo backup to `test-output/v32`. Earlier suites retain their original output locations (`test-output` and `tests/results`). Release evidence is in `tests/results/release-3.2`.

All profiles/worlds are test fixtures, not your personal saves. Browser checks use explicit aiming, fixtures and input simulation; they are not an unassisted full Survival playthrough or real iPhone/Android verification. Fixture corrections and limitations are documented in TEST-REPORT.md.
