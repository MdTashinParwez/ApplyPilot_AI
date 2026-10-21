import asyncio
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request

from applypilot_ai.job_matching.scorer import score_job_match
from applypilot_ai.schemas import JobAnalysisRequest, JobAnalysisResponse, JobMatchRequest, JobMatchResponse, StructuredOutputRequest, StructuredOutputResponse
from applypilot_ai.workflows.job_analysis import run_job_analysis
from applypilot_ai.workflows.job_match import run_job_match

router = APIRouter()


def require_internal_access(request: Request) -> None:
    configured = request.app.state.settings.internal_api_token
    if configured and not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {configured}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}


@router.post("/v1/structured-output", response_model=StructuredOutputResponse, dependencies=[Depends(require_internal_access)])
async def structured_output(payload: StructuredOutputRequest) -> StructuredOutputResponse:
    # Deterministic schema contract check; this endpoint does not call an LLM.
    return StructuredOutputResponse(status="validated", result={"text": payload.text, "character_count": len(payload.text)})


@router.post("/v1/workflows/job-match", response_model=JobMatchResponse, dependencies=[Depends(require_internal_access)])
async def job_match(payload: JobMatchRequest, request: Request) -> JobMatchResponse:
    try:
        async with asyncio.timeout(request.app.state.settings.request_timeout_seconds):
            result = await run_job_match(payload, score_job_match)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="The workflow timed out") from exc
    return JobMatchResponse(result=result)


@router.post("/v1/workflows/job-analysis", response_model=JobAnalysisResponse, dependencies=[Depends(require_internal_access)])
async def job_analysis(payload: JobAnalysisRequest, request: Request) -> JobAnalysisResponse:
    try:
        async with asyncio.timeout(request.app.state.settings.request_timeout_seconds):
            results = await run_job_analysis(payload)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="The workflow timed out") from exc
    return JobAnalysisResponse(results=results)
