"""Lambda функция для ПЕРЕВОДОВ - изолированная логика"""
import sys
import os
import json

# Добавляем shared в path (находится в корне Lambda)
sys.path.insert(0, '/var/task/shared')
sys.path.insert(0, '/var/task')

from shared.openai_client import get_openai_response
from shared.utils import success_response, error_response, parse_request_body, validate_required_fields


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
    
    print(f"🔄 Translating text: {text[:50]}...")
    
    # Системный промпт для перевода
    system_prompt = """You are a professional translator specializing in Russian-English bidirectional translation.

TASK: Auto-detect the source language and translate:
- If text is in RUSSIAN → translate to ENGLISH
- If text is in ENGLISH → translate to RUSSIAN

RULES:
1. Provide ONLY the translation
2. NO explanations, NO additional text
3. Keep the same tone and style
4. Preserve formatting if any

Just output the translation, nothing else."""
    
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
