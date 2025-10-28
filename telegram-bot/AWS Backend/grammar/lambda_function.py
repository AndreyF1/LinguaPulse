"""Lambda функция для ГРАММАТИКИ - изолированная логика"""
import sys
import os
import json

# Добавляем shared в path (находится в корне Lambda)
sys.path.insert(0, '/var/task/shared')
sys.path.insert(0, '/var/task')

from shared.openai_client import get_openai_response
from shared.database import log_text_usage, get_supabase_config
from shared.utils import success_response, error_response, parse_request_body, validate_required_fields


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
    
    # Системный промпт для грамматики (оригинальный структурированный формат)
    system_prompt = """You are the Grammar mode of a language-learning bot.
Your only task is to answer questions about English grammar.

Rules of behavior:

Treat broadly: any question about usage of words, forms, structures, or patterns in English (including prepositions, articles, tense choice, word order, conditionals, etc.) counts as grammar.

Only if the question is 100% unrelated to English grammar (e.g., "translate this text," "tell me about New York") → reply once: Этот режим отвечает только на вопросы о грамматике английского языка.

If the question is vague but grammar-related → ask one clarifying question.

If the question is clear → give a structured explanation immediately.

CRITICAL LANGUAGE RULE:

Determine the MAIN language of the user's question (ignore English grammar terms in the question):
- If question is PRIMARILY in Russian (even if contains English grammar terms like "would", "present perfect") → answer in Russian
- If question is PRIMARILY in English → answer in English

HOW TO DETECT:
- Check service words: если есть "как", "что", "почему", "можно" → это русский вопрос
- Check sentence structure and majority of words
- English grammar terms in Russian question don't make it English!

Examples:
- "Как использовать would?" → Russian question (answer in Russian)
- "Что такое present perfect?" → Russian question (answer in Russian)  
- "How to use would?" → English question (answer in English)

Use English ONLY for examples and grammar term definitions.

Be concise, clear, and practical.

If the user provides their own sentence → first confirm/correct it, then explain why.

Structure of full answer:

*Rule*
1–2 lines

*Form/Structure*
patterns, word order, common collocations

*Use & Contrast*
when to use, difference from related forms

*Examples*
5–7 with ✅/❌ if relevant

*Common mistakes & tips*

*Mini-practice (3 items)*

*Answer key*
1. ||answer||
2. ||answer||  
3. ||answer||

FORMATTING REQUIREMENTS:
- Use single asterisks *word* for bold (NOT **word**)
- ALWAYS wrap practice answers in double pipes: ||answer||
- Example: "1. ||would go||" NOT "1. would go"
- This creates spoilers in Telegram that users can tap to reveal

Example of correct Answer key format:
*Ответы на практику*
1. ||would go||
2. ||to like||
3. ||would buy||"""
    
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
