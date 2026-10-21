from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from applypilot_ai.api.middleware import RequestSizeLimitMiddleware
from applypilot_ai.api.routes import router
from applypilot_ai.config import Settings, settings


def create_app(service_settings: Settings = settings) -> FastAPI:
    app = FastAPI(title="ApplyPilot AI Service", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = service_settings
    app.add_middleware(RequestSizeLimitMiddleware, max_bytes=service_settings.max_request_bytes)
    app.include_router(router)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [{"path": ".".join(str(part) for part in issue["loc"] if part != "body"), "message": issue["msg"], "code": issue["type"]} for issue in exc.errors()]
        return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": "Request validation failed.", "details": details}})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = {
            401: ("UNAUTHORIZED", "Internal service authorization is required."),
            404: ("NOT_FOUND", "Service route not found."),
            504: ("WORKFLOW_TIMEOUT", "The workflow timed out."),
        }.get(exc.status_code, ("REQUEST_FAILED", "The request could not be completed."))
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": code, "message": message}})

    @app.exception_handler(Exception)
    async def unexpected_error(_request: Request, _exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred."}})

    return app


app = create_app()
