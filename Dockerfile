# Base image already has Chromium + all its OS-level dependencies
# preinstalled, which is the annoying part to get right for Playwright
# in a serverless/PaaS build environment. Version pinned to match the
# `playwright` pip package version in requirements.txt — if you bump one,
# bump the other, or Playwright won't be able to find the browser binary.
FROM mcr.microsoft.com/playwright/python:v1.61.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api.py .

# Railway injects $PORT at runtime; default to 8000 for local `docker run`.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT}"]
