#!/usr/bin/env python3
"""
Test Lambda function with new user (no interface_language)
"""
import json
import os

# Set environment variables
os.environ['SUPABASE_URL'] = 'https://qpqwyvzpwwwyolnvtglw.supabase.co'
os.environ['SUPABASE_SERVICE_KEY'] = 'sb_secret_lghNzKHiDruF7qitrw873Q_PH788Qyy'
os.environ['TELEGRAM_BOT_TOKEN'] = '8079926642:AAF-sO6ss9l7kby2t3m0iX5TtKJ9HKbxA3Q'

# Import Lambda function
import sys
sys.path.append('aws-lambda/onboarding')
from lambda_function import lambda_handler

def test_lambda():
    """Test Lambda function with new user"""
    
    # Test event (simulating what Cloudflare sends)
    test_event = {
        "action": "start_onboarding",
        "user_id": 999999999,  # New user without interface_language
        "message": {
            "chat": {"id": 999999999},
            "from": {"username": "newuser"}
        }
    }
    
    print("Testing Lambda function with new user...")
    print(f"Event: {json.dumps(test_event, indent=2)}")
    
    try:
        result = lambda_handler(test_event, None)
        print(f"Result: {json.dumps(result, indent=2)}")
        return result
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    test_lambda()
