import type { ApplicationRecord, CreateApplicationInput } from "@applypilot/shared";

export interface ApplicationRepository {
  list(): Promise<ApplicationRecord[]>;
  create(data: CreateApplicationInput): Promise<ApplicationRecord>;
  ping(): Promise<void>;
}
