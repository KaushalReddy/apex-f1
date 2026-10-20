FROM python:3.12-slim
WORKDIR /app
COPY apps/ai/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/ai/app ./app
# Run unprivileged: the service only reads its code.
RUN useradd --system --uid 10001 --no-create-home apex
USER apex
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
