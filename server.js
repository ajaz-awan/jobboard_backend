// server.js
// Ye hamari app ka entry point hai — sab kuch yahin se start hota hai

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config(); // .env file ki values process.env mein load kar deta hai

// dotenv.config() ke BAAD import karna zaroori hai, warna env variables load nahi hongi
const { supabase } = await import("./src/config/supabaseClient.js");
const { default: authRoutes } = await import("./src/routes/authRoutes.js");
import testRoutes from "./src/routes/testRoutes.js";
import jobRoutes from "./src/routes/jobRoutes.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import applicationRoutes from "./src/routes/applicationRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";


const { errorHandler } = await import("./src/middleware/errorHandler.js");
const { asyncHandler } = await import("./src/utils/asyncHandler.js");

const app = express();
const PORT = process.env.PORT || 5000;

// ---------- MIDDLEWARE ----------

// CORS: frontend (Next.js, alag origin/port pe chalega) se requests allow karne ke liye
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000", // frontend ka URL
    credentials: true,
  })
);

// Express ka built-in middleware jo incoming JSON body ko parse karta hai (req.body)
app.use(express.json());

// ---------- TEST ROUTE ----------
// Yeh sirf check karne ke liye hai ke server chal raha hai ya nahi
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Job Board API is running 🚀",
  });
});

// ---------- TEST DB CONNECTION ROUTE ----------
// Ye route sirf check karne ke liye hai ke Supabase se connection ban raha hai ya nahi
app.get(
  "/api/test-db",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from("users").select("*").limit(5);

    if (error) throw error; // asyncHandler isse pakad kar errorHandler ko bhej dega

    res.json({
      success: true,
      message: "Supabase se connection ho gaya ✅",
      usersCount: data.length,
      users: data,
    });
  })
);

// ---------- ROUTES ----------
app.use("/api/auth", authRoutes);

app.use("/api/jobs", jobRoutes);

app.use("/api/applications", applicationRoutes);

app.use("/api/users", userRoutes);





app.use("/api", testRoutes);


app.use(helmet());
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes ka window
  max: 100, // is window mein max 100 requests per IP
  message: {
    success: false,
    message: "Bohot zyada requests aa gayi hain, thodi der baad try karein",
  },
  standardHeaders: true, // rate-limit info response headers mein bhejo (RateLimit-*)
  legacyHeaders: false, // purane X-RateLimit-* headers band karo (naye standard use karo)
});

// Sirf API routes pe lagao (agar koi static files serve karte ho to unpe na lage)
app.use("/api", limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // sirf 5 login attempts per 15 min per IP
  message: {
    success: false,
    message: "Bohot zyada login attempts, 15 minute baad try karein",
  },
});

app.use("/api/auth/login", authLimiter);

// ---------- ERROR HANDLING (hamesha sabse aakhir mein) ----------
// agar koi route match na ho
app.use(errorHandler); // har error yahan aakhir mein catch hogi

// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(`✅ Server chal raha hai: http://localhost:${PORT}`);
});