// src/routes/testRoutes.js
//
// Ye ek TEMPORARY route file hai — sirf Day 4 ke protect/authorize
// middleware ko test karne ke liye banayi hai. Jobs API (Day 5) ban
// jaane ke baad ye route delete kar sakte ho, ya chahen to rakh bhi
// sakte ho debugging ke liye.

import express from "express";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// TEST ROUTE 1: Sirf login hona chahiye (koi bhi role chalega)
// Ye check karega ke protect middleware sahi kaam kar raha hai
// ─────────────────────────────────────────────────────────────
router.get("/test-protect", protect, (req, res) => {
  // Agar yahan tak request pahunch gayi, matlab token valid tha
  // aur req.user set ho chuka hai
  res.json({
    message: "Protect middleware working! Token valid hai.",
    user: req.user, // { id, role } dikhega
  });
});

// ─────────────────────────────────────────────────────────────
// TEST ROUTE 2: Sirf "employer" role allowed hai
// Ye check karega ke authorize middleware role-based blocking
// sahi kar raha hai ya nahi
// ─────────────────────────────────────────────────────────────
router.get("/test-employer-only", protect, authorize("employer"), (req, res) => {
  res.json({
    message: "Authorize middleware working! Aap employer ho, isliye access mila.",
    user: req.user,
  });
});

// ─────────────────────────────────────────────────────────────
// TEST ROUTE 3: "employer" aur "admin" dono allowed hain
// Multiple roles ke case ko bhi test kar lete hain
// ─────────────────────────────────────────────────────────────
router.get("/test-employer-or-admin", protect, authorize("employer", "admin"), (req, res) => {
  res.json({
    message: "Aapka role employer ya admin hai, isliye access mila.",
    user: req.user,
  });
});

export default router;
