import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const mode = process.env.ASSET_STORE || 'database';
let client;
function config() {
  if (mode !== 's3') throw new Error('S3 asset storage is not configured');
  const { S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET || !S3_REGION || Boolean(S3_ACCESS_KEY_ID) !== Boolean(S3_SECRET_ACCESS_KEY)) throw new Error('Missing or incomplete S3 asset storage configuration');
  if (process.env.NODE_ENV !== 'production' && (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)) throw new Error('Local S3 storage requires an explicit endpoint and credentials');
  return { bucket: S3_BUCKET, region: S3_REGION, endpoint: S3_ENDPOINT };
}
function s3() {
  if (!client) {
    const { region, endpoint } = config();
    client = new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle: true, ...(process.env.S3_ACCESS_KEY_ID ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } } : {}) });
  }
  return client;
}
export function assetStorageMode() { return mode; }
export function assetBucket() { return config().bucket; }
export async function checkObjectStore() {
  if (mode !== 's3') return true;
  await s3().send(new HeadBucketCommand({ Bucket: config().bucket }));
  return true;
}
export async function putObject(key, bytes, mediaType, bucket = assetBucket()) {
  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mediaType, CacheControl: 'private, max-age=31536000, immutable' }));
}
export async function getObject(key, bucket = assetBucket()) {
  const response = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await response.Body.transformToByteArray());
}
export async function headObject(key, bucket = assetBucket()) {
  return s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}
export async function deleteObject(key, bucket = assetBucket()) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
