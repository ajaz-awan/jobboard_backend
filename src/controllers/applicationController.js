import { supabase } from "../config/supabaseClient.js";
import AppError from "../utils/AppError.js";
import {asyncHandler} from "../utils/asyncHandler.js";
import { uploadFileToStorage } from "../utils/uploadFileToStorage.js";

// ==========================================================
// 1. CANDIDATE APPLIES TO A JOB
// POST /api/applications
// ==========================================================
export const applyToJob = asyncHandler(async (req, res, next) => {
  const { job_id, cover_letter } = req.body;

  // job_id ka format/required check ab Zod (applySchema) route mein kar chuka hai — yahan dobara zaroorat nahi
  // Lekin req.file wala check yahan rakhna zaroori hai — Multer ki file hai, Zod isko validate nahi karta
  if (!req.file) {
    return next(new AppError("Resume file required hai (field name: 'resume')", 400));
  }
  

  // Job exist karta hai ya nahi, aur uska current status kya hai — ye check karna zaroori hai
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", job_id)
    .single();

  if (jobError || !job) {
    return next(new AppError("Job nahi mila", 404));
  }

  // Closed job pe apply karna allow nahi karna — business rule
  if (job.status !== "open") {
    return next(new AppError("Ye job abhi open nahi hai, apply nahi ho sakta", 400));
  }

  // Resume file ko Supabase Storage ke "resumes" bucket mein upload karo
  // Ye function buffer leta hai aur public URL wapas deta hai
  const resume_url = await uploadFileToStorage(req.file, "resumes");

  // Insert karte waqt candidate_id req.user.id se aa raha hai (token se), body se nahi
  const { data: application, error: insertError } = await supabase
    .from("applications")
    .insert({
      job_id,
      candidate_id: req.user.id,
      resume_url, // ab ye uploaded file ka asli public URL hai, dummy string nahi
      cover_letter: cover_letter || null,
    })
    .select()
    .single();

  if (insertError) {
    // Postgres ka unique_violation error code 23505 hota hai
    if (insertError.code === "23505") {
      return next(new AppError("Aap is job pe pehle hi apply kar chuke hain", 409));
    }
    return next(new AppError(insertError.message, 500));
  }

  res.status(201).json({
    success: true,
    message: "Application successfully submit ho gayi",
    data: application,
  });
});

// getMyApplications aur getApplicationsForJob functions waise hi rahenge, unmein koi change nahi
// ==========================================================
// 2. CANDIDATE APNI SAARI APPLICATIONS DEKHE
// GET /api/applications/my
// ==========================================================
export const getMyApplications = asyncHandler(async (req, res, next) => {
  // candidate_id hamesha token se aayega, params/query se nahi
  // Supabase ka nested select — jobs(title, location, job_type) — join jaisa kaam karta hai
  // Isse candidate ko sirf apni application ke sath job ka context bhi mil jayega
  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, job_id, resume_url, cover_letter, status, created_at, jobs(title, location, job_type)"
    )
    .eq("candidate_id", req.user.id)
    .order("created_at", { ascending: false }); // sabse nayi application sabse upar

  if (error) {
    return next(new AppError(error.message, 500));
  }

  res.status(200).json({
    success: true,
    count: data.length,
    data,
  });
});

// ==========================================================
// 3. EMPLOYER APNI JOB KI APPLICATIONS DEKHE
// GET /api/applications/job/:jobId
// ==========================================================
export const getApplicationsForJob = asyncHandler(async (req, res, next) => {
  const { jobId } = req.params;

  // Pehle job dhoondo — sirf id aur employer_id chahiye ownership check ke liye
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, employer_id")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    return next(new AppError("Job nahi mila", 404));
  }

  // Ownership check — Day 5 wala hi pattern
  // Employer sirf apni khud ki job ki applications dekh sakta hai, kisi aur ki nahi
  if (job.employer_id !== req.user.id) {
    return next(new AppError("Aap sirf apni job ki applications dekh sakte hain", 403));
  }

  // Applications nikalo, aur nested select se candidate ka naam/email bhi sath le aao
  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, candidate_id, resume_url, cover_letter, status, created_at, users(name, email)"
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) {
    return next(new AppError(error.message, 500));
  }

  res.status(200).json({
    success: true,
    count: data.length,
    data,
  });
});

// src/controllers/applicationController.js mein add karo

// ==========================================================
// 4. EMPLOYER APPLICATION KA STATUS UPDATE KARE (accept/reject)
// PATCH /api/applications/:id/status
// ==========================================================
export const updateApplicationStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params; // application ki id
  const { status } = req.body; // Zod schema route mein validate kar chuka hoga

  // Pehle application dhoondo, sath uski job bhi le aao (ownership check ke liye)
  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select("id, job_id, jobs(employer_id)")
    .eq("id", id)
    .single();

  if (fetchError || !application) {
    return next(new AppError("Application nahi mili", 404));
  }

  // Ownership check — sirf wahi employer status change kar sakta hai jiski job hai
  if (application.jobs.employer_id !== req.user.id) {
    return next(new AppError("Aap sirf apni job ki applications ka status change kar sakte hain", 403));
  }

  const { data: updated, error: updateError } = await supabase
    .from("applications")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    return next(new AppError(updateError.message, 500));
  }

  res.status(200).json({
    success: true,
    message: "Application status update ho gaya",
    data: updated,
  });
});
