import uvicorn

from applypilot_ai.config import settings


if __name__ == "__main__":
    uvicorn.run("applypilot_ai.main:app", host=settings.host, port=settings.port, log_config=None)
