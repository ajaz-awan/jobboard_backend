import { supabase } from "../config/supabaseClient.js";
import AppError from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ==============================
// CREATE JOB
// POST /api/jobs  (protect + authorize("employer"))
// ==============================
export const createJob = asyncHandler(async (req, res) => {
  // title/description ka required check ab createJobSchema (Zod, route mein) kar chuka hai — dobara zaroorat nahi
  const { title, description, location, job_type, salary_min, salary_max, status } = req.body;

  const { data, error } = await supabase
    .from("jobs")
    .insert([
      {
        title,
        description,
        location,
        job_type,
        salary_min,
        salary_max,
        status: status || "open",
        employer_id: req.user.id,
      },
    ])
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);

  res.status(201).json({
    success: true,
    message: "Job successfully create ho gayi",
    job: data,
  });
});

// ==============================
// ==============================
// GET ALL JOBS (with optional filters + pagination)
// GET /api/jobs?title=&location=&job_type=&page=&limit=
// ==============================
export const getAllJobs = asyncHandler(async (req, res) => {
  const { title, location, job_type, status, page, limit } = req.query;
  // page/limit ab paginationSchema (Zod, route mein) se validated + defaulted (1, 10) milte hain

  let query = supabase.from("jobs").select("*", { count: "exact" });
  // { count: "exact" } — Supabase ko batata hai total rows bhi gino (pagination info ke liye chahiye)

  if (title) query = query.ilike("title", `%${title}%`);
  if (location) query = query.ilike("location", `%${location}%`);
  if (job_type) query = query.eq("job_type", job_type);

  if (status) {
    query = query.eq("status", status);
  } else if (req.user.role === "candidate") {
    query = query.eq("status", "open");
  }

  // Pagination ka math: page 1 → rows 0-9, page 2 → rows 10-19, etc. (jab limit=10)
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to); // Supabase ka range() method — SQL LIMIT/OFFSET jaisa kaam karta hai

  if (error) throw new AppError(error.message, 500);

  res.status(200).json({
    success: true,
    count: data.length, // is page mein kitni jobs hain
    total: count, // total jobs (sab filters ke sath) — frontend ko total pages calculate karne ke liye chahiye
    page,
    totalPages: Math.ceil(count / limit),
    jobs: data,
  });
});

// ==============================
// GET SINGLE JOB
// GET /api/jobs/:id
// ==============================
export const getJobById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new AppError("Job nahi mili", 404);
  }

  res.status(200).json({
    success: true,
    job: data,
  });
});

// ==============================
// UPDATE JOB
// PATCH /api/jobs/:id  (protect + authorize("employer"))
// ==============================
export const updateJob = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: existingJob, error: fetchError } = await supabase
    .from("jobs")
    .select("employer_id")
    .eq("id", id)
    .single();

  if (fetchError || !existingJob) {
    throw new AppError("Job nahi mili", 404);
  }

  if (existingJob.employer_id !== req.user.id) {
    throw new AppError("Aap sirf apni banayi hui job edit kar sakte hain", 403);
  }

  const allowedFields = ["title", "description", "location", "job_type", "salary_min", "salary_max", "status"];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  const { data, error } = await supabase
    .from("jobs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);

  res.status(200).json({
    success: true,
    message: "Job update ho gayi",
    job: data,
  });
});

// ==============================
// DELETE JOB
// DELETE /api/jobs/:id  (protect + authorize("employer"))
// ==============================
export const deleteJob = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: existingJob, error: fetchError } = await supabase
    .from("jobs")
    .select("employer_id")
    .eq("id", id)
    .single();

  if (fetchError || !existingJob) {
    throw new AppError("Job nahi mili", 404);
  }

  if (existingJob.employer_id !== req.user.id) {
    throw new AppError("Aap sirf apni banayi hui job delete kar sakte hain", 403);
  }

  const { error } = await supabase.from("jobs").delete().eq("id", id);

  if (error) throw new AppError(error.message, 500);

  res.status(200).json({
    success: true,
    message: "Job delete ho gayi",
  });
});