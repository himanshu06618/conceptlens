# Workspace Rules: Always Deploy Live

1. **Automatic Git Push to Main on Every Task**:
   - For every task, once implementation and tests pass, automatically commit and push to `origin main`.
   - Never wait for the user to explicitly ask to push.
   - Pushing to `main` triggers automated live deployments on Vercel (frontend) and Render (backend).

2. **Pre-Push Quality Gate**:
   - Always run tests and verify `npm run build` succeeds before pushing.
   - Run `git status` to verify no `.env` files, SQLite databases (`.db`), credentials, or temporary debug files are ever committed.

3. **Live Verification**:
   - Ensure changes are immediately visible and operational on the live web app.
