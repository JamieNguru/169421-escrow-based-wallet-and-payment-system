import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "./currency";
import { photosSchema } from "./photos";

export const postJobSchema = z.object({
  title: z.string({ error: "title is required" }).trim().min(1, "title is required"),
  description: z.string({ error: "description is required" }).trim().min(1, "description is required"),
  budget: z
    .number({ error: "budget must be a number" })
    .positive("budget must be greater than 0")
    .finite("budget must be a finite number"),
  currency: z
    .string({ error: "currency is required" })
    .trim()
    .toUpperCase()
    .pipe(z.enum(SUPPORTED_CURRENCIES, { error: `currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}` })),
  // lat and lng come together (the client's "use my location"); they let workers see a distance.
  location: z
    .object({
      label: z.string({ error: "location label is required" }).trim().min(1, "location label is required").max(120, "location label must be at most 120 characters"),
      lat: z.number({ error: "lat must be a number" }).min(-90).max(90).optional(),
      lng: z.number({ error: "lng must be a number" }).min(-180).max(180).optional(),
    })
    .refine((l) => (l.lat === undefined) === (l.lng === undefined), "lat and lng must be given together")
    .optional(),
  photos: photosSchema.optional(),
});

export type PostJobInput = z.infer<typeof postJobSchema>;

export const browseJobsQuerySchema = z.object({
  limit: z.coerce
    .number({ error: "limit must be a number" })
    .int("limit must be a whole number")
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  cursor: z.iso.datetime({ error: "cursor must be an ISO date-time" }).pipe(z.coerce.date()).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(SUPPORTED_CURRENCIES, { error: `currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}` }))
    .optional(),
  // The worker's position, to get each job's distance. Both or neither (checked in the route).
  lat: z.coerce.number({ error: "lat must be a number" }).min(-90, "lat must be between -90 and 90").max(90, "lat must be between -90 and 90").optional(),
  lng: z.coerce.number({ error: "lng must be a number" }).min(-180, "lng must be between -180 and 180").max(180, "lng must be between -180 and 180").optional(),
});

export type BrowseJobsQuery = z.infer<typeof browseJobsQuerySchema>;
