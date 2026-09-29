import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
if (!S3_ENDPOINT || !S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error('Missing S3 test configuration');
const client = new S3Client({ endpoint: S3_ENDPOINT, region: S3_REGION, forcePathStyle: true, credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } });
try { await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET })); }
catch { await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET })); }
console.log(`Test bucket ${S3_BUCKET} is ready`);
