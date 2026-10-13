# ConceptLens 🔍

**ConceptLens** is a modern course notes concept extractor and study assistant. It ingests course notes as PDFs (both digital and scanned), images (scanned notes & photos), or text documents, and extracts key academic concepts, definitions, and relational knowledge using the official **Google Gemini AI API** (`google-genai`), with an ultra-lightweight offline fallback (PyMuPDF + YAKE).

---

## 🌟 Key Features

- **Multimodal AI Note Ingestion**:
  - **PDF (Digital & Scanned)**: Direct multimodal extraction via Gemini Vision. Handles scanned documents, handwritten annotations, and multi-column layouts without memory crashes.
  - **Images (PNG, JPG, JPEG, WEBP)**: Direct photo & scan comprehension for handwritten notebooks and whiteboards.
  - **Text (TXT, MD)**: Direct textual understanding.
- **Complete Concept Extraction**:
  - No arbitrary caps: extracts **ALL** concepts found across notes.
  - Generates clear, high-yield definitions, hierarchical topics/chapters, and importance levels (1–3).
  - Strict relationship graph with only `"prerequisite"` and `"related"` dependencies.
- **High Performance & 512 MB RAM Optimization**:
  - Replaced heavy local OCR (RapidOCR, Tesseract, OpenCV) and large spaCy models with Gemini API calls.
  - Background task processing with animated progress so Render HTTP timeouts are never hit.
  - Single-worker queue lock and in-memory streaming keep backend RAM consumption < 70 MB.
  - SHA-256 upload caching returns completed extractions instantly and saves API quota.
- **Calm, Modern Study UI**:
  - React + Vite with custom CSS design system and vibrant purple gradient glassmorphism.
  - Light and Dark modes with persistent storage.
  - Interactive Concept Tree, Roadmap, Concepts list, and student study planner.
  - Live search, topic filtering, importance filtering, and export (CSV, JSON, SVG, PNG).

---

## 🏗️ Architecture & Project Structure

```
ConceptLens/
├── backend/
│   ├── main.py                  # FastAPI application & REST endpoints
│   ├── database.py              # SQLite database layer with SHA-256 caching
│   ├── models.py                # Pydantic data models & response schemas
│   ├── services/
│   │   ├── cloud_extraction.py  # Gemini API multimodal extractor (google-genai)
│   │   ├── file_reader.py       # Lightweight PyMuPDF document parser
│   │   ├── tree_builder.py      # Hierarchical concept tree generator
│   │   ├── flowchart_builder.py # Prerequisite & relational flowchart graph
│   │   ├── concept_extraction.py# Gemini primary pipeline + YAKE fallback
│   │   └── chunking.py          # Fast regex chunking
│   ├── tests/                   # Pytest unit & verification test suite
│   ├── requirements.txt         # Minimal Python dependencies (zero heavy models)
│   ├── .env.example             # Environment configuration template
│   └── uploads/                 # Local uploads storage
├── frontend/
│   ├── src/
│   │   ├── api/client.js        # API client
│   │   ├── components/          # Sidebar, UploadView, ConceptCard, ResultsView, SidePanel
│   │   ├── styles/index.css     # Complete design system (light & dark mode)
│   │   └── App.jsx              # Main React application
│   └── index.html
├── samples/                     # Test datasets (PDFs, scans, text notes)
└── README.md
```

---

## ⚙️ Environment Variables

### Frontend (`frontend/.env`)
| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Production | Base URL of deployed backend (e.g. `https://conceptlens-api.onrender.com`). Falls back to `http://localhost:8000/api` or `/api` proxy in dev. |
| `VITE_GOOGLE_CLIENT_ID`| Optional | Google OAuth 2.0 Web Client ID for Google login. |

### Backend (`backend/.env` & Render Dashboard)
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **Yes (in Prod)** | Hosted PostgreSQL connection string (e.g. Neon pooled endpoint `postgresql://...-pooler...neon.tech/neondb?sslmode=require`). Automatically falls back to local SQLite if unset. |
| `GEMINI_API_KEY` | **Yes (in Prod)** | Google Gemini API key from AI Studio (`https://aistudio.google.com/app/apikey`). |
| `GEMINI_MODEL` | Optional | Free-tier multimodal model (default: `gemini-3.7-flash`; also supports `gemini-3.5-flash`). |
| `PORT` | Auto | Server port (Render sets this dynamically; defaults to `8000`). |
| `FRONTEND_URL` | Production | Allowed origin for CORS (e.g. `https://conceptlens.vercel.app`). |
| `ALLOWED_ORIGINS` | Optional | Additional allowed CORS origins (comma-separated). |
| `ENVIRONMENT` | Production | Set to `production` (enforces secure secret validation). |
| `JWT_SECRET` | Production | Random secret string of at least 32 characters (`openssl rand -hex 32`). |
| `COOKIE_SECURE` | Production | `true` in production with HTTPS. |
| `COOKIE_SAMESITE` | Production | `none` in cross-domain production (Vercel + Render). |
| `DATABASE_PATH` | Optional | Local SQLite file path fallback (default: `conceptlens.db`). |
| `UPLOAD_DIR` | Optional | Uploads storage folder (default: `uploads`). |
| `GUEST_UPLOAD_LIMIT` | Optional | Free guest uploads allowed before sign in (default: `5`). |

---

## 🚀 Quickstart & Setup

### Prerequisites
- **Python 3.11+**
- **Node.js 18+ & npm**
- **Google Gemini API Key** (free from [Google AI Studio](https://aistudio.google.com/app/apikey))

---

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

# Install minimal dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Open .env and set your GEMINI_API_KEY
```

#### Start Backend Server
```bash
# Inside backend/ with virtualenv active:
uvicorn main:app --reload --port 8000
```
Backend API docs will be live at: [http://localhost:8000/docs](http://localhost:8000/docs)

---

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start Vite dev server
npm run dev
```
The React UI will be live at: [http://localhost:5173](http://localhost:5173)

---

## 🧪 Running Tests

To run the complete unit and end-to-end test suite:

```bash
# From workspace root with backend virtualenv active:
pytest backend/tests -v
```

This tests:
1. `test_text_cleaning.py`: Hyphenated line-break repair, page number removal, and Unicode normalization.
2. `test_deduplication.py`: Lemmatization and singular/plural consolidation.
3. `test_definition_detection.py`: Definition pattern detection and excerpt fallbacks.
4. `test_e2e_pipeline.py`: Full end-to-end extraction across TXT, PDF, and scanned image OCR samples.
5. `test_auth_isolation.py`: Complete authentication validation, Argon2id hashing, timing-safe dummy hash checks, rate limiting, and automated verification that User A can never list, read, export, or delete User B's documents (returns 404).

---

## 🔐 Authentication & Per-User Workspaces

ConceptLens provides private, isolated workspaces for every user:
- **No separate login/signup page**: The login and registration experience lives embedded directly inside the dashboard and can be toggled as a modal or mobile bottom sheet from the header.
- **Strict Data Isolation**: Each user can only see, access, export, or delete their own documents. Accessing another user's document returns a strict **404 Not Found** (never leaking existence or returning 403).
- **Isolated File Storage**: Physical uploads are stored inside `backend/uploads/{user_id}/` with path traversal protections.
- **Legacy Row Security**: Any database document rows without an associated `user_id` are permanently hidden from all users.

### Step-by-Step Setup

#### 1. Generate a Strong JWT_SECRET
In your terminal, generate a cryptographically secure 64-character secret:

```bash
# Using Python:
python -c "import secrets; print(secrets.token_hex(32))"

# Or using OpenSSL:
openssl rand -hex 32
```

Add this secret to your `backend/.env`:
```env
JWT_SECRET=your_generated_secret_here
```
*(In production mode, the server will refuse to start if a default or weak secret is detected).*

#### 2. Set Up Free Google OAuth (Optional)
If you wish to enable the **"Continue with Google"** button:
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Go to **APIs & Services** $\rightarrow$ **OAuth consent screen**:
   - Select **External**, set App name to **ConceptLens**, and add your email.
4. Go to **APIs & Services** $\rightarrow$ **Credentials**:
   - Click **Create Credentials** $\rightarrow$ **OAuth client ID**.
   - Select Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add:
     - `http://localhost:5173`
     - `http://127.0.0.1:5173`
     *(And your production domain when deploying)*.
   - Click **Create** and copy your **Client ID**.
5. Paste the Client ID into both environment files:
   - In `backend/.env`:
     ```env
     GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
     ```
   - In `frontend/.env`:
     ```env
     VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
     ```
6. *Note: If `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` is left empty, the Google button is cleanly hidden and standard Username + Password authentication continues working seamlessly.*

#### 3. Running & Testing Locally
1. Start the backend:
   ```bash
   cd backend
   python -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```
2. Start the frontend:
   ```bash
   cd frontend
   npm run dev
   ```
3. Open `http://localhost:5173`:
   - When signed out, the dashboard displays the embedded **"Sign in to your workspace"** card, and document uploads/history are locked.
   - Switch between **"Sign in"** and **"Create account"** tabs.
   - Test the live password strength meter when typing a new password.
   - Create an account or sign in with Google to enter your private workspace.
   - Header shows your avatar initials and user menu (Profile, Change password, Sign out, Delete account).

---

## 🚀 Deploying to Vercel (vercel.app)

ConceptLens is fully configured for deployment on **Vercel** (`https://<project-name>.vercel.app`):

1. **Push to GitHub / GitLab / Bitbucket**.
2. **Import repository into Vercel** ([vercel.com/new](https://vercel.com/new)).
3. **Preset Configuration**:
   - Framework: **Vite**
   - Root directory: `./` (or `frontend`)
   - Build Command: `npm run build`
   - Output Directory: `frontend/dist` (or `dist` if root set to `frontend`)
4. **Environment Variables**:
   - `VITE_API_URL`: Your deployed FastAPI backend URL (e.g. `https://conceptlens-api.onrender.com` or `https://conceptlens.up.railway.app`).
   - `VITE_GOOGLE_CLIENT_ID`: *(Optional)* Google OAuth Client ID.
5. See the full step-by-step instructions in [VERCEL_DEPLOYMENT.md](file:///d:/ConceptFinder/VERCEL_DEPLOYMENT.md).

---

## 📱 Testing on Mobile & PWA Setup

ConceptLens is fully mobile-first and installable as a Progressive Web App (PWA) with native camera capture and client-side photo optimization.

### 1. Connect from your Phone (Same Wi-Fi Network)
1. **Double-click `start.bat`** (or launch `uvicorn main:app --host 0.0.0.0 --port 8000` and `npm run dev -- --host 0.0.0.0`).
2. Find your computer's local IP address:
   - **Windows**: Open Command Prompt and type `ipconfig` (look for *IPv4 Address*, e.g., `192.168.1.45`).
   - **macOS / Linux**: Type `ifconfig` or `ip a` (look for `inet`, e.g., `192.168.1.45`).
3. On your phone's browser (Safari, Chrome, Firefox), navigate to:
   ```
   http://YOUR_PC_IP:5173
   ```
   *(e.g., `http://192.168.1.45:5173`)*

### 2. Mobile Features to Test
- **Camera Snapshot**: Tap **"Take Photo"** on the upload screen to open your phone camera directly and photograph physical study notes. Photos are automatically downscaled and optimized before upload to ensure fast processing over Wi-Fi.
- **Responsive Layout**:
  - **Phone (<640px)**: Bottom navigation bar, slide-out document drawer, sticky search, filter bottom sheet, and full-screen detail sheet with swipe-down dismissal.
  - **Tablet (640px–1023px)**: 2-column cards grid and collapsible navigation.
  - **Desktop (≥1024px)**: Persistent left sidebar, inline topic chips, and slide-out right drawer.
- **Install to Home Screen (PWA)**:
  - **Android (Chrome)**: Tap the in-app **"Install Web App"** icon in the header/sidebar, or tap Chrome menu `⋮` $\rightarrow$ **Install App**.
  - **iOS (Safari)**: Tap the Share button $\rightarrow$ **Add to Home Screen**.
  - The application shell will load instantly offline.

---

## 🐘 Persistent Hosted Database & Backups

For cloud deployments (such as Render free tier, where local disks are ephemeral), ConceptLens seamlessly supports hosted **PostgreSQL** (specifically **Neon**) via `DATABASE_URL`:

- **Automatic Selection**: When `DATABASE_URL` is set, ConceptLens connects to PostgreSQL using optimized pooling (`pool_pre_ping=True`, `pool_recycle=280` to safely handle Neon's 5-minute compute suspension, `pool_size=5`, `max_overflow=2`, `prepare_threshold=None`).
- **Zero-Config Local Fallback**: When `DATABASE_URL` is empty or unset, ConceptLens automatically falls back to local SQLite at `conceptlens.db` with WAL mode.
- **Additive Migrations**: Startup migrations idempotently create missing tables, columns, and indexes without dropping or modifying existing data.
- **Database Health Check**: Endpoint `GET /health/db` (and `/api/health/db`) tests connectivity with `SELECT 1` without exposing connection strings or credentials.
- **Data Export & Backup**: Export users (excluding passwords), notes, and documents with concepts and relations to portable JSON:
  ```bash
  python scripts/export_data.py -o backups/my_backup.json
  ```

---

## 🔒 Offline & Privacy Guarantee

All extraction, OCR, sentence parsing, and database storage can run **completely locally on your machine**:
- SQLite database is stored locally as `backend/conceptlens.db` by default.
- Passwords hashed with Argon2id / bcrypt and authenticated via signed httpOnly cookies.
- Hosted PostgreSQL (Neon) can be enabled optionally for cloud persistence across server restarts.
- Safe for proprietary lecture notes, research documents, and personal study materials.

