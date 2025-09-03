#!/bin/bash

# Deploy LinguaPulse Onboarding Lambda Function
# Usage: ./deploy.sh [supabase_url] [supabase_key]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying LinguaPulse Onboarding Lambda...${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo -e "${RED}❌ AWS SAM CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Get parameters
SUPABASE_URL=${1:-""}
SUPABASE_KEY=${2:-""}
TELEGRAM_TOKEN="8079926642:AAF-sO6ss9l7kby2t3m0iX5TtKJ9HKbxA3Q"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
    echo -e "${YELLOW}⚠️  Please provide Supabase URL and key:${NC}"
    echo "Usage: ./deploy.sh <supabase_url> <supabase_key>"
    echo ""
    echo "To get Supabase credentials:"
    echo "1. Go to https://supabase.com/dashboard"
    echo "2. Select your project"
    echo "3. Go to Settings > API"
    echo "4. Copy Project URL and anon/public key"
    exit 1
fi

echo -e "${GREEN}📦 Building Lambda package...${NC}"

# Build the package
sam build --template-file template.yaml

echo -e "${GREEN}🚀 Deploying to AWS...${NC}"

# Deploy with parameters
sam deploy \
    --template-file .aws-sam/build/template.yaml \
    --stack-name linguapulse-onboarding \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        SupabaseUrl="$SUPABASE_URL" \
        SupabaseAnonKey="$SUPABASE_KEY" \
        TelegramBotToken="$TELEGRAM_TOKEN" \
    --region us-east-1

echo -e "${GREEN}✅ Deployment completed!${NC}"

# Get the API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name linguapulse-onboarding \
    --query 'Stacks[0].Outputs[?OutputKey==`OnboardingApi`].OutputValue' \
    --output text \
    --region us-east-1)

echo -e "${GREEN}🌐 API Endpoint: ${API_ENDPOINT}${NC}"
echo -e "${YELLOW}📝 Add this endpoint to your Cloudflare webhook configuration${NC}"
