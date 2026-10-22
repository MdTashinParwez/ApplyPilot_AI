from fastapi.testclient import TestClient

from applypilot_ai.config import Settings
from applypilot_ai.main import create_app
from applypilot_ai.schemas import AnalysisJob, AnalysisProfile, JobAnalysisRequest
from applypilot_ai.workflows.job_analysis import run_job_analysis


def make_job(**updates) -> dict:
    job = {
        "sourceId": "job-1", "source": "arbeitnow", "title": "Senior Python Engineer",
        "company": "Example Labs", "location": "Berlin, Germany",
        "description": "We need Python, FastAPI, PostgreSQL and Docker experience. Build API services and collaborate across engineering teams. " * 4,
        "remote": False, "tags": ["Python", "FastAPI", "PostgreSQL"], "jobTypes": ["Full-time"],
        "url": "https://jobs.example.test/job-1",
    }
    job.update(updates)
    return job


def api_client() -> TestClient:
    return TestClient(create_app(Settings()))


def test_strong_match_has_explainable_factor_evidence_and_bounded_score() -> None:
    payload = {
        "profile": {
            "skills": ["Python", "FastAPI", "PostgreSQL", "Docker"],
            "professionalSummary": "Backend API engineer",
            "targetJobTitles": ["Python Engineer"], "preferredCountries": ["Germany"],
            "preferredLocations": ["Berlin"], "workArrangements": ["onsite"],
            "experience": [{"title": "Python Engineer", "company": "Previous Co", "details": "Built Python API services with FastAPI and PostgreSQL."}],
        },
        "jobs": [make_job()],
    }
    response = api_client().post("/v1/workflows/job-analysis", json=payload)
    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["recommendation"] == "strong_match"
    assert 0 <= result["score"] <= 100
    assert sum(factor["weight"] for factor in result["factorBreakdown"]) == 100
    assert {"skills", "role", "experience", "location"} == {factor["name"] for factor in result["factorBreakdown"]}
    assert any("Python" in evidence for evidence in result["matchedEvidence"])


def test_weak_match_surfaces_unverified_skills_and_low_score() -> None:
    payload = {
        "profile": {"skills": ["Figma"], "targetJobTitles": ["Product Designer"], "preferredLocations": ["Toronto"]},
        "jobs": [make_job()],
    }
    result = api_client().post("/v1/workflows/job-analysis", json=payload).json()["results"][0]
    assert result["recommendation"] == "low_match"
    assert result["score"] < 50
    assert any("not listed" in item for item in result["missingOrUnverified"])


def test_empty_profile_returns_unknown_not_ineligible() -> None:
    result = api_client().post("/v1/workflows/job-analysis", json={"profile": {}, "jobs": [make_job()]}).json()["results"][0]
    assert result["recommendation"] == "unknown"
    assert result["score"] is None
    assert any("not verified" in item or "unknown" in item for item in result["missingOrUnverified"])


def test_incomplete_description_lowers_confidence_and_reports_limitations() -> None:
    result = api_client().post("/v1/workflows/job-analysis", json={"profile": {"skills": ["Python"]}, "jobs": [make_job(description="Python")]}).json()["results"][0]
    assert result["confidence"] == "low"
    assert any("short" in item for item in result["confidenceReasons"])
    assert any("incomplete" in item for item in result["explanation"])


def test_location_preference_is_scored_and_known_remote_only_conflict_is_ineligible() -> None:
    matches = api_client().post("/v1/workflows/job-analysis", json={"profile": {"preferredLocations": ["Berlin"]}, "jobs": [make_job()]}).json()["results"][0]
    assert next(f for f in matches["factorBreakdown"] if f["name"] == "location")["score"] == 100
    conflict = api_client().post("/v1/workflows/job-analysis", json={"profile": {"workArrangements": ["remote"]}, "jobs": [make_job()]}).json()["results"][0]
    assert conflict["recommendation"] == "ineligible"
    assert conflict["score"] == 0


def test_country_field_matches_and_unknown_arrangement_is_not_ineligible() -> None:
    matches = api_client().post("/v1/workflows/job-analysis", json={
        "profile": {"preferredCountries": ["Canada"]},
        "jobs": [make_job(location="", country="Canada")],
    }).json()["results"][0]
    assert next(f for f in matches["factorBreakdown"] if f["name"] == "location")["score"] == 100
    unknown = api_client().post("/v1/workflows/job-analysis", json={
        "profile": {"workArrangements": ["remote"]},
        "jobs": [make_job(remote=None)],
    }).json()["results"][0]
    assert unknown["recommendation"] != "ineligible"
    assert any("unknown" in item.lower() for item in unknown["missingOrUnverified"])


def test_work_authorization_is_never_assumed_eligible_or_ineligible() -> None:
    result = api_client().post("/v1/workflows/job-analysis", json={
        "profile": {"workAuthorization": "Authorized in Canada"},
        "jobs": [make_job(country="Canada")],
    }).json()["results"][0]
    assert result["recommendation"] != "ineligible"
    assert any("sponsorship compatibility are unknown" in item for item in result["missingOrUnverified"])


def test_unrelated_domain_is_marked_ineligible() -> None:
    payload = {
        "profile": {
            "skills": ["TypeScript", "React", "Python"],
            "targetJobTitles": ["Software Engineer Intern"],
        },
        "jobs": [make_job(title="Senior Director of Music Licensing", description="Manage music publishing contracts, copyright licenses and royalty sales. " * 4)],
    }
    result = api_client().post("/v1/workflows/job-analysis", json=payload).json()["results"][0]
    assert result["recommendation"] == "ineligible"
    assert result["score"] <= 15
    assert not any("built" in evidence.lower() for evidence in result["matchedEvidence"])


def test_seniority_mismatch_penalizes_director_role_for_entry_candidate() -> None:
    payload = {
        "profile": {
            "skills": ["Python", "FastAPI"],
            "targetJobTitles": ["Junior Python Developer", "Software Intern"],
        },
        "jobs": [make_job(title="Director of Engineering", description="We need Python and FastAPI to direct engineering teams. " * 4)],
    }
    result = api_client().post("/v1/workflows/job-analysis", json=payload).json()["results"][0]
    assert result["recommendation"] == "ineligible"
    assert result["eligible"] is False
    assert result["rejectionCategory"] == "seniority_mismatch"
    assert any("seniority mismatch" in limit.lower() for limit in result["missingOrUnverified"])


def test_unsupported_language_german_is_marked_ineligible() -> None:
    payload = {
        "profile": {
            "skills": ["Python", "Docker"],
            "targetJobTitles": ["Software Engineer"],
            "languages": ["English"],
        },
        "jobs": [make_job(
            title="Softwareentwickler Python (m/w/d)",
            description="Wir suchen einen engagierten Entwickler. Sehr gute Deutschkenntnisse in Wort und Schrift erforderlich."
        )],
    }
    result = api_client().post("/v1/workflows/job-analysis", json=payload).json()["results"][0]
    assert result["recommendation"] == "ineligible"
    assert result["eligible"] is False
    assert result["rejectionCategory"] == "unsupported_language"
    assert "German" in result["rejectionReason"]


def test_mobile_developer_role_mismatch_is_marked_ineligible_for_backend_candidate() -> None:
    payload = {
        "profile": {
            "skills": ["Python", "PostgreSQL", "Docker"],
            "technicalDomains": ["Backend", "AI / ML"],
            "targetJobTitles": ["Backend Engineer"],
        },
        "jobs": [make_job(
            title="iOS Developer (Swift)",
            description="We are seeking an iOS Developer with Swift and UIKit experience for mobile apps."
        )],
    }
    result = api_client().post("/v1/workflows/job-analysis", json=payload).json()["results"][0]
    assert result["recommendation"] == "ineligible"
    assert result["eligible"] is False
    assert result["rejectionCategory"] == "mobile_domain_mismatch"
    assert "mobile development" in result["rejectionReason"].lower()


def test_generic_stop_words_never_count_as_technical_skill_evidence() -> None:
    payload = {
        "profile": {
            "skills": ["Python"],
            "experience": [{"title": "Software Engineer", "company": "Tech Corp", "details": "Built and managed systems."}],
        },
        "jobs": [make_job(
            title="Software Engineer",
            description="Looking for an engineer who built large systems and managed agile teams."
        )],
    }
    result = api_client().post("/v1/workflows/job-analysis", json=payload).json()["results"][0]
    for evidence in result["matchedEvidence"]:
        assert not any(word in evidence.lower() for word in ["built", "managed", "leader", "agile", "engineer"])


def test_invalid_analysis_input_returns_safe_validation_error() -> None:
    response = api_client().post("/v1/workflows/job-analysis", json={"profile": {}, "jobs": [{"sourceId": "bad"}]})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "job-1" not in response.text


def test_graph_normalizes_jobs_before_evaluation_and_validates_results() -> None:
    job = AnalysisJob.model_validate(make_job(title="  Senior  Python Engineer "))
    profile = AnalysisProfile.model_validate({"skills": ["Python"], "target_job_titles": ["Python Engineer"]})
    results = __import__("asyncio").run(run_job_analysis(JobAnalysisRequest(profile=profile, jobs=[job])))
    assert results[0].title == "Senior Python Engineer"
