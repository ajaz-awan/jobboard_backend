import { env } from '../config/env.js';
export function createUploadCapacity(limit = env.UPLOAD_CONCURRENCY) {
  let active = 0;
  return (req, res, next) => {
    if (active >= limit) return res.set('Retry-After', '1').status(503).json({ success: false, message: 'Upload capacity reached. Retry shortly.', requestId: req.id });
    active += 1; let released = false;
    const release = () => { if (!released) { released = true; active -= 1; } };
    res.once('finish', release); res.once('close', release); next();
  };
}
export const uploadCapacity = createUploadCapacity();
