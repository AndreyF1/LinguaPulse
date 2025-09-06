import json
import os
import urllib.request
import urllib.parse

def lambda_handler(event, context):
    """
    Lambda функция для обработки онбординга пользователей
    """
    print(f"Event received: {json.dumps(event)}")
    
    # Извлекаем данные из HTTP запроса
    if 'body' in event:
        try:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        except:
            body = {}
    else:
        body = event
    
    print(f"Parsed body: {body}")
    
    # Получаем Supabase credentials
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Supabase credentials not found")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Supabase not configured'})
        }
    
    # Простой ping test
    if 'test' in body:
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'message': 'Pong! Lambda is working'})
        }
    
    # 1. Проверка существования пользователя
    if 'action' in body and body['action'] == 'check_user':
        user_id = body.get('user_id')
        if not user_id:
            return error_response('user_id is required')
        
        try:
            # Проверяем существование пользователя в Supabase
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
            headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key
            }
            
            req = urllib.request.Request(url, headers=headers, method='GET')
            
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                users = json.loads(response_text) if response_text else []
                
                if users:
                    print(f"User {user_id} exists in Supabase")
                    return success_response({
                        'user_exists': True,
                        'user_data': users[0]
                    })
                else:
                    print(f"User {user_id} not found in Supabase")
                    return success_response({
                        'user_exists': False
                    })
                    
        except Exception as e:
            print(f"Error checking user: {e}")
            return error_response(f'Failed to check user: {str(e)}')
    
    # 2. Начало опросника - создание пользователя
    if 'action' in body and body['action'] == 'start_survey':
        user_id = body.get('user_id')
        interface_language = body.get('interface_language', 'ru')
        username = body.get('username', f'user_{user_id}')  # Получаем username из Telegram
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            # Создаем пользователя в Supabase с quiz_started_at
            user_data = {
                'telegram_id': int(user_id),
                'username': username,
                'interface_language': interface_language,
                'lessons_left': 0,  # Уроки начисляются только после завершения опроса
                'quiz_started_at': 'now()',  # Фиксируем начало прохождения опроса
                'is_active': True
            }
            
            print(f"[NEW CREDS TEST] Creating user in Supabase with quiz_started_at=now() and lessons_left=0: {user_data}")
            
            url = f"{supabase_url}/rest/v1/users"
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key,
                'Prefer': 'return=representation'
            }
            
            req = urllib.request.Request(url, 
                                       data=json.dumps(user_data).encode('utf-8'),
                                       headers=headers,
                                       method='POST')
            
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                print(f"Supabase response status: {response.status}")
                print(f"Supabase response text: {response_text}")
                
                if response_text:
                    result = json.loads(response_text)
                else:
                    result = {"status": "success", "message": "User created"}
                
                return success_response({
                    'message': 'User created successfully',
                    'user_data': result[0] if isinstance(result, list) else result
                })
                
        except urllib.error.HTTPError as e:
            if e.code == 409:  # Conflict - user already exists
                print(f"User {user_id} already exists in Supabase")
                return success_response({
                    'message': 'User already exists',
                    'user_exists': True
                })
            else:
                error_body = e.read().decode('utf-8')
                print(f"HTTP Error {e.code}: {error_body}")
                return error_response(f'HTTP Error {e.code}: {error_body}')
        except Exception as e:
            print(f"Error creating user in Supabase: {e}")
            return error_response(f'Failed to create user: {str(e)}')
    
    # 3. Получение следующего вопроса опросника
    if 'action' in body and body['action'] == 'get_survey_question':
        question_type = body.get('question_type')
        language = body.get('language', 'ru')
        
        if not question_type:
            return error_response('question_type is required')
        
        try:
            question_data = get_survey_question(question_type, language)
            return success_response(question_data)
        except Exception as e:
            print(f"Error getting survey question: {e}")
            return error_response(f'Failed to get survey question: {str(e)}')
    
    # 4. Завершение опросника - обновление пользователя и начисление продукта
    if 'action' in body and body['action'] == 'complete_survey':
        user_id = body.get('user_id')
        language_level = body.get('language_level')
        survey_data = body.get('survey_data', {})  # Все ответы опросника
        
        if not user_id or not language_level:
            return error_response('user_id and language_level are required')
        
        try:
            # Трансформируем уровень языка в формат Supabase
            transformed_level = transform_language_level(language_level)
            
            # Получаем информацию о продукте
            product_id = "7d9d5dbb-7ed2-4bdc-9d2f-c88929085ab5"
            product_info = get_product_info(product_id, supabase_url, supabase_key)
            
            # Обновляем пользователя - завершаем опрос и начисляем уроки
            update_data = {
                'current_level': transformed_level,
                'quiz_completed_at': 'now()',  # Только завершение, quiz_started_at уже установлен
                'lessons_left': 3,  # Начисляем уроки за завершение опроса
                'package_expires_at': product_info.get('expires_at') if product_info else None
            }
            
            print(f"Updating user {user_id} with language level: {transformed_level}")
            print(f"Full survey data: {survey_data}")
            
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key,
                'Prefer': 'return=representation'
            }
            
            req = urllib.request.Request(url, 
                                       data=json.dumps(update_data).encode('utf-8'),
                                       headers=headers,
                                       method='PATCH')
            
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                print(f"Supabase update response: {response_text}")
                
                print(f"Product {product_id} assigned to user {user_id}")
                
                return success_response({
                    'message': 'Survey completed successfully',
                    'language_level': transformed_level,
                    'product_assigned': product_id,
                    'survey_data': survey_data  # Возвращаем все данные для логирования
                })
                
        except Exception as e:
            print(f"Error completing survey: {e}")
            return error_response(f'Failed to complete survey: {str(e)}')
    
    # 5. Обработка отписки пользователя
    if 'action' in body and body['action'] == 'deactivate_user':
        user_id = body.get('user_id')
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            # Деактивируем пользователя
            update_data = {
                'is_active': False
            }
            
            print(f"Deactivating user {user_id}")
            
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key,
                'Prefer': 'return=representation'
            }
            
            req = urllib.request.Request(url, 
                                       data=json.dumps(update_data).encode('utf-8'),
                                       headers=headers,
                                       method='PATCH')
            
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                print(f"Supabase deactivation response: {response_text}")
                
                return success_response({
                    'message': 'User deactivated successfully'
                })
                
        except Exception as e:
            print(f"Error deactivating user: {e}")
            return error_response(f'Failed to deactivate user: {str(e)}')
    
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'message': 'OK'})
    }

def success_response(data):
    """Успешный ответ"""
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({
            'success': True,
            **data
        })
    }

def error_response(message):
    """Ответ с ошибкой"""
    return {
        'statusCode': 400,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({
            'success': False,
            'error': message
        })
    }

# Конфигурация вопросов опросника (из newbies-funnel.js)
SURVEY_QUESTIONS = {
    'language_level': {
        'ru': {
            'question': "Какой у тебя уровень языка?",
            'options': ["Начинающий", "Средний", "Продвинутый"]
        },
        'en': {
            'question': "What's your language level?",
            'options': ["Beginner", "Intermediate", "Advanced"]
        }
    },
    'study_goal': {
        'ru': {
            'question': "Основная цель изучения?",
            'options': ["Для работы", "Для путешествий", "Для учебы", "Хобби", "Другое"]
        },
        'en': {
            'question': "Main study goal?",
            'options': ["For work", "For travel", "For study", "Hobby", "Other"]
        }
    },
    'gender': {
        'ru': {
            'question': "Укажи свой пол",
            'options': ["Мужской", "Женский", "Предпочитаю не отвечать"]
        },
        'en': {
            'question': "What's your gender?",
            'options': ["Male", "Female", "Prefer not to say"]
        }
    },
    'age': {
        'ru': {
            'question': "Сколько тебе лет?",
            'options': ["Менее 14", "14-21", "22-28", "29-35", "36-45", "46-60", "Более 60"]
        },
        'en': {
            'question': "How old are you?",
            'options': ["Under 14", "14-21", "22-28", "29-35", "36-45", "46-60", "Over 60"]
        }
    },
    'telegram_preference': {
        'ru': {
            'question': "Нравится ли тебе идея заниматься в Телеграм?",
            'options': ["Да", "Предпочёл бы app"]
        },
        'en': {
            'question': "Do you like the idea of studying in Telegram?",
            'options': ["Yes", "Prefer app"]
        }
    },
    'voice_usage': {
        'ru': {
            'question': "Часто ли ты пользуешься голосовыми сообщениями в Телеграм?",
            'options': ["Что это?", "Нет", "Иногда", "Постоянно"]
        },
        'en': {
            'question': "How often do you use voice messages in Telegram?",
            'options': ["What's that?", "No", "Sometimes", "Constantly"]
        }
    }
}

# Порядок вопросов
QUESTION_ORDER = [
    'language_level',
    'study_goal', 
    'gender',
    'age',
    'telegram_preference',
    'voice_usage'
]

def get_survey_question(question_type, language='ru'):
    """Получить вопрос опросника"""
    if question_type not in SURVEY_QUESTIONS:
        raise ValueError(f"Unknown question type: {question_type}")
    
    question_config = SURVEY_QUESTIONS[question_type]
    if language not in question_config:
        language = 'ru'  # Fallback to Russian
    
    return {
        'question_type': question_type,
        'question': question_config[language]['question'],
        'options': question_config[language]['options'],
        'language': language
    }

def get_next_question(current_question):
    """Получить следующий вопрос"""
    current_index = QUESTION_ORDER.index(current_question) if current_question in QUESTION_ORDER else -1
    if current_index == -1 or current_index >= len(QUESTION_ORDER) - 1:
        return None  # No more questions
    return QUESTION_ORDER[current_index + 1]

def transform_language_level(russian_level):
    """Трансформирует русский уровень языка в английский для Supabase"""
    level_mapping = {
        'Начинающий': 'Beginner',
        'Средний': 'Intermediate', 
        'Продвинутый': 'Advanced',
        'Beginner': 'Beginner',
        'Intermediate': 'Intermediate',
        'Advanced': 'Advanced'
    }
    return level_mapping.get(russian_level, 'Beginner')

def get_product_info(product_id, supabase_url, supabase_key):
    """Получает информацию о продукте из Supabase"""
    try:
        url = f"{supabase_url}/rest/v1/products?id=eq.{product_id}"
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'apikey': supabase_key
        }
        
        req = urllib.request.Request(url, headers=headers, method='GET')
        
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            products = json.loads(response_text) if response_text else []
            
            if products:
                product = products[0]
                # Вычисляем дату истечения пакета
                from datetime import datetime, timedelta
                duration_days = product.get('duration_days', 30)
                expires_at = (datetime.now() + timedelta(days=duration_days)).isoformat()
                
                return {
                    'id': product['id'],
                    'name': product['name'],
                    'duration_days': duration_days,
                    'expires_at': expires_at
                }
            return None
            
    except Exception as e:
        print(f"Error getting product info: {e}")
        return None
# Test comment
