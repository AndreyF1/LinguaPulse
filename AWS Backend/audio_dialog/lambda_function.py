"""Lambda функция для АУДИО ДИАЛОГОВ - изолированная логика"""
import sys
import os
import json

# Добавляем shared в path (находится в корне Lambda)
sys.path.insert(0, '/var/task/shared')
sys.path.insert(0, '/var/task')

from shared.openai_client import get_openai_response
from shared.utils import success_response, error_response, parse_request_body, validate_required_fields


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
        elif action == 'generate_dialog_feedback':
            return handle_generate_feedback(body)
        elif action == 'decrease_lessons_left':
            return handle_decrease_lessons_left(body)
        elif action == 'check_audio_access':
            return handle_check_audio_access(body)
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


def handle_decrease_lessons_left(body):
    """Уменьшение lessons_left при завершении аудио-урока"""
    from database import get_supabase_config
    import urllib.request
    import json
    from datetime import datetime, timedelta
    
    validation_error = validate_required_fields(body, ['user_id'])
    if validation_error:
        return error_response(validation_error)
    
    user_id = body['user_id']
    supabase_config = get_supabase_config()
    supabase_url = supabase_config['url']
    supabase_key = supabase_config['key']
    
    try:
        print(f"Decreasing lessons_left for user {user_id}")
        
        # Получаем текущие данные пользователя
        url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=lessons_left,total_lessons_completed,current_streak,last_lesson_date"
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'apikey': supabase_key
        }
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            users = json.loads(response_text)
            
            if users:
                user_data = users[0]
                current_lessons = user_data.get('lessons_left', 0)
                total_completed = user_data.get('total_lessons_completed', 0)
                current_streak = user_data.get('current_streak', 0)
                last_lesson_date = user_data.get('last_lesson_date')
                
                new_lessons = max(0, current_lessons - 1)  # Не может быть меньше 0
                new_total = total_completed + 1  # Увеличиваем общее количество
                
                # Обновляем streak и last_lesson_date
                today = datetime.now().date()
                should_update_streak = True
                
                if last_lesson_date:
                    try:
                        last_date = datetime.fromisoformat(last_lesson_date).date()
                        # Если уже занимались сегодня, не увеличиваем streak
                        if last_date == today:
                            should_update_streak = False
                            print(f"User {user_id} already practiced today, not updating streak")
                        # Если последний раз занимались вчера, увеличиваем streak
                        elif last_date == today - timedelta(days=1):
                            current_streak += 1
                            print(f"User {user_id} practiced yesterday, increasing streak to {current_streak}")
                        # Если пропустили дни, streak = 1
                        elif last_date < today - timedelta(days=1):
                            current_streak = 1
                            print(f"User {user_id} missed days, resetting streak to 1")
                    except Exception as e:
                        print(f"Error parsing last_lesson_date: {e}")
                        # Если ошибка парсинга, устанавливаем streak = 1
                        current_streak = 1
                else:
                    # Первый раз занимается
                    current_streak = 1
                    print(f"User {user_id} first time practicing, setting streak to 1")
                
                print(f"User {user_id}: lessons_left {current_lessons} -> {new_lessons}, total_completed {total_completed} -> {new_total}")
                
                # Подготавливаем данные для обновления
                update_data = {
                    'lessons_left': new_lessons,
                    'total_lessons_completed': new_total
                }
                
                # Добавляем обновление streak только если нужно
                if should_update_streak:
                    update_data['current_streak'] = current_streak
                    update_data['last_lesson_date'] = today.isoformat()
                
                # Обновляем данные в базе
                update_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
                update_data_json = json.dumps(update_data).encode('utf-8')
                
                update_headers = {
                    'Authorization': f'Bearer {supabase_key}',
                    'apikey': supabase_key,
                    'Content-Type': 'application/json'
                }
                
                update_req = urllib.request.Request(update_url, data=update_data_json, headers=update_headers, method='PATCH')
                urllib.request.urlopen(update_req)
                
                print(f"Successfully updated lessons for user {user_id}: lessons_left {current_lessons} -> {new_lessons}, total_completed {total_completed} -> {new_total}")
                if should_update_streak:
                    print(f"Also updated streak: {current_streak}, last_lesson_date: {today}")
                
                return success_response({
                    'lessons_left': new_lessons,
                    'total_lessons_completed': new_total,
                    'decreased_by': 1,
                    'streak_updated': should_update_streak,
                    'new_streak': current_streak
                })
        
        # Пользователь не найден
        return error_response('User not found')
        
    except Exception as e:
        print(f"Error decreasing lessons_left: {e}")
        return error_response(f'Error decreasing lessons: {str(e)}')


def handle_check_audio_access(body):
    """Проверка доступа к аудио-урокам"""
    from database import get_supabase_config
    from datetime import datetime, timezone
    import urllib.request
    import json
    
    validation_error = validate_required_fields(body, ['user_id'])
    if validation_error:
        return error_response(validation_error)
    
    user_id = body['user_id']
    supabase_config = get_supabase_config()
    supabase_url = supabase_config['url']
    supabase_key = supabase_config['key']
    
    try:
        print(f"Checking audio access for user {user_id}")
        print(f"Supabase URL: {supabase_url}")
        print(f"Supabase Key: {supabase_key[:10]}...")
        
        # Получаем данные пользователя из Supabase
        url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
        print(f"Request URL: {url}")
        
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'apikey': supabase_key,
            'Content-Type': 'application/json'
        }
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            print(f"Supabase response: {response_text}")
            users = json.loads(response_text) if response_text else []
            
            if not users:
                print(f"User {user_id} not found in database")
                return error_response('User not found')
            
            user = users[0]
            lessons_left = user.get('lessons_left', 0)
            package_expires_at = user.get('package_expires_at')
            interface_language = user.get('interface_language', 'ru')
            
            print(f"User {user_id}: lessons_left={lessons_left}, package_expires_at={package_expires_at}")
            
            # Проверяем доступ
            now = datetime.now(timezone.utc)
            has_lessons = lessons_left > 0
            has_active_subscription = False
            
            if package_expires_at:
                try:
                    expires_date = datetime.fromisoformat(package_expires_at.replace('Z', '+00:00'))
                    has_active_subscription = expires_date > now
                    print(f"Subscription check: {expires_date} > {now} = {has_active_subscription}")
                except Exception as e:
                    print(f"Error parsing package_expires_at: {e}")
                    has_active_subscription = False
            
            # Доступ есть если есть уроки И активная подписка
            has_access = has_lessons and has_active_subscription
            
            print(f"Access result: has_lessons={has_lessons}, has_active_subscription={has_active_subscription}, has_access={has_access}")
            
            return success_response({
                'has_access': has_access,
                'lessons_left': lessons_left,
                'package_expires_at': package_expires_at,
                'has_active_subscription': has_active_subscription,
                'interface_language': interface_language
            })
            
    except urllib.error.HTTPError as e:
        print(f"HTTP Error checking audio access: {e.code} - {e.reason}")
        error_body = e.read().decode('utf-8') if e.fp else 'No error body'
        print(f"Error body: {error_body}")
        return error_response(f'Database error: {e.code} - {e.reason}')
    except Exception as e:
        print(f"Error checking audio access: {e}")
        return error_response(f'Error checking access: {str(e)}')
