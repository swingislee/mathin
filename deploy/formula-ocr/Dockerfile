FROM python:3.12.11-slim-bookworm

ARG PIX2TEXT_VERSION=1.1.6

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install \
    "pix2text==${PIX2TEXT_VERSION}" \
    "fastapi==0.116.1" \
    "uvicorn==0.35.0" \
    "python-multipart==0.0.20"

ENTRYPOINT ["p2t", "serve"]
CMD ["-l", "en,ch_sim", "--disable-table", "-d", "cpu", "-H", "127.0.0.1", "-p", "8503"]
