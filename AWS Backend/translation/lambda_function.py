"""Lambda функция для ПЕРЕВОДОВ - изолированная логика"""
import sys
import os
import json

# Добавляем путь к shared модулям
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'shared'))

from openai_client import get_openai_response
from utils import success_response, error_response, parse_request_body, validate_required_fields


def lambda_handler(event, context):
    """Обработчик Lambda для переводов"""
    print(f"🔄 Translation Lambda called")
    
    try:
        body = parse_request_body(event)
        
        validation_error = validate_required_fields(body, ['action'])
        if validation_error:
            return error_response(validation_error)
        
        action = body['action']
        
        if action == 'translate':
            return handle_translate(body)
        else:
            return error_response(f'Unknown action: {action}')
            
    except Exception as e:
        print(f"❌ Translation Lambda error: {e}")
        return error_response(f'Internal error: {str(e)}', 500)


def handle_translate(body):
    """Обработка перевода текста"""
    validation_error = validate_required_fields(body, ['text'])
    if validation_error:
        return error_response(validation_error)
    
    text = body['text']
    target_language = body.get('target_language', 'Russian')
    
    print(f"🔄 Translating to {target_language}: {text[:50]}...")
    
    # Системный промпт для перевода
    system_prompt = f"""You are a professional translator. Translate the given text to {target_language}.

CRITICAL LANGUAGE RULE: ALWAYS answer in the SAME language the user used for their question.

Provide ONLY the translation, no explanations or additional text."""
    
    # Получаем перевод от OpenAI
    result = get_openai_response(text, system_prompt, max_tokens=500)
    
    if result['success']:
        print(f"✅ Translation successful")
        return success_response({
            'reply': result['reply']
        })
    else:
        print(f"❌ Translation failed: {result['error']}")
        return error_response(f"Translation error: {result['error']}")
