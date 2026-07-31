import jwt from "jsonwebtoken";

export const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },              // payload — token ke andar ye data chupa hoga
    process.env.JWT_SECRET,             // secret key jo sirf server ko pata hai
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};