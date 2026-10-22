import re

from applypilot_ai.schemas import AnalysisFactor, AnalysisJob, AnalysisProfile, JobAnalysisResult

SKILL_CATALOG = (
    "TypeScript", "JavaScript", "React", "Node.js", "Python", "FastAPI", "Java", "C++", "C#", "SQL",
    "PostgreSQL", "MongoDB", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "HTML", "CSS", "Figma", "Git",
    "GitHub", "Linux", "Terraform", "CI/CD", "Redis", "Prisma", "REST API", "GraphQL", "Next.js", "Vue",
    "Angular", "Svelte", "Tailwind", "Django", "Flask", "Spring", "Golang", "Go", "Rust", "PHP", "Laravel",
    "Ruby", "Rails", "Machine Learning", "Data Analysis", "Deep Learning", "PyTorch", "TensorFlow",
    "Pandas", "NumPy", "Scikit-Learn", "LangGraph", "LangChain", "LLM", "NLP", "Kafka", "RabbitMQ",
    "Elasticsearch", "Swift", "Kotlin", "React Native", "Flutter", "Android", "iOS", "Microservices",
)

MOBILE_SKILLS = {"swift", "kotlin", "react native", "flutter", "android", "ios"}

BASE_WEIGHTS = {"skills": 40, "role": 25, "experience": 20, "location": 15}

STOP_WORDS = {
    "and", "the", "with", "for", "from", "that", "this", "our", "you", "your", "are", "will", "who", "has",
    "have", "using", "use", "work", "team", "role", "job", "years", "year", "experience", "ability", "strong",
    "required", "preferred", "must", "nice", "plus", "build", "develop", "create", "support", "built", "managed",
    "code", "system", "systems", "good", "great", "lead", "help", "working", "tools", "join", "looking", "apply",
    "candidate", "candidates", "skills", "knowledge", "understanding", "degree", "field", "related", "equivalent",
    "optimized", "leader", "agile", "engineer"
}

UNRELATED_DOMAINS = (
    "music licensing", "sales representative", "account executive", "insurance agent", "real estate",
    "branch manager", "customer service representative", "retail associate", "cashier", "nurse",
    "paralegal", "mortgage", "loan officer", "call center", "telemarketer", "marketing manager",
    "content creator", "financial advisor", "truck driver", "warehouse associate", "dental",
    "physician", "store manager", "business development representative", "bdr", "sdr", "advertising sales"
)

SENIOR_KEYWORDS = {"director", "vp", "vice president", "head of", "principal", "chief", "executive", "lead architect", "partner", "engineering manager"}
LEAD_KEYWORDS = {"senior", "lead", "staff", "architect", "tech lead", "sr.", "team lead"}
ENTRY_KEYWORDS = {"intern", "internship", "graduate", "junior", "entry", "associate", "trainee", "new grad", "student", "apprentice"}


def _contains(text: str, phrase: str) -> bool:
    pattern = rf"(?<![A-Za-z0-9]){re.escape(phrase)}(?![A-Za-z0-9])"
    return re.search(pattern, text, re.IGNORECASE) is not None


def _terms(text: str) -> set[str]:
    return {term for term in re.findall(r"[a-z0-9+#.]+", text.casefold()) if len(term) > 2 and term not in STOP_WORDS}


def _factor(name: str, score: int | None, available: bool, evidence: list[str], limitations: list[str]) -> AnalysisFactor:
    return AnalysisFactor(
        name=name,
        score=score,
        weight=BASE_WEIGHTS[name] if available else 0,
        available=available,
        matched_evidence=evidence[:20],
        limitations=limitations[:10]
    )


def _normalize_location(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def _extract_skills(text: str, custom_skills: list[str]) -> list[str]:
    combined_catalog = list(dict.fromkeys([*SKILL_CATALOG, *custom_skills]))
    return [skill for skill in combined_catalog if _contains(text, skill)]


def _check_language_eligibility(job: AnalysisJob, declared_languages: list[str]) -> tuple[bool, str, str]:
    candidate_langs = {lang.strip().casefold() for lang in (declared_languages or ["English"])}
    full_text = f"{job.title} {job.description}".casefold()

    has_german = (
        re.search(r"\(m/w/d\)|\(w/m/d\)|\(m/f/d\)", job.title, re.I) is not None
        or re.search(r"\b(werkstudent|praktikant|praktikum|softwareentwickler|entwickler|fachinformatiker)\b", job.title, re.I) is not None
        or re.search(r"\b(flie(ß|ss)end(e)?\s+deutsch|gute\s+deutschkenntnisse|sehr\s+gute\s+deutschkenntnisse|deutschkenntnisse|deutsch\s+in\s+wort\s+und\s+schrift|verhandlungssicher(e)?\s+deutsch|deutsch\s+(b2|c1|c2)|fluent\s+german|german\s+(required|is\s+required|b2|c1|c2|fluent|fluency|proficiency)|c1\s+german|b2\s+german)\b", full_text, re.I) is not None
        or re.search(r"\b(wir\s+suchen|deine\s+aufgaben|dein\s+profil|was\s+wir\s+bieten|über\s+uns|du\s+bringst\s+mit|unsere\s+anforderungen)\b", full_text, re.I) is not None
    )
    if has_german and "german" not in candidate_langs and "deutsch" not in candidate_langs:
        return False, "Posting requires German language proficiency, which is not declared in the candidate profile.", "unsupported_language"

    has_french = (
        re.search(r"\b(français\s+(courant|exigé|requis)|maîtrise\s+du\s+français|french\s+(required|fluent|fluency))\b", full_text, re.I) is not None
        or re.search(r"\b(nous\s+recherchons|vos\s+missions|votre\s+profil)\b", full_text, re.I) is not None
    )
    if has_french and "french" not in candidate_langs and "français" not in candidate_langs:
        return False, "Posting requires French language proficiency, which is not declared in the candidate profile.", "unsupported_language"

    return True, "", ""


def _check_seniority_eligibility(job_title: str, candidate_job_types: list[str], candidate_targets: list[str]) -> tuple[bool, str]:
    title_lower = job_title.casefold()
    target_text = f"{' '.join(candidate_targets)} {' '.join(candidate_job_types)}".casefold()
    candidate_is_entry = bool(target_text.strip()) and any(k in target_text for k in ENTRY_KEYWORDS)

    if candidate_is_entry:
        if any(_contains(title_lower, kw) for kw in SENIOR_KEYWORDS):
            return False, f"Seniority mismatch: Role '{job_title}' is at Director/Executive level, incompatible with candidate's entry/graduate scope."
        if any(_contains(title_lower, kw) for kw in LEAD_KEYWORDS):
            return False, f"Seniority mismatch: Role '{job_title}' requires senior/lead level experience, incompatible with candidate's entry/graduate scope."
    return True, ""


def _check_domain_eligibility(job: AnalysisJob, technical_domains: list[str], candidate_skills: list[str]) -> tuple[bool, str, str]:
    title_lower = job.title.casefold()

    for domain in UNRELATED_DOMAINS:
        if _contains(title_lower, domain):
            return False, f"Job role '{job.title}' belongs to an unrelated domain outside candidate's target technical scope.", "unrelated_domain"

    candidate_has_mobile_domain = any(re.search(r"mobile|ios|android", d, re.I) for d in technical_domains)
    candidate_has_mobile_skill = any(s.strip().casefold() in MOBILE_SKILLS for s in candidate_skills)

    if not candidate_has_mobile_domain and not candidate_has_mobile_skill:
        is_mobile_role = (
            re.search(r"\b(ios\s+developer|ios\s+engineer|android\s+developer|android\s+engineer|mobile\s+app\s+developer|mobile\s+engineer|mobile\s+developer|react\s+native\s+developer|flutter\s+developer|swift\s+developer)\b", title_lower, re.I) is not None
            or (re.search(r"\b(ios|android|mobile\s+app)\b", title_lower, re.I) is not None and re.search(r"\b(developer|engineer|lead)\b", title_lower, re.I) is not None)
        )
        if is_mobile_role:
            return False, f"Role '{job.title}' requires specialized mobile development (iOS/Android), which is outside candidate's target technical domains and demonstrated skills.", "mobile_domain_mismatch"

    return True, "", ""


def _check_freshness(job: AnalysisJob) -> tuple[bool, str]:
    desc = job.description.casefold()
    if re.search(r"\b(no\s+longer\s+accepting\s+applications|this\s+job\s+has\s+expired|position\s+closed)\b", desc, re.I):
        return False, "Job posting is marked closed and no longer accepting applications."
    return True, ""


def _create_ineligible_result(job: AnalysisJob, reason: str, category: str, profile: AnalysisProfile | None = None) -> JobAnalysisResult:
    factors = [
        _factor("skills", 0, False, [], [reason]),
        _factor("role", 0, False, [], [reason]),
        _factor("experience", 0, False, [], [reason]),
        _factor("location", 0, False, [], [reason]),
    ]
    return JobAnalysisResult(
        source_id=job.source_id,
        source=job.source,
        title=job.title,
        company=job.company,
        location=job.location,
        country=job.country,
        work_arrangement=job.work_arrangement or ("remote" if job.remote else None),
        url=job.url,
        remote=job.remote,
        score=0,
        recommendation="ineligible",
        confidence="high",
        confidence_reasons=["Excluded by deterministic eligibility gate."],
        factor_breakdown=factors,
        matched_evidence=[],
        missing_or_unverified=[reason],
        explanation=[reason],
        eligible=False,
        rejection_reason=reason,
        rejection_category=category
    )


def _evaluate_one(job: AnalysisJob, profile: AnalysisProfile) -> JobAnalysisResult:
    # 1. Language gate
    lang_ok, lang_reason, lang_cat = _check_language_eligibility(job, profile.languages)
    if not lang_ok:
        return _create_ineligible_result(job, lang_reason, lang_cat)

    # 2. Seniority gate
    seniority_ok, seniority_reason = _check_seniority_eligibility(job.title, profile.job_types, profile.target_job_titles)
    if not seniority_ok:
        return _create_ineligible_result(job, seniority_reason, "seniority_mismatch")

    # 3. Domain & Mobile gate
    domain_ok, domain_reason, domain_cat = _check_domain_eligibility(job, profile.technical_domains, profile.skills)
    if not domain_ok:
        return _create_ineligible_result(job, domain_reason, domain_cat)

    # 4. Freshness gate
    fresh_ok, fresh_reason = _check_freshness(job)
    if not fresh_ok:
        return _create_ineligible_result(job, fresh_reason, "stale_posting")

    # 5. Work arrangement gate
    actual_arrangement = job.work_arrangement or ("remote" if job.remote else None)
    work_arrangements = profile.work_arrangements or []
    strict_remote_mismatch = (
        len(work_arrangements) == 1
        and work_arrangements[0] == "remote"
        and (job.remote is False or actual_arrangement in ("hybrid", "onsite"))
    )
    if strict_remote_mismatch:
        return _create_ineligible_result(job, "Listing is marked non-remote while saved work arrangement is remote-only.", "strict_remote_mismatch")

    desc = job.description
    text = f"{job.title} {desc} {' '.join(job.tags)}"

    # 1. Skills Evaluation
    identified_skills = _extract_skills(text, profile.skills)
    recognized_tags = [tag for tag in job.tags if any(_contains(tag, skill) for skill in SKILL_CATALOG)]
    for tag in recognized_tags:
        for skill in SKILL_CATALOG:
            if _contains(tag, skill) and skill not in identified_skills:
                identified_skills.append(skill)

    profile_skills_map = {skill.casefold(): skill for skill in profile.skills}
    matched_skills = [profile_skills_map[s.casefold()] for s in identified_skills if s.casefold() in profile_skills_map]
    missing_skills = [s for s in identified_skills if s.casefold() not in profile_skills_map]

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

    skill_score = (
        round(100 * len(matched_skills) / len(identified_skills))
        if skills_available and profile.skills
        else (0 if skills_available else None)
    )
    skill_evidence = [f"Skill match: {skill}." for skill in matched_skills]
    skill_factor = _factor(
        "skills",
        skill_score,
        skills_available and bool(profile.skills),
        skill_evidence,
        limitations if not (skills_available and profile.skills) else []
    )

    # 2. Role & Domain Relevance Evaluation
    title_terms = _terms(job.title)
    target_matches: list[str] = []
    role_scores: list[int] = []

    for target in profile.target_job_titles:
        target_terms = _terms(target)
        if target_terms and title_terms:
            overlap = len(target_terms & title_terms) / len(target_terms)
            role_scores.append(round(overlap * 100))
            if overlap >= 0.4:
                target_matches.append(target)

    role_available = bool(profile.target_job_titles)
    role_score = max(role_scores) if role_scores else (0 if role_available else None)
    role_limits = [] if role_available else ["Target job titles are not set in the candidate profile."]

    role_evidence = [f"Title overlaps target role: {title}." for title in target_matches]
    title_lower = job.title.casefold()
    if any(_contains(title_lower, kw) for kw in ENTRY_KEYWORDS):
        role_evidence.append(f"Role level aligns with target entry/graduate scope: {job.title}.")

    role_factor = _factor("role", role_score, role_available, role_evidence, role_limits)
    if not role_available:
        unverified.append("Role relevance is unknown because no target job titles are set.")

    # 3. Experience Evidence Evaluation
    experience_available = bool(profile.experience) and bool(desc.strip())
    experience_evidence: list[str] = []
    experience_limits: list[str] = []
    experience_score: int | None = None

    if not profile.experience:
        experience_limits.append("No work experience evidence is available in the candidate profile.")
        unverified.append("Relevant experience could not be verified from the profile.")
    elif not desc.strip():
        experience_limits.append("The job description is missing, so experience evidence cannot be compared.")
    else:
        exp_tech_matches: list[str] = []
        for exp in profile.experience:
            exp_text = f"{exp.title} {exp.company} {exp.details}"
            matched = [s for s in identified_skills if _contains(exp_text, s)]
            for s in matched:
                if s not in exp_tech_matches:
                    exp_tech_matches.append(s)
                    experience_evidence.append(f"Verified experience with {s} at {exp.company or 'previous role'} aligns with job stack.")

        if exp_tech_matches:
            experience_score = min(100, round(100 * len(exp_tech_matches) / max(1, min(4, len(identified_skills)))))
        else:
            has_title_overlap = any(bool(_terms(exp.title) & title_terms) for exp in profile.experience)
            experience_score = 40 if has_title_overlap else 10
            if has_title_overlap:
                experience_evidence.append("Prior job title aligns with role domain.")

    experience_factor = _factor("experience", experience_score, experience_available, experience_evidence, experience_limits)

    # 4. Location Evaluation
    location_prefs = [*profile.preferred_locations, *profile.preferred_countries]
    job_location_norm = _normalize_location(f"{job.location} {job.country or ''}")
    location_matches = [
        pref for pref in location_prefs
        if _normalize_location(pref) and f" {_normalize_location(pref)} " in f" {job_location_norm} "
    ]

    location_evidence: list[str] = []
    location_limits: list[str] = []

    if not location_prefs and "remote" in work_arrangements and actual_arrangement == "remote":
        location_score: int | None = 100
        location_evidence.append("The listing is marked remote and remote is a profile preference.")
    elif location_matches:
        location_score = 100
        location_evidence.extend(f"Listing location matches profile preference: {m}." for m in location_matches)
    elif location_prefs and (job.location.strip() or job.country):
        location_score = 30
        unverified.append("Listed job location does not match a saved location preference; verify geographic eligibility.")
    else:
        location_score = None
        unverified.append("Location/work preferences or listing location are missing; fit is unknown.")

    location_limits.append("Employer eligibility, work authorization, and sponsorship are not verified by the available listing data.")
    unverified.append("Employer eligibility, work authorization, and sponsorship compatibility are unknown; verify with the employer.")
    location_factor = _factor("location", location_score, bool(location_prefs or work_arrangements), location_evidence, location_limits)

    # Calculate overall weighted score
    factors = [skill_factor, role_factor, experience_factor, location_factor]
    available_factors = [factor for factor in factors if factor.available and factor.score is not None]
    total_weight = sum(BASE_WEIGHTS[factor.name] for factor in available_factors)

    if total_weight:
        for factor in factors:
            factor.weight = round(BASE_WEIGHTS[factor.name] * 100 / total_weight) if factor in available_factors else 0
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

    if score is None:
        recommendation = "unknown"
        explanation = ["There is not enough profile or job information to estimate fit."]
    elif score >= 75:
        recommendation = "strong_match"
        explanation = ["Candidate profile exhibits strong evidence of technical alignment and role fit."]
    elif score >= 50:
        recommendation = "potential_match"
        explanation = ["Key profile signals align; review missing or unverified skill requirements."]
    else:
        recommendation = "low_match"
        explanation = ["Limited profile evidence aligns with this listing."]

    if incomplete_description:
        explanation.append("The description is incomplete, so this ranking has limited confidence.")

    return JobAnalysisResult(
        source_id=job.source_id,
        source=job.source,
        title=job.title,
        company=job.company,
        location=job.location,
        country=job.country,
        work_arrangement=actual_arrangement,
        url=job.url,
        remote=job.remote,
        score=score,
        recommendation=recommendation,
        confidence=confidence,
        confidence_reasons=confidence_reasons,
        factor_breakdown=factors,
        matched_evidence=[item for factor in factors for item in factor.matched_evidence][:30],
        missing_or_unverified=list(dict.fromkeys(unverified))[:30],
        explanation=explanation,
        eligible=True,
        rejection_reason=None,
        rejection_category=None
    )


def evaluate_jobs(jobs: list[AnalysisJob], profile: AnalysisProfile) -> list[JobAnalysisResult]:
    results = [_evaluate_one(job, profile) for job in jobs]
    return sorted(
        results,
        key=lambda item: (
            not item.eligible,
            item.score is None,
            -(item.score or 0),
            item.title.casefold()
        )
    )
