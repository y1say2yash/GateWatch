#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_URL="https://github.com/y1say2yash/GateWatch.git"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region)}}"
if [[ -z "$REGION" ]]; then
    echo "Set AWS_REGION or configure a default AWS CLI region first." >&2
    exit 1
fi
for command_name in aws git curl jq openssl tar; do
    command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 1; }
done
aws sts get-caller-identity --region "$REGION" >/dev/null
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"
EC2_INSTANCE_TYPE="${GATEWATCH_EC2_INSTANCE_TYPE:-}"
if [[ -n "$EC2_INSTANCE_TYPE" ]]; then
    ELIGIBLE_TYPE="$(aws ec2 describe-instance-types --instance-types "$EC2_INSTANCE_TYPE" --filters Name=free-tier-eligible,Values=true --query 'InstanceTypes[0].InstanceType' --output text --region "$REGION")"
    if [[ "$ELIGIBLE_TYPE" != "$EC2_INSTANCE_TYPE" ]]; then
        echo "$EC2_INSTANCE_TYPE is not eligible under this account's Free Tier restrictions." >&2
        exit 1
    fi
else
    for candidate in t3.micro t2.micro; do
        ELIGIBLE_TYPE="$(aws ec2 describe-instance-types --instance-types "$candidate" --filters Name=free-tier-eligible,Values=true --query 'InstanceTypes[0].InstanceType' --output text --region "$REGION")"
        if [[ "$ELIGIBLE_TYPE" == "$candidate" ]]; then
            EC2_INSTANCE_TYPE="$candidate"
            break
        fi
    done
    if [[ -z "$EC2_INSTANCE_TYPE" ]]; then
        echo "No supported Free Tier eligible x86 instance type was found in $REGION." >&2
        exit 1
    fi
fi
printf 'Using EC2 type %s (AWS marks it Free Tier eligible; account usage and plan limits still apply).\n' "$EC2_INSTANCE_TYPE"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
if [[ -z "$VPC_ID" || "$VPC_ID" == "None" ]]; then
    echo "The selected region must have a default VPC." >&2
    exit 1
fi

SUBNET_ROWS="$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true --query 'Subnets[*].[SubnetId,AvailabilityZone]' --output text --region "$REGION")"
mapfile -t SUBNET_IDS < <(awk '{print $1}' <<< "$SUBNET_ROWS" | sort -u)
AZ_COUNT="$(awk '{print $2}' <<< "$SUBNET_ROWS" | sort -u | wc -l | tr -d ' ' )"
if (( ${#SUBNET_IDS[@]} < 2 || AZ_COUNT < 2 )); then
    echo "RDS needs default subnets in at least two Availability Zones in $REGION." >&2
    exit 1
fi
CF_PREFIX_LIST_ID="$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text --region "$REGION")"
if [[ -z "$CF_PREFIX_LIST_ID" || "$CF_PREFIX_LIST_ID" == "None" ]]; then
    echo "Could not find the CloudFront origin-facing prefix list in $REGION." >&2
    exit 1
fi

read -r -p "GitHub OAuth Client ID: " GITHUB_CLIENT_ID
read -r -s -p "GitHub OAuth Client Secret: " GITHUB_CLIENT_SECRET
printf '\n'
if [[ -z "$GITHUB_CLIENT_ID" || -z "$GITHUB_CLIENT_SECRET" ]]; then
    echo "Both GitHub OAuth values are required." >&2
    exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
INSTANCE_ID=""
DISTRIBUTION_ID=""
RDS_ID=""
BUCKET_NAME=""
ALLOCATION_ID=""
PARAMETER_NAME=""
EC2_SG_ID=""
RDS_SG_ID=""
DB_SUBNET_GROUP=""
FUNCTION_NAME=""
OAC_NAME=""
on_error() {
    local line="$1"
    echo "Deployment stopped at line $line. AWS resources already created are not removed automatically." >&2
    printf 'Known resources: instance=%s rds=%s distribution=%s bucket=%s eip=%s parameter=%s\n' \
        "${INSTANCE_ID:-none}" "${RDS_ID:-none}" "${DISTRIBUTION_ID:-none}" \
        "${BUCKET_NAME:-none}" "${ALLOCATION_ID:-none}" "${PARAMETER_NAME:-none}" >&2
    printf 'Supporting resources: stack=%s role=%s profile=%s ec2-sg=%s rds-sg=%s db-subnet-group=%s cloudfront-function=%s oac=%s\n' \
        "${STACK_NAME:-none}" "${ROLE_NAME:-none}" "${PROFILE_NAME:-none}" \
        "${EC2_SG_ID:-none}" "${RDS_SG_ID:-none}" "${DB_SUBNET_GROUP:-none}" \
        "${FUNCTION_NAME:-none}" "${OAC_NAME:-none}" >&2
}
trap 'on_error $LINENO' ERR

if ! command -v npm >/dev/null || ! command -v node >/dev/null; then
    NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v22."))][0].version')"
    case "$(uname -m)" in
        x86_64) NODE_ARCH="x64" ;;
        aarch64|arm64) NODE_ARCH="arm64" ;;
        *) echo "Unsupported CloudShell architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz" -o "$WORK_DIR/node.tar.xz"
    tar -xJf "$WORK_DIR/node.tar.xz" -C "$WORK_DIR"
    export PATH="$WORK_DIR/node-$NODE_VERSION-linux-$NODE_ARCH/bin:$PATH"
fi

git clone --depth 1 "$REPOSITORY_URL" "$WORK_DIR/GateWatch"
cd "$WORK_DIR/GateWatch/frontend"
npm ci
npm run build

SUFFIX="$(date -u +%Y%m%d%H%M%S)-$RANDOM"
STACK_NAME="gatewatch-$SUFFIX"
ROLE_NAME="${STACK_NAME}-role"
PROFILE_NAME="${STACK_NAME}-profile"
EC2_SG_NAME="${STACK_NAME}-ec2"
RDS_SG_NAME="${STACK_NAME}-rds"
DB_SUBNET_GROUP="${STACK_NAME}-db-subnets"
PARAMETER_NAME="/gatewatch/$SUFFIX"
BUCKET_NAME="gatewatch-$ACCOUNT_ID-$SUFFIX"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
TEST_CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -hex 32)"
SECRET_JSON="$(jq -cn \
    --arg githubClientId "$GITHUB_CLIENT_ID" \
    --arg githubClientSecret "$GITHUB_CLIENT_SECRET" \
    --arg postgresPassword "$POSTGRES_PASSWORD" \
    --arg encryptionKey "$TEST_CREDENTIAL_ENCRYPTION_KEY" \
    '{GITHUB_CLIENT_ID:$githubClientId,GITHUB_CLIENT_SECRET:$githubClientSecret,POSTGRES_PASSWORD:$postgresPassword,TEST_CREDENTIAL_ENCRYPTION_KEY:$encryptionKey}')"
unset GITHUB_CLIENT_SECRET POSTGRES_PASSWORD TEST_CREDENTIAL_ENCRYPTION_KEY

aws ssm put-parameter --name "$PARAMETER_NAME" --type SecureString --value "$SECRET_JSON" --overwrite --region "$REGION" >/dev/null
unset SECRET_JSON

jq -n '{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"ec2.amazonaws.com"},Action:"sts:AssumeRole"}]}' > "$WORK_DIR/trust.json"
aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "file://$WORK_DIR/trust.json" --region "$REGION" >/dev/null
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore --region "$REGION"
jq -n --arg arn "arn:aws:ssm:$REGION:$ACCOUNT_ID:parameter${PARAMETER_NAME}" '{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"ssm:GetParameter",Resource:$arn}]}' > "$WORK_DIR/parameter-policy.json"
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name ReadGateWatchSecrets --policy-document "file://$WORK_DIR/parameter-policy.json" --region "$REGION"
SSM_KEY_ARN="$(aws kms describe-key --key-id alias/aws/ssm --query KeyMetadata.Arn --output text --region "$REGION")"
jq -n --arg arn "$SSM_KEY_ARN" '{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"kms:Decrypt",Resource:$arn}]}' > "$WORK_DIR/kms-policy.json"
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name DecryptGateWatchSecrets --policy-document "file://$WORK_DIR/kms-policy.json" --region "$REGION"
aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" --region "$REGION" >/dev/null
aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" --region "$REGION"
for attempt in {1..30}; do
    if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" --region "$REGION" >/dev/null 2>&1; then break; fi
    sleep 2
done
aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" --region "$REGION" >/dev/null

aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" $(if [[ "$REGION" != "us-east-1" ]]; then printf '%s' "--create-bucket-configuration LocationConstraint=$REGION"; fi) >/dev/null
aws s3api put-public-access-block --bucket "$BUCKET_NAME" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --region "$REGION"
aws s3api put-bucket-encryption --bucket "$BUCKET_NAME" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' --region "$REGION"
aws s3 sync "$WORK_DIR/GateWatch/frontend/dist" "s3://$BUCKET_NAME" --delete --cache-control 'public,max-age=31536000,immutable' --region "$REGION"
aws s3 cp "$WORK_DIR/GateWatch/frontend/dist/index.html" "s3://$BUCKET_NAME/index.html" --cache-control 'no-cache,no-store,must-revalidate' --content-type 'text/html' --region "$REGION"

EC2_SG_ID="$(aws ec2 create-security-group --group-name "$EC2_SG_NAME" --description "GateWatch EC2 origin reachable only from CloudFront" --vpc-id "$VPC_ID" --query GroupId --output text --region "$REGION")"
RDS_SG_ID="$(aws ec2 create-security-group --group-name "$RDS_SG_NAME" --description "GateWatch RDS reachable only from EC2" --vpc-id "$VPC_ID" --query GroupId --output text --region "$REGION")"
jq -n --arg id "$CF_PREFIX_LIST_ID" '[{IpProtocol:"tcp",FromPort:80,ToPort:80,PrefixListIds:[{PrefixListId:$id}]}]' > "$WORK_DIR/ec2-ingress.json"
aws ec2 authorize-security-group-ingress --group-id "$EC2_SG_ID" --ip-permissions "file://$WORK_DIR/ec2-ingress.json" --region "$REGION"
aws ec2 authorize-security-group-ingress --group-id "$RDS_SG_ID" --protocol tcp --port 5432 --source-group "$EC2_SG_ID" --region "$REGION"
aws rds create-db-subnet-group --db-subnet-group-name "$DB_SUBNET_GROUP" --db-subnet-group-description "GateWatch private database subnets" --subnet-ids "${SUBNET_IDS[@]}" --region "$REGION" >/dev/null

DB_PASSWORD="$(aws ssm get-parameter --name "$PARAMETER_NAME" --with-decryption --query 'Parameter.Value' --output text --region "$REGION" | jq -r .POSTGRES_PASSWORD)"
RDS_ID="$STACK_NAME"
aws rds create-db-instance \
    --db-instance-identifier "$RDS_ID" \
    --engine postgres \
    --db-instance-class db.t3.micro \
    --allocated-storage 20 \
    --storage-type gp3 \
    --storage-encrypted \
    --db-name gatewatch \
    --master-username gatewatch \
    --master-user-password "$DB_PASSWORD" \
    --vpc-security-group-ids "$RDS_SG_ID" \
    --db-subnet-group-name "$DB_SUBNET_GROUP" \
    --no-publicly-accessible \
    --no-multi-az \
    --backup-retention-period 0 \
    --no-deletion-protection \
    --region "$REGION" >/dev/null
unset DB_PASSWORD
printf 'Waiting for RDS PostgreSQL to become available (this can take several minutes)...\n'
aws rds wait db-instance-available --db-instance-identifier "$RDS_ID" --region "$REGION"
RDS_ENDPOINT="$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].Endpoint.Address' --output text --region "$REGION")"

AMI_ID="$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text --region "$REGION")"
cat > "$WORK_DIR/user-data.sh" <<'USERDATA'
#!/bin/bash
set -Eeuo pipefail
exec > >(tee -a /var/log/gatewatch-bootstrap.log) 2>&1
REGION='__AWS_REGION__'
PARAMETER_NAME='__PARAMETER_NAME__'
REPOSITORY_URL='__REPOSITORY_URL__'
RDS_ENDPOINT='__RDS_ENDPOINT__'

if ! command -v aws >/dev/null 2>&1; then dnf install -y awscli-2; fi
dnf install -y docker git jq curl
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
systemctl enable --now docker
systemctl enable --now amazon-ssm-agent || true
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

database_ready=0
for attempt in {1..60}; do
    if timeout 3 bash -c "</dev/tcp/$RDS_ENDPOINT/5432" 2>/dev/null; then database_ready=1; break; fi
    sleep 10
done
if [[ "$database_ready" != 1 ]]; then echo "RDS PostgreSQL is not reachable from EC2"; exit 1; fi

git clone --depth 1 "$REPOSITORY_URL" /opt/gatewatch
cd /opt/gatewatch
SECRET_JSON=""
for attempt in {1..30}; do
    if SECRET_JSON="$(aws ssm get-parameter --name "$PARAMETER_NAME" --with-decryption --query Parameter.Value --output text --region "$REGION" 2>/dev/null)"; then break; fi
    sleep 10
done
if [[ -z "$SECRET_JSON" ]]; then echo "Could not read the deployment secret from SSM Parameter Store"; exit 1; fi
jq -r 'to_entries[] | "\(.key)=\(.value)"' <<< "$SECRET_JSON" > .env
unset SECRET_JSON
cat >> .env <<'ENV'
NODE_ENV=production
BACKEND_PORT=4000
POSTGRES_DB=gatewatch
POSTGRES_USER=gatewatch
POSTGRES_PORT=5432
REDIS_HOST=redis
REDIS_PORT=6379
ORDER_API_PORT=3001
PRODUCT_API_PORT=3002
USER_API_PORT=3003
GITHUB_REDIRECT_URI=https://pending.cloudfront.net/api/v1/auth/github/callback
TEST_LOCAL_ALLOWED_ORIGINS=
ENV
printf 'POSTGRES_HOST=%s\n' "$RDS_ENDPOINT" >> .env
chmod 600 .env

mkdir -p infrastructure/aws
cat > infrastructure/aws/nginx.conf <<'NGINX'
events {}
http {
    upstream backend { server gatewatch-backend:4000; }
    server {
        listen 80;
        location /api/ {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
        }
        location /p/ {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
        }
        location / { return 404; }
    }
}
NGINX

docker network create gatewatch >/dev/null
docker build -f infrastructure/aws/Dockerfile.backend-production -t gatewatch-backend:latest backend
docker build -f infrastructure/docker/demo-apis/order-api/Dockerfile -t gatewatch-order-api:latest services/order-api
docker build -f infrastructure/docker/demo-apis/product-api/Dockerfile -t gatewatch-product-api:latest services/product-api
docker build -f infrastructure/docker/demo-apis/user-api/Dockerfile -t gatewatch-user-api:latest services/user-api

docker run -d --name gatewatch-redis --restart unless-stopped --network gatewatch --network-alias redis redis:8-alpine
docker run -d --name gatewatch-order-api --restart unless-stopped --network gatewatch --network-alias order-api -e PORT=3001 gatewatch-order-api:latest sh -c 'npm run build && npm start'
docker run -d --name gatewatch-product-api --restart unless-stopped --network gatewatch --network-alias product-api -e PORT=3002 gatewatch-product-api:latest sh -c 'npm run build && npm start'
docker run -d --name gatewatch-user-api --restart unless-stopped --network gatewatch --network-alias user-api -e PORT=3003 gatewatch-user-api:latest sh -c 'npm run build && npm start'

migration_ok=0
for attempt in {1..30}; do
    if docker run --rm --network gatewatch --env-file /opt/gatewatch/.env -e NODE_ENV=development -v /opt/gatewatch/database:/database:ro gatewatch-backend:latest npm run db:migrate; then migration_ok=1; break; fi
    sleep 10
done
if [[ "$migration_ok" != 1 ]]; then echo "Database migrations failed; see /var/log/gatewatch-bootstrap.log"; exit 1; fi

docker run -d --name gatewatch-backend --restart unless-stopped --network gatewatch --network-alias gatewatch-backend --env-file /opt/gatewatch/.env gatewatch-backend:latest
docker run -d --name gatewatch-nginx --restart unless-stopped --network gatewatch -p 80:80 -v /opt/gatewatch/infrastructure/aws/nginx.conf:/etc/nginx/nginx.conf:ro nginx:alpine

healthy=0
for attempt in {1..60}; do
    if curl -fsS http://127.0.0.1/api/health >/dev/null; then healthy=1; break; fi
    sleep 10
done
if [[ "$healthy" != 1 ]]; then
    echo "GateWatch API did not become healthy; inspect docker logs and /var/log/gatewatch-bootstrap.log"
    exit 1
fi
USERDATA
sed -i \
    -e "s|__AWS_REGION__|$REGION|g" \
    -e "s|__PARAMETER_NAME__|$PARAMETER_NAME|g" \
    -e "s|__REPOSITORY_URL__|$REPOSITORY_URL|g" \
    -e "s|__RDS_ENDPOINT__|$RDS_ENDPOINT|g" \
    "$WORK_DIR/user-data.sh"

INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$EC2_INSTANCE_TYPE" \
    --iam-instance-profile "Name=$PROFILE_NAME" \
    --network-interfaces "AssociatePublicIpAddress=true,DeviceIndex=0,Groups=[$EC2_SG_ID],SubnetId=${SUBNET_IDS[0]}" \
    --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
    --user-data "file://$WORK_DIR/user-data.sh" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=GateWatch-$SUFFIX}]" \
    --query 'Instances[0].InstanceId' --output text --region "$REGION")"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
ALLOCATION_ID="$(aws ec2 allocate-address --domain vpc --query AllocationId --output text --region "$REGION")"
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOCATION_ID" --region "$REGION" >/dev/null
EC2_ORIGIN="$(aws ec2 describe-addresses --allocation-ids "$ALLOCATION_ID" --query 'Addresses[0].PublicDnsName' --output text --region "$REGION")"

OAC_NAME="${STACK_NAME}-oac"
OAC_ID="$(aws cloudfront create-origin-access-control --origin-access-control-config "Name=$OAC_NAME,Description=Private S3 access for GateWatch,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" --query OriginAccessControl.Id --output text)"
FUNCTION_NAME="${STACK_NAME}-spa"
cat > "$WORK_DIR/spa-function.js" <<'FUNCTION'
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    if (uri === '/' || uri.endsWith('/') || !lastSegment.includes('.')) {
        request.uri = '/index.html';
    }
    return request;
}
FUNCTION
jq -n '{Comment:"GateWatch SPA route fallback",Runtime:"cloudfront-js-2.0"}' > "$WORK_DIR/function-config.json"
aws cloudfront create-function --name "$FUNCTION_NAME" --function-config "file://$WORK_DIR/function-config.json" --function-code "fileb://$WORK_DIR/spa-function.js" >/dev/null
FUNCTION_ETAG="$(aws cloudfront describe-function --name "$FUNCTION_NAME" --query ETag --output text)"
aws cloudfront publish-function --name "$FUNCTION_NAME" --if-match "$FUNCTION_ETAG" >/dev/null
FUNCTION_ARN="$(aws cloudfront describe-function --name "$FUNCTION_NAME" --stage LIVE --query FunctionSummary.FunctionMetadata.FunctionARN --output text)"
if [[ -z "$FUNCTION_ARN" || "$FUNCTION_ARN" == "None" ]]; then
    echo "CloudFront did not return a published function ARN; stopping before distribution creation." >&2
    exit 1
fi

jq -n \
    --arg caller "$STACK_NAME" \
    --arg s3Origin "$BUCKET_NAME.s3.$REGION.amazonaws.com" \
    --arg ec2Origin "$EC2_ORIGIN" \
    --arg oac "$OAC_ID" \
    --arg functionArn "$FUNCTION_ARN" \
    '{CallerReference:$caller,Comment:"GateWatch: S3 frontend, EC2 backend, RDS PostgreSQL",Enabled:true,PriceClass:"PriceClass_100",DefaultRootObject:"index.html",Origins:{Quantity:2,Items:[{Id:"GateWatchS3",DomainName:$s3Origin,S3OriginConfig:{OriginAccessIdentity:""},OriginAccessControlId:$oac},{Id:"GateWatchEC2",DomainName:$ec2Origin,CustomOriginConfig:{HTTPPort:80,HTTPSPort:443,OriginProtocolPolicy:"http-only",OriginSslProtocols:{Quantity:1,Items:["TLSv1.2"]},OriginReadTimeout:60,OriginKeepaliveTimeout:5}}]},DefaultCacheBehavior:{TargetOriginId:"GateWatchS3",ViewerProtocolPolicy:"redirect-to-https",AllowedMethods:{Quantity:2,Items:["GET","HEAD"],CachedMethods:{Quantity:2,Items:["GET","HEAD"]}},CachePolicyId:"4135ea2d-6df8-44a3-9df3-4b5a84be39ad",Compress:true,FunctionAssociations:{Quantity:1,Items:[{EventType:"viewer-request",FunctionARN:$functionArn}]}},CacheBehaviors:{Quantity:2,Items:[{PathPattern:"/api/*",TargetOriginId:"GateWatchEC2",ViewerProtocolPolicy:"redirect-to-https",AllowedMethods:{Quantity:7,Items:["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],CachedMethods:{Quantity:2,Items:["GET","HEAD"]}},CachePolicyId:"4135ea2d-6df8-44a3-9df3-4b5a84be39ad",OriginRequestPolicyId:"b689b0a8-53d0-40ab-baf2-68738e2966ac",Compress:true},{PathPattern:"/p/*",TargetOriginId:"GateWatchEC2",ViewerProtocolPolicy:"redirect-to-https",AllowedMethods:{Quantity:7,Items:["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],CachedMethods:{Quantity:2,Items:["GET","HEAD"]}},CachePolicyId:"4135ea2d-6df8-44a3-9df3-4b5a84be39ad",OriginRequestPolicyId:"b689b0a8-53d0-40ab-baf2-68738e2966ac",Compress:true}]},ViewerCertificate:{CloudFrontDefaultCertificate:true,MinimumProtocolVersion:"TLSv1.2_2021"},Restrictions:{GeoRestriction:{RestrictionType:"none",Quantity:0}}}' > "$WORK_DIR/distribution.json"
DISTRIBUTION_ID="$(aws cloudfront create-distribution --distribution-config "file://$WORK_DIR/distribution.json" --query Distribution.Id --output text)"
aws cloudfront wait distribution-deployed --id "$DISTRIBUTION_ID"
DISTRIBUTION_DOMAIN="$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --query Distribution.DomainName --output text)"
CALLBACK_URL="https://$DISTRIBUTION_DOMAIN/api/v1/auth/github/callback"

aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy "$(jq -cn --arg bucket "$BUCKET_NAME" --arg distribution "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DISTRIBUTION_ID}" '{Version:"2012-10-17",Statement:[{Sid:"AllowCloudFrontRead",Effect:"Allow",Principal:{Service:"cloudfront.amazonaws.com"},Action:"s3:GetObject",Resource:("arn:aws:s3:::"+$bucket+"/*"),Condition:{StringEquals:{"AWS:SourceArn":$distribution}}}]}')" --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' >/dev/null

REMOTE_COMMAND="set -e; for attempt in \$(seq 1 60); do if curl -fsS http://127.0.0.1/api/health >/dev/null; then break; fi; sleep 10; done; sed -i 's|^GITHUB_REDIRECT_URI=.*|GITHUB_REDIRECT_URI=$CALLBACK_URL|' /opt/gatewatch/.env; docker stop gatewatch-backend; docker rm gatewatch-backend; docker run -d --name gatewatch-backend --restart unless-stopped --network gatewatch --network-alias gatewatch-backend --env-file /opt/gatewatch/.env gatewatch-backend:latest"
COMMAND_ID="$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --parameters "$(jq -cn --arg command "$REMOTE_COMMAND" '{commands:[$command]}')" --query Command.CommandId --output text --region "$REGION")"
COMMAND_STATUS=""
for attempt in {1..90}; do
    COMMAND_STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text --region "$REGION" 2>/dev/null || true)"
    [[ "$COMMAND_STATUS" == "Success" ]] && break
    [[ "$COMMAND_STATUS" == "Failed" || "$COMMAND_STATUS" == "TimedOut" || "$COMMAND_STATUS" == "Cancelled" ]] && break
    sleep 10
done
if [[ "$COMMAND_STATUS" != "Success" ]]; then
    aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query '{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}' --output json --region "$REGION" || true
    echo "Could not update the backend OAuth callback. Check the instance bootstrap log before proceeding." >&2
    exit 1
fi

printf '\nGateWatch deployment created.\n'
printf 'Frontend and API URL: https://%s\n' "$DISTRIBUTION_DOMAIN"
printf 'Set this GitHub OAuth callback URL in the OAuth App settings: %s\n' "$CALLBACK_URL"
printf 'AWS Region: %s\nS3 bucket: %s\nEC2 instance: %s\nRDS instance: %s\nCloudFront distribution: %s\nEIP allocation: %s\nSSM parameter: %s\n' \
    "$REGION" "$BUCKET_NAME" "$INSTANCE_ID" "$RDS_ID" "$DISTRIBUTION_ID" "$ALLOCATION_ID" "$PARAMETER_NAME"
printf 'EC2 has no SSH ingress; use Systems Manager Session Manager. This demo stack uses a single-AZ db.t3.micro RDS instance with backups disabled.\n'
