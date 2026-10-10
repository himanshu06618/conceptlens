# ConceptLens Production Deployment Summary

This document summarizes the changes made to prepare and deploy **ConceptLens** across **GitHub**, **Vercel** (frontend), and **Render** (backend).

---

## 🏗️ Architecture & Hosting Targets

```
                                      ┌─────────────────────────────────────┐
                                      │           Vercel (Edge CDN)         │
                                      │  https://<conceptlens>.vercel.app   │
                                      │                                     │
                                      │  - React 19 + Vite 8 SPA            │
                                      │  - PWA Offline Service Worker       │
                                      │  - React Flow Diagram / Concept Tree│
                                      └──────────────────┬──────────────────┘
                                                         │
                                               HTTPS / REST API
                                           with credentials: include
                                                         │
                                                         ▼
                                      ┌─────────────────────────────────────┐
                                      │          Render (Docker)            │
                                      │   https://<conceptlens>.onrender.com│
                                      │                                     │
                                      │  - FastAPI / Python 3.11            │
                                      │  - Tesseract OCR + RapidOCR ONNX    │
                                      │  - spaCy (en_core_web_sm) + YAKE    │
                                      │  - SQLite (WAL mode) / Disk         │
                                      └─────────────────────────────────────┘
```

---

## 🛠️ Summary of Changes Made in Phase 1

### 1. Root & Repository Configuration
- **`.gitignore`**:
  - Excluded all virtual environments (`.venv`, `venv`, `env`).
  - Excluded all SQLite database files (`*.db`, `*.sqlite`, `*.sqlite3`, `backend/*.db*`).
  - Excluded local uploads (`uploads/`, `backend/uploads/*`, keeping `!backend/uploads/.gitkeep`).
  - Excluded frontend build artifacts (`dist/`, `build/`, `.vite/`, `node_modules/`).
  - Excluded local environment files (`.env`, `.env.*`, keeping `!.env.example`).
  - Excluded scratch directories, large binary zip archives, and OS temp files.
- **Root `package.json`**:
  - Added `"postinstall": "npm install --prefix frontend"` so Vercel automated builds install dependencies seamlessly from the repository root.

### 2. Frontend (React + Vite)
- **`frontend/src/api/client.js`**:
  - Updated `getApiBase()` to use `VITE_API_URL` (or `VITE_API_BASE`), normalizing custom domains with or without trailing slashes and the `/api` prefix.
  - Added development mode fallback to `/api` (for local Vite proxy) and default production fallback to `http://localhost:8000/api`.
  - Exported `getDocumentTree(docId)` to route concept tree fetches through the centralized API client.
- **`frontend/src/components/ConceptTree.jsx`**:
  - Replaced hardcoded `fetch('/api/documents/:id/tree')` with `getDocumentTree(documentId)`.
- **`frontend/vercel.json` & root `vercel.json`**:
  - Configured SPA rewrite rule (`/(.*)` $\rightarrow$ `/index.html`) so page refreshes and direct links route properly.
  - Configured immutable asset caching headers for `/assets/(.*)`.
  - Configured freshness headers for PWA assets (`sw.js`, `manifest.webmanifest`).
  - Added security headers (`nosniff`, `DENY`, and `camera=(self)` for note camera capture).
- **`frontend/.env.example`**:
  - Documented `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID`.

### 3. Backend (FastAPI + Python)
- **Dynamic Port**:
  - Added support for reading the `PORT` environment variable (default: `8000`), with an `if __name__ == "__main__":` entrypoint.
- **CORS & CSRF**:
  - Updated `backend/auth.py` and `backend/main.py` to read `FRONTEND_URL` from environment variables and dynamically authorize it in `ALLOWED_ORIGINS`.
  - Pre-authorized all `https://*.vercel.app` domains via regex for Vercel preview and production deployments.
- **Health Checks**:
  - Added a lightweight `GET /health` endpoint returning `{"status": "ok"}` for Render health checks.
  - Maintained detailed `GET /api/health` for in-app diagnostics.
- **Storage & Database Paths**:
  - `DATABASE_PATH` and `UPLOAD_DIR` are configurable via environment variables, with automatic folder creation on startup.
- **Cross-Domain Cookies**:
  - Configured `COOKIE_SAMESITE="none"` when `COOKIE_SECURE=true` so authentication cookies work across Vercel and Render domains.
- **`backend/requirements.txt`**:
  - Added `gunicorn` and `rapidocr-onnxruntime`.
  - Removed unused heavy dependencies (`easyocr` and `keybert`) to ensure the service runs smoothly within Render free-tier RAM limits (512 MB).
- **`backend/Dockerfile`**:
  - Created a production Dockerfile based on `python:3.11-slim` installing `tesseract-ocr`, `tesseract-ocr-eng`, `libgl1`, and downloading spaCy `en_core_web_sm`.

---

## 📋 Environment Variables Reference

### Frontend (`frontend/.env`)
| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes (in Prod) | Render backend service URL (e.g. `https://conceptlens-api.onrender.com`) |
| `VITE_GOOGLE_CLIENT_ID` | Optional | Google Cloud OAuth Client ID for Google login |

### Backend (`backend/.env`)
| Variable | Required | Description |
|---|---|---|
| `PORT` | Auto | Port assigned by Render (defaults to 8000) |
| `FRONTEND_URL` | Yes (in Prod) | Deployed Vercel URL (e.g. `https://conceptlens.vercel.app`) |
| `ENVIRONMENT` | Yes (in Prod) | Set to `production` |
| `JWT_SECRET` | Yes (in Prod) | Random string $\ge 32$ chars (`openssl rand -hex 32`) |
| `COOKIE_SECURE` | Yes (in Prod) | `true` |
| `COOKIE_SAMESITE` | Yes (in Prod) | `none` |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth Web Client ID |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for cloud extraction |
| `FLOWCHART_PROVIDER`| Optional | `offline` (default) or `gemini` |
