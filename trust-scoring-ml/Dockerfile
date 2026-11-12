FROM python:3.12-slim

# Hugging Face Spaces runs containers as uid 1000
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH" \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements-deploy.txt .
RUN pip install --no-cache-dir -r requirements-deploy.txt

COPY --chown=user app.py .
COPY --chown=user src ./src
COPY --chown=user models ./models

# Listens on $PORT when the host sets one (Render), otherwise on 7860
EXPOSE 7860
CMD gunicorn --bind "0.0.0.0:${PORT:-7860}" --workers 1 --timeout 60 app:app
