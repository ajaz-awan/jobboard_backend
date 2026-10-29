import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { env } from "../config/env.js";
import AppError from "../utils/AppError.js";
export const objectStore = { client: new S3Client({
  region: env.S3_REGION, ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}), forcePathStyle: env.S3_FORCE_PATH_STYLE,
  ...(env.S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } } : {}),
  maxAttempts: 2, requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, socketTimeout: 15000 }),
}) };
const input = (bucket, key) => ({ Bucket: env.S3_BUCKET, Key: [env.S3_KEY_PREFIX.replace(/^\/+|\/+$/g, ""), bucket, key].filter(Boolean).join("/") });
const send = async command => {
  try { return await objectStore.client.send(command, { abortSignal: AbortSignal.timeout(15000) }); }
  catch (error) {
    if (error.$metadata?.httpStatusCode === 412) throw new AppError("Object already exists", 409);
    if (error.name === "NoSuchKey" || (command instanceof GetObjectCommand && error.$metadata?.httpStatusCode === 404)) throw new AppError("File not found", 404);
    throw new AppError("Private storage is unavailable", 503);
  }
};
export const putObject = (bucket, key, file) => send(new PutObjectCommand({ ...input(bucket, key), Body: file.buffer, IfNoneMatch: "*", ContentType: file.mimetype, ContentLength: file.buffer.length }));
export const getObject = (bucket, key) => send(new GetObjectCommand(input(bucket, key)));
export const deleteObject = (bucket, key) => send(new DeleteObjectCommand(input(bucket, key)));
export const verifyObjectStorage = () => send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
