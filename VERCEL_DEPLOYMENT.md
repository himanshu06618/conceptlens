# Deploying ConceptLens to Vercel (vercel.app) 🚀

This guide explains how to deploy the **ConceptLens** frontend to **Vercel** (`https://<project-name>.vercel.app`) and connect it to your Python NLP/OCR backend.

---

## 📋 Architecture Overview

- **Frontend (Vercel)**:
  - React 19 + Vite Single Page Application (SPA)
  - Progressive Web App (PWA) with offline capabilities
  - Interactive Concept Tree, Flowchart (@xyflow/react), and Student Study Planner
  - Deployed to Vercel's global Edge CDN
- **Backend (Render / Railway / Fly.io / VPS / Docker)**:
  - Python 3.11 + FastAPI with PyMuPDF, OpenCV, spaCy, YAKE, and OCR
  - SQLite database with WAL mode
  - REST endpoints at `/api/*`
  - Built-in CORS allowing all `https://*.vercel.app` origins

---

## ⚡ Quick Deployment (2 Options)

### Option 1: Deploy with Vercel Web Dashboard (Recommended)

1. **Push your code to GitHub / GitLab / Bitbucket**:
   ```bash
   git init
   git add .
   git commit -m "feat: make project deployment ready for vercel"
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git branch -M main
   git push -u origin main
   ```

2. **Import into Vercel**:
   - Go to [vercel.com/new](https://vercel.com/new).
   - Select your repository and click **Import**.

3. **Configure Project Settings**:
   - **Framework Preset**: `Vite` (automatically detected)
   - **Root Directory**: `./` (or leave default root)
   - **Build Command**: `npm run build` (runs `npm run build --prefix frontend` via root `package.json`)
   - **Output Directory**: `frontend/dist` (pre-configured in `vercel.json`)
   - **Install Command**: `npm install --prefix frontend` (pre-configured)

   *(Note: If you choose **Root Directory: `frontend`**, Vercel will build directly from `frontend/` using `frontend/vercel.json`, outputting to `dist`. Both approaches work seamlessly).*

4. **Add Environment Variables**:
   Under **Environment Variables**, add:
   | Variable | Value | Description |
   |---|---|---|
   | `VITE_API_URL` | `https://your-backend-api.onrender.com` | URL of your deployed backend (leave empty during testing if backend isn't ready yet) |
   | `VITE_GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` | *(Optional)* Google OAuth Client ID |

5. **Click Deploy**:
   - Vercel will install dependencies, build the Vite bundles, and deploy to your custom `https://<project>.vercel.app` domain in ~30 seconds.

---

### Option 2: Deploy with Vercel CLI

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy from Workspace Root**:
   ```bash
   vercel
   ```
   Follow the interactive prompts:
   - *Set up and deploy?* **Y**
   - *Which scope?* (Select your team or personal account)
   - *Link to existing project?* **N**
   - *Project name?* `conceptlens` (or your choice)
   - *In which directory is your code located?* `./`

4. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

---

## ⚙️ Environment Variables Reference

### Frontend Variables (Set in Vercel Dashboard -> Settings -> Environment Variables)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | Optional | `/api` | The base URL of your FastAPI backend (e.g. `https://api-conceptlens.onrender.com` or `https://conceptlens.up.railway.app`). The client automatically normalizes trailing slashes and the `/api` prefix. |
| `VITE_GOOGLE_CLIENT_ID` | Optional | `""` | Google Cloud OAuth 2.0 Web Client ID for Google Sign-In. Make sure to add your Vercel URL `https://<your-project>.vercel.app` to **Authorized JavaScript origins** in Google Cloud Console. |

---

## 🖥️ Backend Deployment (To pair with Vercel)

Because the Python backend uses native C libraries (Tesseract OCR, OpenCV, PyMuPDF, spaCy models), it cannot run directly inside a lightweight serverless frontend host. Host the backend on any platform that supports Docker or Python:

### 1. Deploying Backend via Docker (Railway / Render / Fly.io)

This repository includes a production multi-stage [Dockerfile](file:///d:/ConceptFinder/Dockerfile):

#### Render:
1. Create a new **Web Service** on [render.com](https://render.com).
2. Connect your Git repository.
3. Select **Docker** as the Runtime (it will use the project's root `Dockerfile`).
4. Set Environment Variables:
   - `ENVIRONMENT=production`
   - `JWT_SECRET=<generate-random-32-char-secret>`
   - `COOKIE_SECURE=true`
   - `COOKIE_SAMESITE=none`
   - `GEMINI_API_KEY=<optional-gemini-key>`
5. Copy your Render service URL (e.g. `https://conceptlens-api.onrender.com`) and paste it as `VITE_API_URL` in Vercel!

#### Railway:
1. Create a **New Project** -> **Deploy from GitHub Repo**.
2. Railway detects the `Dockerfile` automatically.
3. Add the environment variables (`ENVIRONMENT`, `JWT_SECRET`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`).
4. Generate a public domain under service settings and add it to Vercel's `VITE_API_URL`.

---

## 🔒 Security & CORS Pre-Configured

- **Vercel Regex Match**: In [backend/main.py](file:///d:/ConceptFinder/backend/main.py#L222-L229), CORS is pre-configured with `allow_origin_regex=r"^https:\/\/.*\.vercel\.app$"` so all Vercel preview branch deployments and production URLs are authorized.
- **Cross-Domain Cookies**: In [backend/auth.py](file:///d:/ConceptFinder/backend/auth.py), cookies use `samesite="none"` and `secure=true` when `COOKIE_SECURE=true`, ensuring session authentication cookies work between `*.vercel.app` and your backend.
- **PWA Cache Freshness**: In [vercel.json](file:///d:/ConceptFinder/vercel.json), `sw.js` and `manifest.webmanifest` are set to `max-age=0, must-revalidate` so users always get the latest PWA updates.
- **Camera Permissions**: Permissions policy `camera=(self)` is included in HTTP response headers for note scanning via webcam/mobile camera.

---

## 🔍 Verification Checklist

- [x] Root build passes: `npm run build` succeeds without errors.
- [x] Root `package.json` includes `postinstall` hook to auto-install `frontend` dependencies.
- [x] Both root `vercel.json` and `frontend/vercel.json` are synchronized with Vite SPA fallback routing and security headers.
- [x] `.vercelignore` excludes `.venv`, `.db` files, and heavy archives from Vercel uploads.
- [x] API client normalizes `VITE_API_URL` with or without trailing `/api`.
- [x] Concept Tree component unified to use `getDocumentTree()` via the centralized API client.
- [x] Frontend tests pass: `npm run test:flowchart --prefix frontend`.
