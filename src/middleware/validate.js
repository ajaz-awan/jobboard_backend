// src/middleware/validate.js
import AppError from "../utils/AppError.js";

// source parameter — "body" (default) ya "query" — batata hai kis part ko validate karna hai
const validate = (schema, source = "body") => (req, res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    const formattedErrors = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));

    const error = new AppError("Validation failed", 400);
    error.errors = formattedErrors;
    return next(error);
  }

  req[source] = result.data;
  next();
};

export default validate;