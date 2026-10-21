import { Router } from "express";

import { HttpError } from "../errors";
import { authenticate, requireRole } from "../middleware/auth";
import { applyToJob, listJobApplications, selectWorker } from "../services/applicationService";
import { getJob, listMyJobs, listOpenJobs, postJob } from "../services/jobService";
import {
  applyToJobSchema,
  listApplicationsQuerySchema,
  selectWorkerSchema,
} from "../validation/applications";
import { browseJobsQuerySchema, postJobSchema } from "../validation/jobs";

const router = Router();

router.post("/", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = postJobSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const job = await postJob(req.user!.sub, parsed.data);
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

router.get("/mine", authenticate, requireRole("client", "worker"), async (req, res, next) => {
  try {
    const { sub, role } = req.user! as { sub: string; role: "client" | "worker" };
    res.json({ jobs: await listMyJobs(sub, role) });
  } catch (err) {
    next(err);
  }
});

router.get("/:jobId", authenticate, async (req, res, next) => {
  try {
    res.json({ job: await getJob(String(req.params.jobId)) });
  } catch (err) {
    next(err);
  }
});

router.post("/:jobId/apply", authenticate, requireRole("worker"), async (req, res, next) => {
  const parsed = applyToJobSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    const application = await applyToJob(req.user!.sub, String(req.params.jobId), parsed.data);
    res.status(201).json({ application });
  } catch (err) {
    next(err);
  }
});

router.get("/:jobId/applications", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = listApplicationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  const { limit, cursor } = parsed.data;
  try {
    res.json(await listJobApplications(req.user!.sub, String(req.params.jobId), { limit, before: cursor }));
  } catch (err) {
    next(err);
  }
});

router.post("/:jobId/select", authenticate, requireRole("client"), async (req, res, next) => {
  const parsed = selectWorkerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  try {
    res.json(await selectWorker(req.user!.sub, String(req.params.jobId), parsed.data.workerId));
  } catch (err) {
    next(err);
  }
});

router.get("/", authenticate, requireRole("worker"), async (req, res, next) => {
  const parsed = browseJobsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return next(new HttpError(400, message));
  }

  const { limit, cursor, currency, lat, lng } = parsed.data;
  if ((lat === undefined) !== (lng === undefined)) {
    return next(new HttpError(400, "lat and lng must be given together"));
  }
  try {
    const near = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    res.json(await listOpenJobs({ limit, before: cursor, currency, near }));
  } catch (err) {
    next(err);
  }
});

export default router;
