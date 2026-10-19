# ApplyPilot AI project guidance

- Keep the MVP focused on a personal job application tracker.
- Do not add job scraping, automated external applications, or email sending without an explicit later request.
- Keep API validation in `packages/shared` and return consistent `{ error: { code, message, details? } }` responses.
- Use Prisma/PostgreSQL for persistence; preserve the Application model's existing fields and status values.
- Keep schema changes in Prisma migrations and update the generated Prisma Client through the API workspace scripts.
- Read configuration from environment variables; never commit `.env` files or secrets.
- Keep changes small and compatible with local development on Windows.
