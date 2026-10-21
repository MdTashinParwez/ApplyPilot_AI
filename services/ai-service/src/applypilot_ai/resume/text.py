def normalize_resume_text(text: str, max_characters: int = 100_000) -> str:
    """Normalize already-extracted text; uploaded-file parsing is not implemented here."""
    if len(text) > max_characters:
        raise ValueError("Resume text exceeds the allowed size")
    return "\n".join(line.strip() for line in text.replace("\x00", "").splitlines()).strip()
