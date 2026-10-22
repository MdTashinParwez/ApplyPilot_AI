import { assistantDashboardSchema, type AssistantDashboard } from "./assistantTypes.js";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export async function requestAssistantApi(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = readErrorMessage(body);
    throw new Error(message);
  }

  return body;
}

export async function loadAssistantDashboard(): Promise<AssistantDashboard> {
  const response = await requestAssistantApi("/api/assistant/dashboard");
  return assistantDashboardSchema.parse(response);
}

function readErrorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return "The request could not be completed.";
  }

  const error = body.error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "The request could not be completed.";
}
