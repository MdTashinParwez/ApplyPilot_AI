from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from applypilot_ai.job_matching.evaluator import evaluate_jobs
from applypilot_ai.schemas import AnalysisJob, AnalysisProfile, JobAnalysisRequest, JobAnalysisResult


class JobAnalysisState(TypedDict):
    request: JobAnalysisRequest
    normalized_jobs: list[AnalysisJob] | None
    results: list[JobAnalysisResult] | None


def _normalize_jobs(state: JobAnalysisState) -> dict[str, list[AnalysisJob]]:
    normalized = []
    for job in state["request"].jobs:
        normalized.append(job.model_copy(update={
            "title": " ".join(job.title.split()),
            "company": " ".join(job.company.split()),
            "location": " ".join(job.location.split()),
            "description": " ".join(job.description.split())[:5000],
            "tags": list(dict.fromkeys(tag.strip() for tag in job.tags if tag.strip())),
        }))
    return {"normalized_jobs": normalized}


def _evaluate(state: JobAnalysisState) -> dict[str, list[JobAnalysisResult]]:
    profile: AnalysisProfile = state["request"].profile
    return {"results": evaluate_jobs(state["normalized_jobs"] or [], profile)}


def build_job_analysis_graph():
    graph = StateGraph(JobAnalysisState)
    graph.add_node("normalize", _normalize_jobs)
    graph.add_node("evaluate", _evaluate)
    graph.add_edge(START, "normalize")
    graph.add_edge("normalize", "evaluate")
    graph.add_edge("evaluate", END)
    return graph.compile()


async def run_job_analysis(request: JobAnalysisRequest) -> list[JobAnalysisResult]:
    graph = build_job_analysis_graph()
    state = await graph.ainvoke({"request": request, "normalized_jobs": None, "results": None})
    return [JobAnalysisResult.model_validate(result) for result in (state["results"] or [])]
