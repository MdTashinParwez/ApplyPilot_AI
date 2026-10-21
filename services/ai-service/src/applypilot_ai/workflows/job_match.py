from typing import Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from applypilot_ai.schemas import JobMatchRequest, JobMatchResult


class JobMatchState(TypedDict):
    request: JobMatchRequest
    result: JobMatchResult | None


def build_job_match_graph(scorer: Callable[[JobMatchRequest], JobMatchResult]):
    def evaluate(state: JobMatchState) -> dict[str, JobMatchResult]:
        return {"result": scorer(state["request"])}

    graph = StateGraph(JobMatchState)
    graph.add_node("evaluate", evaluate)
    graph.add_edge(START, "evaluate")
    graph.add_edge("evaluate", END)
    return graph.compile()


async def run_job_match(request: JobMatchRequest, scorer: Callable[[JobMatchRequest], JobMatchResult]) -> JobMatchResult:
    workflow = build_job_match_graph(scorer)
    state = await workflow.ainvoke({"request": request, "result": None})
    return JobMatchResult.model_validate(state["result"])
