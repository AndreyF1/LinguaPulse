"""Lambda функция для АУДИО ДИАЛОГОВ - изолированная логика"""
import sys
import os
import json

# Добавляем путь к shared модулям
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'shared'))

from openai_client import get_openai_response
from utils import success_response, error_response, parse_request_body, validate_required_fields


def lambda_handler(event, context):
    """Обработчик Lambda для аудио диалогов"""
    print(f"🎤 Audio Dialog Lambda called")
    
    try:
        body = parse_request_body(event)
        
        validation_error = validate_required_fields(body, ['action'])
        if validation_error:
            return error_response(validation_error)
        
        action = body['action']
        
        if action == 'generate_greeting':
            return handle_generate_greeting(body)
        elif action == 'generate_feedback':
            return handle_generate_feedback(body)
        else:
            return error_response(f'Unknown action: {action}')
            
    except Exception as e:
        print(f"❌ Audio Dialog Lambda error: {e}")
        return error_response(f'Internal error: {str(e)}', 500)


def handle_generate_greeting(body):
    """Генерация приветственного сообщения для аудио диалога"""
    validation_error = validate_required_fields(body, ['user_id'])
    if validation_error:
        return error_response(validation_error)
    
    user_id = body['user_id']
    user_level = body.get('user_level', 'Intermediate')
    
    print(f"🎤 Generating audio greeting for user {user_id}, level: {user_level}")
    
    # Системный промпт для приветствия
    greeting_prompt = f"""You are an English conversation tutor. Generate a friendly greeting to start an audio conversation practice session with topic suggestions.

User's English level: {user_level}

Requirements:
- Start with a warm, encouraging greeting
- Adapt language complexity to the user's level
- Offer 3-4 conversation topic suggestions (like: travel, hobbies, daily routine, food, etc.)
- Ask the user to choose a topic or suggest their own
- Keep it under 80 words total
- Be enthusiastic and supportive

Example structure: "Hello! I'm excited to practice English with you today! Let's have a great conversation. I can suggest a few topics: [topic 1], [topic 2], [topic 3], or [topic 4]. Which one sounds interesting to you, or would you prefer to talk about something else?"

Generate ONLY the greeting text with topic suggestions, nothing else."""
    
    # Получаем приветствие от OpenAI
    result = get_openai_response("Generate audio greeting", greeting_prompt)
    
    if result['success']:
        print(f"✅ Audio greeting generated for user {user_id}")
        return success_response({
            'reply': result['reply']
        })
    else:
        print(f"❌ Audio greeting failed: {result['error']}")
        return error_response(f"Greeting generation error: {result['error']}")


def handle_generate_feedback(body):
    """Генерация финального фидбэка для аудио диалога"""
    validation_error = validate_required_fields(body, ['user_id'])
    if validation_error:
        return error_response(validation_error)
    
    user_id = body['user_id']
    user_lang = body.get('user_lang', 'ru')
    
    print(f"📊 Generating audio dialog feedback for user {user_id}")
    
    # Системный промпт для фидбэка
    if user_lang == 'en':
        feedback_prompt = """Generate a brief final feedback for an AUDIO-BASED English conversation practice session. Write in English.

IMPORTANT: This was an AUDIO conversation - focus on speaking, pronunciation, and verbal communication skills.

Structure:
🎤 Great work!

Thank you for an interesting audio dialogue! [brief praise]

🗣️ Main observations:
- [1-2 most critical observations about SPEAKING/PRONUNCIATION/FLUENCY, if any, or positive observations]

📊 Your results:
- Speech: [score]/100
- Vocabulary: [score]/100  
- Grammar: [score]/100

💡 [Encouraging closing message about SPOKEN English skills]

Keep it concise (max 150 words) and encouraging. Give realistic scores 70-95. Focus only on audio-based skills."""
    else:
        feedback_prompt = """Generate a brief final feedback for an AUDIO-BASED English conversation practice session. Write in Russian.

IMPORTANT: This was an AUDIO conversation - focus on speaking, pronunciation, and verbal communication skills.

Structure:
🎤 Отличная работа!

Спасибо за интересный аудио-диалог! [brief praise]

🗣️ Основные наблюдения:
- [1-2 most critical observations about SPEAKING/PRONUNCIATION/FLUENCY, if any, or positive observations]

📊 Ваши результаты:
- Речь: [score]/100
- Словарный запас: [score]/100  
- Грамматика: [score]/100

💡 [Encouraging closing message about SPOKEN English skills]

Keep it concise (max 150 words) and encouraging. Give realistic scores 70-95. Focus only on audio-based skills."""
    
    # Получаем фидбэк от OpenAI
    result = get_openai_response("Generate feedback for completed audio dialog", feedback_prompt)
    
    if result['success']:
        print(f"✅ Audio dialog feedback generated for user {user_id}")
        return success_response({
            'feedback': result['reply']
        })
    else:
        print(f"❌ Audio dialog feedback failed: {result['error']}")
        return error_response(f"Feedback generation error: {result['error']}")
