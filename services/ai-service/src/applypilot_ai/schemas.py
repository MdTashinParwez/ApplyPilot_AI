from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CamelModel(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, alias_generator=to_camel, populate_by_name=True)


class StructuredOutputRequest(StrictModel):
    text: str = Field(min_length=1, max_length=4000)


class StructuredOutputData(StrictModel):
    text: str = Field(max_length=4000)
    character_count: int = Field(ge=0, le=4000)


class StructuredOutputResponse(StrictModel):
    status: Literal["validated"]
    result: StructuredOutputData


class JobMatchRequest(StrictModel):
    profile_skills: list[str] = Field(max_length=50)
    job_title: str = Field(min_length=1, max_length=200)
    job_description: str = Field(default="", max_length=10000)
    required_skills: list[str] = Field(default_factory=list, max_length=50)


class JobMatchResult(StrictModel):
    score: float = Field(ge=0, le=1)
    matched_skills: list[str] = Field(max_length=50)
    missing_skills: list[str] = Field(max_length=50)
    method: Literal["skill_overlap"]


class JobMatchResponse(StrictModel):
    result: JobMatchResult


class CandidateExperience(CamelModel):
    title: str = Field(default="", max_length=160)
    company: str = Field(default="", max_length=160)
    details: str = Field(default="", max_length=1200)


class AnalysisProfile(CamelModel):
    skills: list[str] = Field(default_factory=list, max_length=50)
    professional_summary: str = Field(default="", max_length=1500)
    target_job_titles: list[str] = Field(default_factory=list, max_length=30)
    preferred_countries: list[str] = Field(default_factory=list, max_length=30)
    preferred_locations: list[str] = Field(default_factory=list, max_length=50)
    work_arrangements: list[Literal["remote", "hybrid", "onsite"]] = Field(default_factory=list, max_length=3)
    work_authorization: str = Field(default="", max_length=1000)
    experience: list[CandidateExperience] = Field(default_factory=list, max_length=8)


class AnalysisJob(CamelModel):
    source_id: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    company: str = Field(min_length=1, max_length=160)
    location: str = Field(default="", max_length=200)
    country: str | None = Field(default=None, max_length=120)
    work_arrangement: Literal["remote", "hybrid", "onsite"] | None = None
    description: str = Field(default="", max_length=5000)
    remote: bool | None = None
    tags: list[str] = Field(default_factory=list, max_length=30)
    job_types: list[str] = Field(default_factory=list, max_length=20)
    url: str = Field(min_length=1, max_length=2000)


class JobAnalysisRequest(CamelModel):
    profile: AnalysisProfile
    jobs: list[AnalysisJob] = Field(min_length=1, max_length=20)


class AnalysisFactor(CamelModel):
    name: Literal["skills", "role", "experience", "location"]
    score: int | None = Field(ge=0, le=100)
    weight: int = Field(ge=0, le=100)
    available: bool
    matched_evidence: list[str] = Field(default_factory=list, max_length=20)
    limitations: list[str] = Field(default_factory=list, max_length=10)


class JobAnalysisResult(CamelModel):
    source_id: str
    source: str
    title: str
    company: str
    location: str
    country: str | None = None
    work_arrangement: Literal["remote", "hybrid", "onsite"] | None = None
    url: str
    remote: bool | None
    score: int | None = Field(ge=0, le=100)
    recommendation: Literal["strong_match", "potential_match", "low_match", "ineligible", "unknown"]
    confidence: Literal["high", "medium", "low"]
    confidence_reasons: list[str] = Field(default_factory=list, max_length=10)
    factor_breakdown: list[AnalysisFactor] = Field(min_length=4, max_length=4)
    matched_evidence: list[str] = Field(default_factory=list, max_length=30)
    missing_or_unverified: list[str] = Field(default_factory=list, max_length=30)
    explanation: list[str] = Field(default_factory=list, max_length=10)


class JobAnalysisResponse(CamelModel):
    results: list[JobAnalysisResult] = Field(max_length=20)
