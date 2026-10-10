# ==============================================================================
# ConceptLens Multi-Stage Production Dockerfile
# ==============================================================================

# Stage 1: Build the React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend with Tesseract OCR & NLP
FROM python:3.11-slim AS runner

# Install system dependencies (Tesseract OCR, OpenCV headless deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r ./backend/requirements.txt

# Download spaCy English model into image
RUN python -m spacy download en_core_web_sm

# Copy backend application source
COPY backend/ ./backend/
COPY samples/ ./samples/

# Copy built frontend assets into the expected location
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose production port
EXPOSE 8000

ENV OCR_ENGINE=auto
ENV USE_KEYBERT=false
ENV PORT=8000

# Run FastAPI production server (serves both API and React frontend)
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
