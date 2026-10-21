from fastapi.testclient import TestClient

from applypilot_ai.config import Settings
from applypilot_ai.job_matching.scorer import score_job_match
from applypilot_ai.main import create_app
from applypilot_ai.resume.text import normalize_resume_text
from applypilot_ai.schemas import JobMatchRequest, JobMatchResult


def client(max_request_bytes: int = 2048) -> TestClient:
    return TestClient(create_app(Settings(max_request_bytes=max_request_bytes)))


def test_health_does_not_require_an_llm_key() -> None:
    response = client().get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-service"}


def test_structured_output_returns_validated_response() -> None:
    response = client().post("/v1/structured-output", json={"text": "structured check"})
    assert response.status_code == 200
    assert response.json() == {"status": "validated", "result": {"text": "structured check", "character_count": 16}}


def test_validation_errors_do_not_echo_submitted_text() -> None:
    response = client().post("/v1/structured-output", json={"text": "private-value", "unexpected": True})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "private-value" not in response.text


def test_request_body_size_is_limited() -> None:
    response = client(1024).post("/v1/structured-output", json={"text": "x" * 1500})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_match_scorer_and_langgraph_workflow_validate_the_result() -> None:
    request = JobMatchRequest(profile_skills=["Python", "FastAPI"], job_title="API Engineer", required_skills=["python", "SQL"])
    result = score_job_match(request)
    expected = JobMatchResult(score=0.5, matched_skills=["Python"], missing_skills=["SQL"], method="skill_overlap")
    assert result == expected
    response = client().post("/v1/workflows/job-match", json=request.model_dump())
    assert response.status_code == 200
    assert response.json()["result"] == expected.model_dump()


def test_internal_endpoints_require_configured_bearer_token() -> None:
    authed_client = TestClient(create_app(Settings(internal_api_token="local-secret")))
    body = {"text": "check"}
    assert authed_client.post("/v1/structured-output", json=body).status_code == 401
    assert authed_client.post("/v1/structured-output", json=body, headers={"Authorization": "Bearer local-secret"}).status_code == 200
    assert authed_client.get("/health").status_code == 200


def test_binding_beyond_loopback_requires_an_internal_token(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_HOST", "0.0.0.0")
    monkeypatch.delenv("AI_SERVICE_INTERNAL_TOKEN", raising=False)
    try:
        Settings.from_env()
    except ValueError as error:
        assert "required when binding beyond loopback" in str(error)
    else:
        raise AssertionError("Expected non-loopback binding to require a token")


def test_resume_text_normalizer_is_bounded() -> None:
    assert normalize_resume_text(" Name \n\nSkill\x00") == "Name\n\nSkill"
    try:
        normalize_resume_text("too long", max_characters=3)
    except ValueError as error:
        assert "allowed size" in str(error)
    else:
        raise AssertionError("Expected length validation")
