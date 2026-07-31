// src/middleware/errorHandler.js
export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isDev = process.env.NODE_ENV !== "production";

  console.error("❌ Error:", err.message);

  res.status(statusCode).json({
    success: false,
    message: err.message || "Server mein kuch ghalat ho gaya",
    ...(err.errors && { errors: err.errors }), // Zod validation ke field-wise errors — sirf tab dikhenge jab validate.js middleware ne error.errors set kiya ho
    ...(isDev && { stack: err.stack }),
  });
};

export const notFound = (req, res, next) => {
  const error = new Error(`Route nahi mili: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};