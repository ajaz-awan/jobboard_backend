// src/middleware/auth.js

import jwt from "jsonwebtoken";
import  AppError  from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ─────────────────────────────────────────────────────────────
// PROTECT MIDDLEWARE
// Kaam: Check karta hai ke request ke saath valid JWT token hai ya nahi.
// Agar valid hai to req.user set karke aage jaane deta hai (next()).
// Agar invalid/missing hai to 401 error throw karta hai.
// ─────────────────────────────────────────────────────────────

export const protect = asyncHandler(async (req, res, next) => {
  // Step 1: Header se token nikalna
  // Frontend ye format bhejega: "Authorization: Bearer eyJhbGciOi..."
  let token;

  const authHeader = req.headers.authorization;

  // Check: header exist karta hai aur "Bearer " se start hota hai
  if (authHeader && authHeader.startsWith("Bearer")) {
    // "Bearer xyz123" ko split karke sirf token (xyz123) nikalna
    token = authHeader.split(" ")[1];
  }

  // Step 2: Agar token mila hi nahi, matlab user login nahi hai
  if (!token) {
    // 401 = Unauthorized (authentication missing)
    throw new AppError("Not authorized, no token provided", 401);
  }

  // Step 3: Token verify karna
  // jwt.verify() token ko decode karta hai AUR check karta hai ke
  // ye humare hi JWT_SECRET se sign hua hai (tampered/fake nahi hai)
  //
  // Agar token invalid/expired hoga to jwt.verify() khud error throw
  // karega — asyncHandler wo error catch karke errorHandler tak
  // bhej dega, isliye humein manual try/catch nahi likhna pada.
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  // decoded ke andar wahi data hai jo generateToken.js mein
  // sign karte waqt daala tha: { id, role }

  // Step 4: req.user set karna
  // Ye important hai — is se aage wale controllers/middleware
  // (jaise authorize, ya job/application controllers) ko pata
  // chalega ke request kis user ne bheji hai aur uska role kya hai.
  req.user = {
    id: decoded.id,
    role: decoded.role,
  };

  // Step 5: Sab sahi hai, agle middleware/controller ko jaane do
  next();
});

// ─────────────────────────────────────────────────────────────
// AUTHORIZE MIDDLEWARE
// Kaam: Specific roles ko hi route access dena.
// Ye protect ke BAAD chalta hai, kyunki isse req.user chahiye hota hai.
//
// Usage example (routes mein):
//   router.post("/jobs", protect, authorize("employer"), createJob);
//   router.delete("/jobs/:id", protect, authorize("employer", "admin"), deleteJob);
//
// Note: authorize(...roles) ek "middleware factory" hai — ye khud
// middleware nahi hai, balke ek function return karta hai jo middleware
// hai. Isliye roles ko as argument pass karna possible hota hai.
// ─────────────────────────────────────────────────────────────

export const authorize = (...roles) => {
  // roles = array of allowed roles, e.g. ["employer", "admin"]

  return (req, res, next) => {
    // Step 1: req.user hona chahiye (protect middleware ne set kiya hoga)
    // Ye safety check hai — agar kabhi authorize bina protect ke use
    // ho jaye to clear error mile, silent bug nahi.
    if (!req.user) {
      throw new AppError("Not authorized, please login first", 401);
    }

    // Step 2: Check karo ke user ka role allowed roles mein hai ya nahi
    if (!roles.includes(req.user.role)) {
      // 403 = Forbidden (login to hai, lekin permission nahi hai)
      // 401 aur 403 mein farak: 401 = "tum ho kaun", 403 = "tumhe ijazat nahi"
      throw new AppError(
        `Role '${req.user.role}' is not allowed to access this resource`,
        403
      );
    }

    // Step 3: Role match ho gaya, aage jaane do
    next();
  };
};
