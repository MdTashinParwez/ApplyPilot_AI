from applypilot_ai.schemas import JobMatchRequest, JobMatchResult


def score_job_match(payload: JobMatchRequest) -> JobMatchResult:
    profile = {skill.casefold(): skill for skill in payload.profile_skills}
    required = list(dict.fromkeys(payload.required_skills))
    matched = [profile[skill.casefold()] for skill in required if skill.casefold() in profile]
    missing = [skill for skill in required if skill.casefold() not in profile]
    score = len(matched) / len(required) if required else 0.0
    return JobMatchResult(score=score, matched_skills=matched, missing_skills=missing, method="skill_overlap")
