"""Lambda функция для ГРАММАТИКИ - изолированная логика"""
import sys
import os
import json

# Добавляем путь к shared модулям
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'shared'))

from openai_client import get_openai_response
from database import log_text_usage, get_supabase_config
from utils import success_response, error_response, parse_request_body, validate_required_fields


def lambda_handler(event, context):
    """Обработчик Lambda для грамматики"""
    print(f"📝 Grammar Lambda called")
    
    try:
        body = parse_request_body(event)
        
        validation_error = validate_required_fields(body, ['action'])
        if validation_error:
            return error_response(validation_error)
        
        action = body['action']
        
        if action == 'check_grammar':
            return handle_grammar_check(body)
        else:
            return error_response(f'Unknown action: {action}')
            
    except Exception as e:
        print(f"❌ Grammar Lambda error: {e}")
        return error_response(f'Internal error: {str(e)}', 500)


def handle_grammar_check(body):
    """Обработка проверки грамматики"""
    validation_error = validate_required_fields(body, ['text', 'user_id'])
    if validation_error:
        return error_response(validation_error)
    
    text = body['text']
    user_id = body['user_id']
    
    print(f"📝 Checking grammar for user {user_id}: {text[:50]}...")
    
    # Системный промпт для грамматики
    system_prompt = """You are an English grammar tutor. Analyze the user's text and provide helpful corrections.

CRITICAL LANGUAGE RULE: ALWAYS answer in the SAME language the user used for their question.

Your response should:
1. Point out any grammar mistakes
2. Explain the corrections clearly
3. Provide the corrected version
4. Use ||spoiler|| tags for answers when appropriate

Be encouraging and educational in your feedback."""
    
    # Получаем ответ от OpenAI
    result = get_openai_response(text, system_prompt)
    
    if result['success']:
        print(f"✅ Grammar check successful for user {user_id}")
        
        # Логируем использование
        supabase_config = get_supabase_config()
        if supabase_config['url'] and supabase_config['key']:
            log_text_usage(user_id, supabase_config['url'], supabase_config['key'])
        
        return success_response({
            'reply': result['reply']
        })
    else:
        print(f"❌ Grammar check failed: {result['error']}")
        return error_response(f"Grammar check error: {result['error']}")
