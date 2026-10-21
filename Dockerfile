FROM python:3.13-slim

# LibreOffice converts the filled Word documents to PDF.
# Liberation / Carlito fonts are metric-compatible with Arial / Calibri, so
# layouts match what you see in Word.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core sqlite3 \
 && (apt-get install -y --no-install-recommends libreoffice-writer-nogui \
     || apt-get install -y --no-install-recommends libreoffice-writer) \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 app
WORKDIR /srv/app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY tools ./tools
COPY source_templates ./source_templates

ENV DATA_DIR=/data PYTHONUNBUFFERED=1 HOME=/home/app
RUN mkdir -p /data && chown app:app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
