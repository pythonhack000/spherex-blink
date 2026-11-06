FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend backend
COPY static static
# Frames of the challenge targets ship with the image, so they open instantly after a restart.
COPY data data
ENV BLINK_CACHE=/app/data
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn backend.api:app --host 0.0.0.0 --port ${PORT:-10000}"]
