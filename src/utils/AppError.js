// src/utils/AppError.js
// Ye ek custom Error class hai jisme hum apna statusCode bhi daal sakte hain
// Normal "throw new Error('msg')" mein statusCode nahi hota, isliye ye extend kiya

class AppError extends Error {
  constructor(message, statusCode) {
    super(message); // parent Error class ko message pass kar diya
    this.statusCode = statusCode; // e.g. 400, 401, 404, 409
    this.isOperational = true; // batata hai ye ek "expected" error hai (jaise validation fail), crash nahi

    Error.captureStackTrace(this, this.constructor); // stack trace clean rakhta hai
  }
}

export default AppError;
