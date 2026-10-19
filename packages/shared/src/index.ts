import { z } from "zod";

export const applicationStatuses = ["saved", "applied", "interview", "offer", "rejected"] as const;
export const createApplicationSchema = z.object({
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).default(""),
  jobUrl: z.union([z.literal(""), z.url()]).default(""),
  status: z.enum(applicationStatuses).default("saved"),
  notes: z.string().trim().max(4000).default("")
});

export type ApplicationStatus = (typeof applicationStatuses)[number];
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export interface ApplicationRecord extends CreateApplicationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}
