# API Gateway Custom Domains Setup

This document outlines the setup for custom domains for the API Gateway in both staging and production environments.

## Domain Configuration

The custom domains are configured per environment:

- **Production**: `api.scansafeguard.com`
- **Staging**: `staging-api.scansafeguard.com`

These are defined in `cdk.json` under the `apiDomainName` context key for each environment.

## Prerequisites

### 1. Route53 Hosted Zone

A Route53 hosted zone for `scansafeguard.com` must exist. This is created by the `SsgZoneStack`.

### 2. ACM Certificates

SSL/TLS certificates must be created in AWS Certificate Manager (ACM) for the custom domains:

#### Create Certificates

**For Production (`api.scansafeguard.com`):**
```bash
aws acm request-certificate \
  --domain-name api.scansafeguard.com \
  --validation-method DNS \
  --region us-east-1 \
  --profile production
```

**For Staging (`staging-api.scansafeguard.com`):**
```bash
aws acm request-certificate \
  --domain-name staging-api.scansafeguard.com \
  --validation-method DNS \
  --region us-east-1 \
  --profile staging
```

#### Validate Certificates

After creating the certificates, you must validate them by adding the CNAME records to your Route53 hosted zone:

1. Get the validation CNAME records:
   ```bash
   aws acm describe-certificate \
     --certificate-arn <certificate-arn> \
     --region us-east-1
   ```

2. Add the CNAME records to Route53 (or wait for auto-validation if using Route53)

3. Wait for certificate status to change to "ISSUED"

### 3. Update Environment Variables

The certificate ARN must be set as an environment variable when deploying:

```bash
export CERTIFICATE_ARN=<your-certificate-arn>
export ZONE_NAME=scansafeguard.com
```

## DNS Records

The CDK stack automatically creates an A record alias pointing to the API Gateway custom domain:

- **Production**: `api.scansafeguard.com` → API Gateway regional domain
- **Staging**: `staging-api.scansafeguard.com` → API Gateway regional domain

### Manual DNS Verification

After deployment, verify the DNS records:

```bash
# Check production
dig api.scansafeguard.com

# Check staging
dig staging-api.scansafeguard.com
```

## Deployment

### Deploy with Custom Domain (Staging)

```bash
cd ../ssg-cdk
export ENVIRONMENT=preprod
export CERTIFICATE_ARN=arn:aws:acm:us-east-1:<staging-account>:certificate/<cert-id>
export ZONE_NAME=scansafeguard.com
npx cdk deploy --context env=preprod
```

### Deploy with Custom Domain (Production)

```bash
cd ../ssg-cdk
export ENVIRONMENT=prod
export CERTIFICATE_ARN=arn:aws:acm:us-east-1:<production-account>:certificate/<cert-id>
export ZONE_NAME=scansafeguard.com
npx cdk deploy --context env=prod
```

## Application Configuration

### Next.js Environment Variables

Update your Vercel environment variables for each environment:

**Production:**
```
SERVER_API_URL=https://api.scansafeguard.com
```

**Staging/Preview:**
```
SERVER_API_URL=https://staging-api.scansafeguard.com
```

### SSM Parameters

The API Gateway URLs are automatically stored in SSM Parameter Store:

- `/ssg/production/api-gateway/url` → `https://api.scansafeguard.com`
- `/ssg/staging/api-gateway/url` → `https://staging-api.scansafeguard.com`

These parameters are updated automatically by the CDK stack when the API Gateway is deployed.

## Testing

### Test API Endpoints

```bash
# Test staging
curl https://staging-api.scansafeguard.com/api/health

# Test production
curl https://api.scansafeguard.com/api/health
```

### Verify SSL Certificate

```bash
# Check staging certificate
openssl s_client -connect staging-api.scansafeguard.com:443 -servername staging-api.scansafeguard.com

# Check production certificate
openssl s_client -connect api.scansafeguard.com:443 -servername api.scansafeguard.com
```

## Troubleshooting

### Certificate Not Found

If you see errors about certificate not found:

1. Ensure the certificate is in the `us-east-1` region
2. Verify the certificate status is "ISSUED" (not "PENDING_VALIDATION")
3. Check that the `CERTIFICATE_ARN` environment variable is set correctly

### DNS Not Resolving

If DNS lookups fail:

1. Check that the Route53 hosted zone exists: `aws route53 list-hosted-zones`
2. Verify the A record was created: `aws route53 list-resource-record-sets --hosted-zone-id <zone-id>`
3. Allow time for DNS propagation (up to 48 hours, typically much faster)

### API Gateway 403 Errors

If you receive 403 errors:

1. Check that the API Gateway authorizer is configured correctly
2. Verify the Authorization header is being passed
3. Check CloudWatch logs for the authorizer Lambda function

## Architecture

```
┌─────────────────┐
│   Client        │
│  (Next.js App)  │
└────────┬────────┘
         │
         │ HTTPS
         │
         ▼
┌──────────────────────────────┐
│  Route53                     │
│  api.scansafeguard.com       │
│  (A Record Alias)            │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│  API Gateway Custom Domain   │
│  (ACM Certificate)           │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│  API Gateway HTTP API        │
│  (Lambda Integration)        │
└──────────────────────────────┘
```

## References

- [API Gateway Custom Domain Names](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html)
- [ACM Certificate Validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html)
- [Route53 Alias Records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html)
