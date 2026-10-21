from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    internal_api_token: str = ""
    max_request_bytes: int = 64 * 1024
    request_timeout_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "Settings":
        try:
            settings = cls(
                host=os.getenv("AI_SERVICE_HOST", "127.0.0.1"),
                port=int(os.getenv("AI_SERVICE_PORT", "8000")),
                internal_api_token=os.getenv("AI_SERVICE_INTERNAL_TOKEN", ""),
                max_request_bytes=int(os.getenv("AI_SERVICE_MAX_REQUEST_BYTES", str(64 * 1024))),
                request_timeout_seconds=float(os.getenv("AI_SERVICE_REQUEST_TIMEOUT_SECONDS", "5")),
            )
        except ValueError as exc:
            raise ValueError("AI service configuration contains an invalid number") from exc
        if not 1 <= settings.port <= 65535:
            raise ValueError("AI_SERVICE_PORT must be between 1 and 65535")
        if not 1024 <= settings.max_request_bytes <= 10 * 1024 * 1024:
            raise ValueError("AI_SERVICE_MAX_REQUEST_BYTES must be between 1024 and 10485760")
        if not 0.1 <= settings.request_timeout_seconds <= 60:
            raise ValueError("AI_SERVICE_REQUEST_TIMEOUT_SECONDS must be between 0.1 and 60")
        if settings.host not in {"127.0.0.1", "localhost", "::1"} and not settings.internal_api_token:
            raise ValueError("AI_SERVICE_INTERNAL_TOKEN is required when binding beyond loopback")
        return settings


settings = Settings.from_env()
