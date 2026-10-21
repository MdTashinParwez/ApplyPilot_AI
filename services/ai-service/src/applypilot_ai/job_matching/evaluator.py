import re

from applypilot_ai.schemas import AnalysisFactor, AnalysisJob, AnalysisProfile, JobAnalysisResult

SKILL_CATALOG = (
    "TypeScript", "JavaScript", "React", "Node.js", "Python", "FastAPI", "Java", "C++", "C#", "SQL",
    "PostgreSQL", "MongoDB", "AWS", "Azure", "Docker", "Kubernetes", "HTML", "CSS", "Figma", "Git",
    "Excel", "Project Management", "Agile", "Leadership", "Communication", "Machine Learning", "Data Analysis",
    "LangGraph", "FastAPI", "Django", "Flask", "Redis", "Prisma", "REST API", "GraphQL", "Linux", "Terraform",
)
BASE_WEIGHTS = {"skills": 40, "role": 25, "experience": 20, "location": 15}
STOP_WORDS = {"and", "the", "with", "for", "from", "that", "this", "our", "you", "your", "are", "will", "who", "has", "have", "using", "use", "work", "team", "role", "job", "years", "year", "experience", "ability", "strong", "required", "preferred", "must", "nice", "plus", "build", "develop", "create", "support"}


def _contains(text: str, phrase: str) -> bool:
    pattern = rf"(?<![A-Za-z0-9]){re.escape(phrase)}(?![A-Za-z0-9])"
    return re.search(pattern, text, re.IGNORECASE) is not None


def _terms(text: str) -> set[str]:
    return {term for term in re.findall(r"[a-z0-9+#.]+", text.casefold()) if len(term) > 2 and term not in STOP_WORDS}


def _factor(name: str, score: int | None, available: bool, evidence: list[str], limitations: list[str]) -> AnalysisFactor:
    return AnalysisFactor(name=name, score=score, weight=BASE_WEIGHTS[name] if available else 0, available=available, matched_evidence=evidence[:20], limitations=limitations[:10])


def _normalize_location(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def _evaluate_one(job: AnalysisJob, profile: AnalysisProfile) -> JobAnalysisResult:
    desc = job.description
    text = f"{job.title} {desc} {' '.join(job.tags)}"
    identified_skills = [skill for skill in SKILL_CATALOG if _contains(text, skill)]
    recognized_tags = [tag for tag in job.tags if any(_contains(tag, skill) for skill in SKILL_CATALOG)]
    if recognized_tags:
        for tag in recognized_tags:
            for skill in SKILL_CATALOG:
                if _contains(tag, skill) and skill not in identified_skills:
                    identified_skills.append(skill)

    profile_skills = {skill.casefold(): skill for skill in profile.skills}
    matched_skills = [profile_skills[skill.casefold()] for skill in identified_skills if skill.casefold() in profile_skills]
    missing_skills = [skill for skill in identified_skills if skill.casefold() not in profile_skills]
    limitations: list[str] = []
    unverified: list[str] = []

    skills_available = bool(identified_skills)
    if not skills_available:
        limitations.append("No specific skills could be identified in the job title, tags, or description.")
        unverified.append("Job requirements do not list recognizable skills; skill fit is unknown.")
    elif not profile.skills:
        limitations.append("The candidate profile does not list skills to compare.")
        unverified.extend(f"Candidate skill not verified: {skill}." for skill in identified_skills)
    else:
        unverified.extend(f"Candidate skill not listed: {skill}." for skill in missing_skills)
    skill_score = round(100 * len(matched_skills) / len(identified_skills)) if skills_available and profile.skills else (0 if skills_available else None)
    skill_factor = _factor("skills", skill_score, skills_available and bool(profile.skills), [f"Skill match: {skill}." for skill in matched_skills], limitations if not (skills_available and profile.skills) else [])

    title_terms = _terms(job.title)
    target_matches: list[str] = []
    role_scores: list[int] = []
    for target in profile.target_job_titles:
        target_terms = _terms(target)
        if target_terms and title_terms:
            overlap = len(target_terms & title_terms) / len(target_terms)
            role_scores.append(round(overlap * 100))
            if overlap >= 0.5:
                target_matches.append(target)
    role_available = bool(profile.target_job_titles)
    role_score = max(role_scores) if role_scores else (0 if role_available else None)
    role_limits = [] if role_available else ["Target job titles are not set in the candidate profile."]
    role_factor = _factor("role", role_score, role_available, [f"Title overlaps target role: {title}." for title in target_matches], role_limits)
    if not role_available:
        unverified.append("Role relevance is unknown because no target job titles are set.")

    experience_parts = [" ".join((item.title, item.company, item.details)) for item in profile.experience]
    experience_text = " ".join(experience_parts)
    evidence_terms = _terms(f"{job.title} {desc}")
    shared_terms = _terms(experience_text) & evidence_terms
    experience_available = bool(experience_parts and desc.strip())
    experience_score = min(100, round(100 * len(shared_terms) / max(1, min(8, len(evidence_terms))))) if experience_available else None
    experience_evidence = [f"Profile experience mentions: {term}." for term in sorted(shared_terms)[:8]]
    experience_limits = []
    if not experience_parts:
        experience_limits.append("No work experience evidence is available in the candidate profile.")
        unverified.append("Relevant experience could not be verified from the profile.")
    elif not desc.strip():
        experience_limits.append("The job description is missing, so experience evidence cannot be compared.")
    experience_factor = _factor("experience", experience_score, experience_available, experience_evidence, experience_limits)

    location_prefs = [*profile.preferred_locations, *profile.preferred_countries]
    job_location = _normalize_location(f"{job.location} {job.country or ''}")
    location_matches = [pref for pref in location_prefs if _normalize_location(pref) and f" {_normalize_location(pref)} " in f" {job_location} "]
    location_available = bool(location_prefs and (job.location.strip() or job.country)) or (bool(profile.work_arrangements) and (job.remote is not None or job.work_arrangement is not None))
    actual_arrangement = job.work_arrangement or ("remote" if job.remote is True else None)
    strict_remote_mismatch = profile.work_arrangements == ["remote"] and (job.remote is False or actual_arrangement in {"hybrid", "onsite"})
    if strict_remote_mismatch:
        location_score = 0
        location_evidence = ["The profile is set to remote-only and the listing is marked non-remote."]
    elif not location_prefs and profile.work_arrangements and actual_arrangement == "remote" and "remote" in profile.work_arrangements:
        location_score = 100
        location_evidence = ["The listing is marked remote and remote is a profile preference."]
    elif location_matches:
        location_score = 100
        location_evidence = [f"Listing location matches profile preference: {pref}." for pref in location_matches]
    elif location_prefs and (job.location.strip() or job.country):
        location_score = 25
        location_evidence = []
        unverified.append("Listed job location does not match a saved location preference; verify geographic eligibility.")
    elif location_available:
        location_score = None
        location_evidence = []
        unverified.append("Work arrangement fit is unknown from the available listing data.")
    else:
        location_score = None
        location_evidence = []
        unverified.append("Location/work preferences or listing location are missing; fit is unknown.")
    location_limits = []
    if not job.location and location_prefs:
        location_limits.append("The listing does not provide a location.")
    if job.remote is None and profile.work_arrangements:
        location_limits.append("The listing does not provide remote/work-arrangement information.")
    if profile.work_authorization:
        location_limits.append("Work authorization and sponsorship are not verified by the available listing data.")
        unverified.append("Work authorization and sponsorship compatibility are unknown; verify with the employer.")
    location_factor = _factor("location", location_score, location_available, location_evidence, location_limits)

    factors = [skill_factor, role_factor, experience_factor, location_factor]
    available_factors = [factor for factor in factors if factor.available and factor.score is not None]
    total_weight = sum(BASE_WEIGHTS[factor.name] for factor in available_factors)
    if total_weight:
        for factor in factors:
            factor.weight = round(BASE_WEIGHTS[factor.name] * 100 / total_weight) if factor in available_factors else 0
        # Correct rounding so the displayed active weights add to exactly 100.
        if available_factors:
            available_factors[0].weight += 100 - sum(factor.weight for factor in available_factors)
        score = round(sum((factor.score or 0) * BASE_WEIGHTS[factor.name] for factor in available_factors) / total_weight)
    else:
        score = None

    incomplete_description = len(desc.strip()) < 200
    confidence_reasons = []
    if incomplete_description:
        confidence_reasons.append("The job description is missing or very short; evaluation is less complete.")
    if not identified_skills:
        confidence_reasons.append("No explicit recognizable skill requirements were found.")
    if not profile.experience:
        confidence_reasons.append("The profile has no work experience entries.")
    confidence = "low" if incomplete_description or not available_factors else ("high" if len(available_factors) >= 3 and identified_skills else "medium")

    if strict_remote_mismatch:
        recommendation = "ineligible"
        score = 0
        explanation = ["This listing is marked non-remote while the saved work arrangement is remote-only."]
    elif score is None:
        recommendation = "unknown"
        explanation = ["There is not enough profile or job information to estimate fit."]
    elif score >= 75:
        recommendation = "strong_match"
        explanation = ["Several available profile signals align with this listing."]
    elif score >= 50:
        recommendation = "potential_match"
        explanation = ["Some available profile signals align; review the missing or unverified items."]
    else:
        recommendation = "low_match"
        explanation = ["Few available profile signals align with this listing."]
    if incomplete_description:
        explanation.append("The description is incomplete, so this ranking has limited confidence.")
    return JobAnalysisResult(
        source_id=job.source_id, source=job.source, title=job.title, company=job.company,
        location=job.location, country=job.country, work_arrangement=actual_arrangement, url=job.url, remote=job.remote, score=score,
        recommendation=recommendation, confidence=confidence, confidence_reasons=confidence_reasons,
        factor_breakdown=factors,
        matched_evidence=[item for factor in factors for item in factor.matched_evidence][:30],
        missing_or_unverified=list(dict.fromkeys(unverified))[:30], explanation=explanation,
    )


def evaluate_jobs(jobs: list[AnalysisJob], profile: AnalysisProfile) -> list[JobAnalysisResult]:
    results = [_evaluate_one(job, profile) for job in jobs]
    return sorted(results, key=lambda item: (item.recommendation != "ineligible", item.score is None, -(item.score or 0), item.title.casefold()))
