import type { ApplicationRecord, CandidateProfileInput, CandidateProfileRecord, CreateApplicationInput, Job, SavedJob } from "@applypilot/shared";

export type SaveJobResult = { job: SavedJob; duplicate: boolean };
export type MoveJobResult = { application: ApplicationRecord; alreadyTracked: boolean };

export interface ApplicationRepository {
  list(): Promise<ApplicationRecord[]>;
  create(data: CreateApplicationInput): Promise<ApplicationRecord>;
  listSavedJobs(): Promise<SavedJob[]>;
  saveJob(data: Job): Promise<SaveJobResult>;
  moveSavedJobToApplication(id: string): Promise<MoveJobResult | null>;
  getProfile(): Promise<CandidateProfileRecord | null>;
  upsertProfile(data: CandidateProfileInput): Promise<CandidateProfileRecord>;
  ping(): Promise<void>;
}
