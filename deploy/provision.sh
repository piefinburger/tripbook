#!/usr/bin/env bash
# One-time AWS setup. Run locally with: AWS_PROFILE=personal bash deploy/provision.sh
set -euo pipefail
ACCT=416369639144
BUCKET=tripbook-media-$ACCT
REGION=us-east-1

echo "== S3 bucket =="
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null || true
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["https://tripbook.pfeif.us"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }]
}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "expire-db-backups",
    "Filter": { "Prefix": "backups/" },
    "Status": "Enabled",
    "Expiration": { "Days": 14 }
  }]
}'

echo "== IAM user =="
aws iam create-user --user-name tripbook-app 2>/dev/null || true
aws iam put-user-policy --user-name tripbook-app --policy-name tripbook-app \
  --policy-document file://deploy/iam-policy.json
echo "Create the access key (goes in .env on the server):"
aws iam create-access-key --user-name tripbook-app \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text

echo
echo "== SES checklist (manual, one time) =="
echo "1. aws sesv2 create-email-identity --email-identity pfeif.us"
echo "2. Add the 3 DKIM CNAME records it returns to pfeif.us DNS."
echo "3. If the account is still in the SES sandbox, request production access"
echo "   in the console (Account dashboard -> Request production access),"
echo "   or verify each family member's email as an identity."
