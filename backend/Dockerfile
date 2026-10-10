# ==============================================================================
# ConceptLens Backend Dockerfile (Render Production Deployment)
# ==============================================================================
FROM python:3.11-slim

# Install system dependencies: Tesseract OCR, English language data, OpenCV libs, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Download spaCy English language model
RUN python -m spacy download en_core_web_sm

# Copy backend application source
COPY . .

# Ensure persistent uploads directory exists
RUN mkdir -p uploads

ENV PORT=8000
ENV ENVIRONMENT=production
EXPOSE 8000

# Start FastAPI server on dynamic $PORT supplied by Render
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
