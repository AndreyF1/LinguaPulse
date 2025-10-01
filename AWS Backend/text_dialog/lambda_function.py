"""Lambda функция для ТЕКСТОВЫХ ДИАЛОГОВ - изолированная логика"""
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
    """Обработчик Lambda для текстовых диалогов"""
    print(f"💬 Text Dialog Lambda called")
    
    try:
        body = parse_request_body(event)
        
        validation_error = validate_required_fields(body, ['action'])
        if validation_error:
            return error_response(validation_error)
        
        action = body['action']
        
        if action == 'process_dialog':
            return handle_text_dialog(body)
        elif action == 'generate_dialog_feedback':
            return handle_generate_feedback(body)
        else:
            return error_response(f'Unknown action: {action}')
            
    except Exception as e:
        print(f"❌ Text Dialog Lambda error: {e}")
        return error_response(f'Internal error: {str(e)}', 500)


def handle_text_dialog(body):
    """Обработка текстового диалога"""
    validation_error = validate_required_fields(body, ['text', 'user_id'])
    if validation_error:
        return error_response(validation_error)
    
    text = body['text']
    user_id = body['user_id']
    dialog_count = body.get('dialog_count', 1)
    user_level = body.get('user_level', 'Intermediate')
    
    print(f"💬 Processing text dialog for user {user_id}, count: {dialog_count}")
    
    # Системный промпт для текстового диалога (оригинальный формат)
    system_prompt = f"""You are a friendly English conversation partner for structured dialog practice.

User's English level: {user_level}
Current message count: {dialog_count}/20

CORE RULES:
1. ALWAYS respond in English only
2. ALWAYS add Russian translation in spoiler: ||Русский перевод||
3. Maintain natural conversation flow - ask follow-up questions
4. Give brief grammar/vocabulary feedback on user's message before responding
5. Keep conversation engaging and educational

RESPONSE STRUCTURE:
*Feedback:* Brief comment on user's grammar/vocabulary (if needed)

---SPLIT---

[Your English response with natural flow]
||[Russian translation of your response]||

FEEDBACK GUIDELINES:
- If user makes grammar errors → gently suggest better version
- If user uses good vocabulary → praise it
- If user's message is perfect → mention what they did well
- Keep feedback encouraging and constructive

CONVERSATION FLOW:
- Ask follow-up questions to keep dialog going
- Show genuine interest in user's responses  
- Introduce new vocabulary naturally
- Vary topics: hobbies, travel, food, work, dreams, etc.

DIALOG ENDING:
- If user asks to end/finish/stop the conversation → immediately end the session
- Watch for phrases like: "let's wrap up", "I need to go", "finish", "stop", "end", "bye"
- When ending, use this EXACT format:

*Feedback:* [Brief final comment on their English]

---SPLIT---

Thank you so much for this wonderful conversation! You did great with your English practice. I hope we can chat again soon. Take care!

||Спасибо большое за этот замечательный разговор! У вас отлично получилось практиковать английский. Надеюсь, мы сможем поговорить снова. Берегите себя!||

---END_DIALOG---

Example response:
*Feedback:* Great use of past tense! Small tip: "I have been" is more natural than "I was been"

---SPLIT---

That sounds like an amazing trip! What was your favorite moment during the vacation? Did you try any local food that surprised you?

||Это звучит как потрясающая поездка! Какой момент больше всего запомнился во время отпуска? Пробовали ли вы местную еду, которая вас удивила?||"""
    
    # Получаем ответ от OpenAI
    result = get_openai_response(text, system_prompt)
    
    if result['success']:
        print(f"✅ Text dialog successful for user {user_id}")
        
        # Логируем использование
        supabase_config = get_supabase_config()
        if supabase_config['url'] and supabase_config['key']:
            log_text_usage(user_id, supabase_config['url'], supabase_config['key'])
        
        return success_response({
            'reply': result['reply']
        })
    else:
        print(f"❌ Text dialog failed: {result['error']}")
        return error_response(f"Text dialog error: {result['error']}")


def handle_generate_feedback(body):
    """Генерация финального фидбэка для текстового диалога"""
    validation_error = validate_required_fields(body, ['user_id'])
    if validation_error:
        return error_response(validation_error)
    
    user_id = body['user_id']
    user_lang = body.get('user_lang', 'ru')
    
    print(f"📊 Generating text dialog feedback for user {user_id}")
    
    # Системный промпт для фидбэка
    if user_lang == 'en':
        feedback_prompt = """Generate a brief final feedback for a TEXT-BASED English conversation practice session. Write in English.

IMPORTANT: This was a TEXT conversation only - DO NOT mention pronunciation, speaking, or audio skills.

Structure:
🎉 **Great work!**

Thank you for an interesting dialogue! [brief praise]

📝 **Main observations:**
- [1-2 most critical recurring errors in WRITING/GRAMMAR only, if any, or positive observations]

📊 Your results:
- **Writing:** [score]/100
- **Vocabulary:** [score]/100  
- **Grammar:** [score]/100

💡 [Encouraging closing message about WRITTEN English skills]

Keep it concise (max 150 words) and encouraging. Give realistic scores 70-95. Focus only on text-based skills."""
    else:
        feedback_prompt = """Generate a brief final feedback for a TEXT-BASED English conversation practice session. Write in Russian.

IMPORTANT: This was a TEXT conversation only - DO NOT mention pronunciation, speaking, or audio skills.

Structure:
🎉 **Отличная работа!**

Спасибо за интересный диалог! [brief praise]

📝 **Основные наблюдения:**
- [1-2 most critical recurring errors in WRITING/GRAMMAR only, if any, or positive observations]

📊 **Ваши результаты:**
- **Письмо:** [score]/100
- **Словарный запас:** [score]/100  
- **Грамматика:** [score]/100

💡 [Encouraging closing message about WRITTEN English skills]

Keep it concise (max 150 words) and encouraging. Give realistic scores 70-95. Focus only on text-based skills."""
    
    # Получаем фидбэк от OpenAI
    result = get_openai_response("Generate feedback for completed text dialog", feedback_prompt)
    
    if result['success']:
        print(f"✅ Text dialog feedback generated for user {user_id}")
        return success_response({
            'feedback': result['reply']
        })
    else:
        print(f"❌ Text dialog feedback failed: {result['error']}")
        return error_response(f"Feedback generation error: {result['error']}")
