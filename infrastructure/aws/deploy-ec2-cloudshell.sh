#!/usr/bin/env bash
set -Eeuo pipefail

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region)}}"
REPOSITORY_URL="https://github.com/y1say2yash/GateWatch.git"
if [[ -z "$REGION" ]]; then
    echo "Set AWS_REGION or configure a default AWS CLI region first." >&2
    exit 1
fi
for command_name in aws jq openssl; do
    command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 1; }
done
aws sts get-caller-identity --region "$REGION" >/dev/null
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"

EC2_INSTANCE_TYPE=""
for candidate in t3.micro t2.micro; do
    eligible="$(aws ec2 describe-instance-types --instance-types "$candidate" --filters Name=free-tier-eligible,Values=true --query 'InstanceTypes[0].InstanceType' --output text --region "$REGION")"
    if [[ "$eligible" == "$candidate" ]]; then EC2_INSTANCE_TYPE="$candidate"; break; fi
done
if [[ -z "$EC2_INSTANCE_TYPE" ]]; then
    echo "No supported Free Tier eligible micro instance type was found in $REGION." >&2
    exit 1
fi

VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
if [[ -z "$VPC_ID" || "$VPC_ID" == "None" ]]; then
    echo "No default VPC found in $REGION." >&2
    exit 1
fi
DNS_SUPPORT="$(aws ec2 describe-vpc-attribute --vpc-id "$VPC_ID" --attribute enableDnsSupport --query 'EnableDnsSupport.Value' --output text --region "$REGION")"
if [[ "$DNS_SUPPORT" != "True" && "$DNS_SUPPORT" != "true" ]]; then
    aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support Value=true --region "$REGION"
fi
DNS_HOSTNAMES="$(aws ec2 describe-vpc-attribute --vpc-id "$VPC_ID" --attribute enableDnsHostnames --query 'EnableDnsHostnames.Value' --output text --region "$REGION")"
if [[ "$DNS_HOSTNAMES" != "True" && "$DNS_HOSTNAMES" != "true" ]]; then
    aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames Value=true --region "$REGION"
fi
SUBNET_ID="$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true --query 'Subnets[0].SubnetId' --output text --region "$REGION")"
CF_PREFIX_LIST_ID="$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text --region "$REGION")"
if [[ -z "$SUBNET_ID" || "$SUBNET_ID" == "None" || -z "$CF_PREFIX_LIST_ID" || "$CF_PREFIX_LIST_ID" == "None" ]]; then
    echo "Could not find a default subnet or the CloudFront origin prefix list in $REGION." >&2
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
ALLOCATION_ID=""
BUCKET_NAME="(none: this EC2-only deployment creates no S3 bucket)"
PARAMETER_NAME=""
SECURITY_GROUP_ID=""
ROLE_NAME=""
PROFILE_NAME=""
FUNCTION_NAME="(none: CloudFront function not used)"
OAC_NAME="(none: S3 origin access control not used)"
on_error() {
    local line="$1"
    echo "Stopped at line $line. Resources are not deleted automatically." >&2
    printf 'Region=%s instance=%s distribution=%s eip=%s security-group=%s role=%s profile=%s parameter=%s\n' \
        "$REGION" "${INSTANCE_ID:-none}" "${DISTRIBUTION_ID:-none}" "${ALLOCATION_ID:-none}" \
        "${SECURITY_GROUP_ID:-none}" "${ROLE_NAME:-none}" "${PROFILE_NAME:-none}" "${PARAMETER_NAME:-none}" >&2
}
trap 'on_error $LINENO' ERR

SUFFIX="$(date -u +%Y%m%d%H%M%S)-$RANDOM"
STACK_NAME="gatewatch-$SUFFIX"
ROLE_NAME="${STACK_NAME}-role"
PROFILE_NAME="${STACK_NAME}-profile"
SECURITY_GROUP_NAME="${STACK_NAME}-web"
PARAMETER_NAME="/gatewatch/$SUFFIX"
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
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name ReadGateWatchDeploymentConfig --policy-document "file://$WORK_DIR/parameter-policy.json" --region "$REGION"
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

SECURITY_GROUP_ID="$(aws ec2 create-security-group --group-name "$SECURITY_GROUP_NAME" --description "GateWatch EC2 origin, CloudFront ingress only" --vpc-id "$VPC_ID" --query GroupId --output text --region "$REGION")"
jq -n --arg id "$CF_PREFIX_LIST_ID" '[{IpProtocol:"tcp",FromPort:80,ToPort:80,PrefixListIds:[{PrefixListId:$id}]}]' > "$WORK_DIR/ingress.json"
aws ec2 authorize-security-group-ingress --group-id "$SECURITY_GROUP_ID" --ip-permissions "file://$WORK_DIR/ingress.json" --region "$REGION"
AMI_ID="$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text --region "$REGION")"

cat > "$WORK_DIR/user-data.sh" <<'USERDATA'
#!/bin/bash
set -Eeuo pipefail
exec > >(tee -a /var/log/gatewatch-bootstrap.log) 2>&1
REGION='__AWS_REGION__'
PARAMETER_NAME='__PARAMETER_NAME__'
REPOSITORY_URL='__REPOSITORY_URL__'

if ! command -v aws >/dev/null 2>&1; then dnf install -y awscli-2; fi
# Amazon Linux 2023 already supplies curl-minimal; installing curl conflicts with it.
dnf install -y docker git jq
fallocate -l 2G /swapfile || true
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
systemctl enable --now docker
systemctl enable --now amazon-ssm-agent || true
mkdir -p /usr/local/bin
curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
 mkdir -p /usr/local/lib/docker/cli-plugins
 case "$(uname -m)" in
     x86_64) BUILDX_ARCH=amd64 ;;
     aarch64|arm64) BUILDX_ARCH=arm64 ;;
     *) echo "Unsupported EC2 architecture: $(uname -m)"; exit 1 ;;
 esac
 BUILDX_VERSION="$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | jq -r .tag_name)"
 curl -fsSL "https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${BUILDX_ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-buildx
 chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
 docker buildx version

git clone --depth 1 "$REPOSITORY_URL" /opt/gatewatch
cd /opt/gatewatch
SECRET_JSON=""
for attempt in {1..30}; do
    if SECRET_JSON="$(aws ssm get-parameter --name "$PARAMETER_NAME" --with-decryption --query Parameter.Value --output text --region "$REGION" 2>/dev/null)"; then break; fi
    sleep 10
done
if [[ -z "$SECRET_JSON" ]]; then echo "Could not retrieve GateWatch secrets from SSM"; exit 1; fi
jq -r 'to_entries[] | "\(.key)=\(.value)"' <<< "$SECRET_JSON" > .env
unset SECRET_JSON
cat >> .env <<'ENV'
NODE_ENV=production
BACKEND_PORT=4000
POSTGRES_HOST=postgres
POSTGRES_DB=gatewatch
POSTGRES_USER=gatewatch
POSTGRES_PORT=5432
REDIS_HOST=redis
REDIS_PORT=6379
ORDER_API_PORT=3001
PRODUCT_API_PORT=3002
USER_API_PORT=3003
GITHUB_REDIRECT_URI=https://pending.cloudfront.net/api/v1/auth/github/callback
TEST_LOCAL_ALLOWED_ORIGINS=http://product-api:3002,http://order-api:3001,http://user-api:3003
ENV
chmod 600 .env

COMPOSE_PARALLEL_LIMIT=1 docker-compose build
docker-compose up -d
migration_ok=0
for attempt in {1..30}; do
    if docker-compose exec -T -e NODE_ENV=development backend npm run db:migrate; then migration_ok=1; break; fi
    sleep 10
done
if [[ "$migration_ok" != 1 ]]; then echo "Database migrations failed"; exit 1; fi

healthy=0
for attempt in {1..90}; do
    if curl -fsS http://127.0.0.1/api/health >/dev/null; then healthy=1; break; fi
    sleep 10
done
if [[ "$healthy" != 1 ]]; then
    echo "GateWatch did not become healthy; inspect docker-compose logs and /var/log/gatewatch-bootstrap.log"
    exit 1
fi
USERDATA
sed -i \
    -e "s|__AWS_REGION__|$REGION|g" \
    -e "s|__PARAMETER_NAME__|$PARAMETER_NAME|g" \
    -e "s|__REPOSITORY_URL__|$REPOSITORY_URL|g" \
    "$WORK_DIR/user-data.sh"

INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$EC2_INSTANCE_TYPE" \
    --iam-instance-profile "Name=$PROFILE_NAME" \
    --network-interfaces "AssociatePublicIpAddress=true,DeviceIndex=0,Groups=[$SECURITY_GROUP_ID],SubnetId=$SUBNET_ID" \
    --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
    --user-data "file://$WORK_DIR/user-data.sh" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=GateWatch-$SUFFIX}]" \
    --query 'Instances[0].InstanceId' --output text --region "$REGION")"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

ALLOCATION_ID="$(aws ec2 allocate-address --domain vpc --query AllocationId --output text --region "$REGION")"
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOCATION_ID" --region "$REGION" >/dev/null
NETWORK_INTERFACE_ID="$(aws ec2 describe-addresses --allocation-ids "$ALLOCATION_ID" --query 'Addresses[0].NetworkInterfaceId' --output text --region "$REGION")"
if [[ -z "$NETWORK_INTERFACE_ID" || "$NETWORK_INTERFACE_ID" == "None" ]]; then
    echo "AWS did not associate the Elastic IP with the EC2 network interface." >&2
    exit 1
fi
aws ec2 modify-public-ip-dns-name-options --network-interface-id "$NETWORK_INTERFACE_ID" --hostname-type public-ipv4-dns-name --region "$REGION" >/dev/null
EC2_ORIGIN=""
for attempt in {1..15}; do
    EC2_ORIGIN="$(aws ec2 describe-network-interfaces --network-interface-ids "$NETWORK_INTERFACE_ID" --query 'NetworkInterfaces[0].PublicIpDnsNameOptions.PublicIpv4DnsName' --output text --region "$REGION")"
    if [[ -z "$EC2_ORIGIN" || "$EC2_ORIGIN" == "None" ]]; then
        EC2_ORIGIN="$(aws ec2 describe-network-interfaces --network-interface-ids "$NETWORK_INTERFACE_ID" --query 'NetworkInterfaces[0].Association.PublicDnsName' --output text --region "$REGION")"
    fi
    if [[ "$EC2_ORIGIN" =~ ^[[:alnum:]-]+(\.[[:alnum:]-]+)+$ ]]; then break; fi
    sleep 2
done
if [[ ! "$EC2_ORIGIN" =~ ^[[:alnum:]-]+(\.[[:alnum:]-]+)+$ ]]; then
    echo "EC2 did not receive a public IPv4 DNS hostname; refusing to create CloudFront." >&2
    exit 1
fi

jq -n \
    --arg caller "$STACK_NAME" \
    --arg origin "$EC2_ORIGIN" \
    '{CallerReference:$caller,Comment:"GateWatch EC2 Compose deployment",Enabled:true,PriceClass:"PriceClass_100",Origins:{Quantity:1,Items:[{Id:"GateWatchEC2",DomainName:$origin,CustomOriginConfig:{HTTPPort:80,HTTPSPort:443,OriginProtocolPolicy:"http-only",OriginSslProtocols:{Quantity:1,Items:["TLSv1.2"]},OriginReadTimeout:60,OriginKeepaliveTimeout:5}}]},DefaultCacheBehavior:{TargetOriginId:"GateWatchEC2",ViewerProtocolPolicy:"redirect-to-https",AllowedMethods:{Quantity:7,Items:["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],CachedMethods:{Quantity:2,Items:["GET","HEAD"]}},CachePolicyId:"4135ea2d-6df8-44a3-9df3-4b5a84be39ad",OriginRequestPolicyId:"216adef6-5c7f-47e4-b989-5492eafa07d3",Compress:true},ViewerCertificate:{CloudFrontDefaultCertificate:true,MinimumProtocolVersion:"TLSv1.2_2021"},Restrictions:{GeoRestriction:{RestrictionType:"none",Quantity:0}}}' > "$WORK_DIR/distribution.json"
DISTRIBUTION_ID="$(aws cloudfront create-distribution --distribution-config "file://$WORK_DIR/distribution.json" --query Distribution.Id --output text)"
aws cloudfront wait distribution-deployed --id "$DISTRIBUTION_ID"
DISTRIBUTION_DOMAIN="$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --query Distribution.DomainName --output text)"
CALLBACK_URL="https://$DISTRIBUTION_DOMAIN/api/v1/auth/github/callback"
REMOTE_COMMAND="set -e; sed -i 's|^GITHUB_REDIRECT_URI=.*|GITHUB_REDIRECT_URI=$CALLBACK_URL|' /opt/gatewatch/.env; cd /opt/gatewatch; docker-compose up -d --force-recreate backend"
COMMAND_ID="$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --parameters "$(jq -cn --arg command "$REMOTE_COMMAND" '{commands:[$command]}')" --query Command.CommandId --output text --region "$REGION")"
COMMAND_STATUS=""
for attempt in {1..60}; do
    COMMAND_STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text --region "$REGION" 2>/dev/null || true)"
    [[ "$COMMAND_STATUS" == "Success" ]] && break
    [[ "$COMMAND_STATUS" == "Failed" || "$COMMAND_STATUS" == "TimedOut" || "$COMMAND_STATUS" == "Cancelled" ]] && break
    sleep 5
done
if [[ "$COMMAND_STATUS" != "Success" ]]; then
    aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query '{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}' --output json --region "$REGION" || true
    echo "Backend OAuth callback update failed." >&2
    exit 1
fi

printf '\nGateWatch single-EC2 Compose deployment created.\n'
printf 'App URL: https://%s\n' "$DISTRIBUTION_DOMAIN"
printf 'Update this GitHub OAuth callback URL: %s\n' "$CALLBACK_URL"
printf 'Instance: %s\nElastic IP allocation: %s\nCloudFront distribution: %s\nRegion: %s\n' \
    "$INSTANCE_ID" "$ALLOCATION_ID" "$DISTRIBUTION_ID" "$REGION"
printf 'This stack runs PostgreSQL and Redis on EC2; its Compose volume persists while the instance remains. CloudFront provides HTTPS for GitHub OAuth.\n'
