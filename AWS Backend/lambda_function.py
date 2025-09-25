import json
import os
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone

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
            
            print(f"[WAIT CONDITION FIX TEST] Creating user in Supabase with quiz_started_at=now() and lessons_left=0: {user_data}")
            
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
            # Рассчитываем дату окончания пробного периода текстового помощника (7 дней)
            text_trial_end = (datetime.now() + timedelta(days=7)).isoformat()
            
            update_data = {
                'current_level': transformed_level,
                'quiz_completed_at': 'now()',  # Только завершение, quiz_started_at уже установлен
                'lessons_left': 3,  # Начисляем уроки за завершение опроса
                'package_expires_at': product_info.get('expires_at') if product_info else None,
                'text_trial_ends_at': text_trial_end  # 7 дней доступа к текстовому помощнику
            }
            
            print(f"Updating user {user_id} with language level: {transformed_level}")
            print(f"Setting text_trial_ends_at to: {text_trial_end}")
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
    
    # 6. Добавление пользователя в waitlist для аудио-практики
    if 'action' in body and body['action'] == 'add_to_waitlist':
        user_id = body.get('user_id')
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            print(f"Adding user {user_id} to audio practice waitlist")
            
            # Обновляем waitlist_voice = true для пользователя
            update_data = {
                'waitlist_voice': True
            }
            
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
                print(f"Supabase waitlist update response: {response_text}")
                
                if response_text:
                    user_data = json.loads(response_text)[0] if response_text.startswith('[') else json.loads(response_text)
                    
                    return success_response({
                        'message': 'User added to waitlist successfully',
                        'user_data': user_data
                    })
                else:
                    return success_response({
                        'message': 'User added to waitlist successfully'
                    })
                
        except Exception as e:
            print(f"Error adding user to waitlist: {e}")
            return error_response(f'Failed to add user to waitlist: {str(e)}')
    
    # 7. Обработка текстовых сообщений через OpenAI
    if 'action' in body and body['action'] == 'process_text_message':
        user_id = body.get('user_id')
        message = body.get('message')
        mode = body.get('mode', 'general')  # Получаем режим, по умолчанию 'general'
        
        if not user_id or not message:
            return error_response('user_id and message are required')
        
        try:
            print(f"Processing text message from user {user_id} in mode '{mode}': {message}")
            
            # Проверяем, есть ли у пользователя активный пробный период
            user_check_response = check_text_trial_access(user_id, supabase_url, supabase_key)
            
            if not user_check_response['has_access']:
                return success_response({
                    'reply': user_check_response['message']
                })
            
            # Special handling for audio dialog start
            if message == '---START_AUDIO_DIALOG---':
                user_level = body.get('user_level', 'Intermediate')
                print(f"Generating audio dialog greeting for user level: {user_level}")
                
                # Generate personalized audio greeting with topic suggestions
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

                openai_response = get_openai_response(greeting_prompt, 'audio_dialog')
            else:
                # Получаем ответ от OpenAI с указанным режимом
                openai_response = get_openai_response(message, mode)
            
            if openai_response['success']:
                # Логируем использование для ВСЕХ текстовых режимов КРОМЕ переводов (audio_dialog НЕ вызывает process_text_message)
                if mode != 'translation':
                    log_text_usage(user_id, supabase_url, supabase_key)
                    print(f"✅ Text usage logged for mode: {mode}")
                else:
                    print(f"⏭️ Skipping text usage logging for translation mode")
                
                return success_response({
                    'reply': openai_response['reply']
                })
            else:
                return error_response(f"OpenAI error: {openai_response['error']}")
                
        except Exception as e:
            print(f"Error processing text message: {e}")
            return error_response(f'Failed to process text message: {str(e)}')
    
    # 8. Получение профиля пользователя для команды /profile
    if 'action' in body and body['action'] == 'get_profile':
        user_id = body.get('user_id')
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            from datetime import datetime, timedelta
            print(f"Getting profile for user {user_id}")
            
            # Получаем данные пользователя из Supabase
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=*"
            headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                
                if response_text:
                    users = json.loads(response_text)
                    if users:
                        user_data = users[0]
                        
                        # Обработка логики lessons_left при истечении package_expires_at
                        package_expires_at = user_data.get('package_expires_at')
                        lessons_left = user_data.get('lessons_left', 0)
                        
                        # Если подписка истекла, обнуляем lessons_left
                        if package_expires_at and lessons_left > 0:
                            try:
                                package_end = datetime.fromisoformat(package_expires_at.replace('Z', '+00:00'))
                                now = datetime.now(package_end.tzinfo) if package_end.tzinfo else datetime.now()
                                
                                if now >= package_end:  # Подписка истекла
                                    print(f"Package expired for user {user_id}, resetting lessons_left to 0")
                                    
                                    # Обновляем lessons_left в базе
                                    update_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
                                    update_data = json.dumps({'lessons_left': 0}).encode('utf-8')
                                    update_headers = {
                                        'Authorization': f'Bearer {supabase_key}',
                                        'apikey': supabase_key,
                                        'Content-Type': 'application/json'
                                    }
                                    
                                    update_req = urllib.request.Request(update_url, data=update_data, headers=update_headers, method='PATCH')
                                    urllib.request.urlopen(update_req)
                                    
                                    # Обновляем локальные данные
                                    user_data['lessons_left'] = 0
                            except Exception as e:
                                print(f"Error processing package expiry: {e}")
                        
                        # Определяем доступ к различным функциям
                        now = datetime.now()
                        
                        # Доступ к аудио-урокам
                        has_audio_access = False
                        if package_expires_at and user_data.get('lessons_left', 0) > 0:
                            try:
                                package_end = datetime.fromisoformat(package_expires_at.replace('Z', '+00:00'))
                                package_now = datetime.now(package_end.tzinfo) if package_end.tzinfo else datetime.now()
                                has_audio_access = package_now < package_end
                            except Exception as e:
                                print(f"Error parsing package_expires_at for audio access: {e}")
                        
                        # Доступ к текстовым функциям
                        has_text_access = False
                        text_trial_ends_at = user_data.get('text_trial_ends_at')
                        
                        # Проверяем text_trial_ends_at
                        if text_trial_ends_at:
                            try:
                                trial_end = datetime.fromisoformat(text_trial_ends_at.replace('Z', '+00:00'))
                                trial_now = datetime.now(trial_end.tzinfo) if trial_end.tzinfo else datetime.now()
                                if trial_now < trial_end:
                                    has_text_access = True
                            except Exception as e:
                                print(f"Error parsing text_trial_ends_at: {e}")
                        
                        # Проверяем package_expires_at для текстового доступа
                        if not has_text_access and package_expires_at:
                            try:
                                package_end = datetime.fromisoformat(package_expires_at.replace('Z', '+00:00'))
                                package_now = datetime.now(package_end.tzinfo) if package_end.tzinfo else datetime.now()
                                if package_now < package_end:
                                    has_text_access = True
                            except Exception as e:
                                print(f"Error parsing package_expires_at for text access: {e}")
                        
                        # Определяем дату доступа (берем более позднюю)
                        access_date = None
                        if text_trial_ends_at or package_expires_at:
                            dates = []
                            if text_trial_ends_at:
                                try:
                                    dates.append(datetime.fromisoformat(text_trial_ends_at.replace('Z', '+00:00')))
                                except:
                                    pass
                            if package_expires_at:
                                try:
                                    dates.append(datetime.fromisoformat(package_expires_at.replace('Z', '+00:00')))
                                except:
                                    pass
                            if dates:
                                access_date = max(dates)
                        
                        return {
                            'statusCode': 200,
                            'body': json.dumps({
                                'success': True,
                                'user_data': user_data,
                                'has_audio_access': has_audio_access,
                                'has_text_access': has_text_access,
                                'access_date': access_date.strftime('%d.%m.%Y') if access_date else None
                            })
                        }
            
            # Пользователь не найден
            return {
                'statusCode': 404,
                'body': json.dumps({
                    'success': False,
                    'error': 'User not found'
                })
            }
            
        except Exception as e:
            print(f"Error getting profile: {e}")
            return error_response(f'Error getting profile: {str(e)}')
    
    # 9. Обновление streak при завершении текстового диалога
    if 'action' in body and body['action'] == 'update_text_dialog_streak':
        user_id = body.get('user_id')
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            print(f"Updating text dialog streak for user {user_id}")
            
            # Получаем текущие данные пользователя
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=current_streak,last_lesson_date"
            headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                
                if response_text:
                    users = json.loads(response_text)
                    if users:
                        user_data = users[0]
                        current_streak = user_data.get('current_streak', 0)
                        last_lesson_date = user_data.get('last_lesson_date')
                        
                        # Определяем, нужно ли увеличивать streak
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
                        
                        # Обновляем данные в базе только если нужно
                        if should_update_streak:
                            update_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
                            update_data = json.dumps({
                                'current_streak': current_streak,
                                'last_lesson_date': today.isoformat()
                            }).encode('utf-8')
                            update_headers = {
                                'Authorization': f'Bearer {supabase_key}',
                                'apikey': supabase_key,
                                'Content-Type': 'application/json'
                            }
                            
                            update_req = urllib.request.Request(update_url, data=update_data, headers=update_headers, method='PATCH')
                            urllib.request.urlopen(update_req)
                            
                            print(f"Successfully updated streak for user {user_id}: {current_streak}")
                        
                        return {
                            'statusCode': 200,
                            'body': json.dumps({
                                'success': True,
                                'streak_updated': should_update_streak,
                                'new_streak': current_streak
                            })
                        }
            
            # Пользователь не найден
            return error_response('User not found')
            
        except Exception as e:
            print(f"Error updating text dialog streak: {e}")
            return error_response(f'Error updating streak: {str(e)}')
    
    # 10. Уменьшение lessons_left при завершении аудио-урока
    if 'action' in body and body['action'] == 'decrease_lessons_left':
        user_id = body.get('user_id')
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            print(f"Decreasing lessons_left for user {user_id}")
            
            # Получаем текущее количество уроков
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=lessons_left"
            headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                users = json.loads(response_text)
                
                if users:
                    current_lessons = users[0].get('lessons_left', 0)
                    new_lessons = max(0, current_lessons - 1)  # Не может быть меньше 0
                    
                    print(f"User {user_id}: lessons_left {current_lessons} -> {new_lessons}")
                    
                    # Обновляем lessons_left
                    update_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
                    update_data = json.dumps({
                        'lessons_left': new_lessons
                    }).encode('utf-8')
                    
                    update_headers = {
                        'Authorization': f'Bearer {supabase_key}',
                        'apikey': supabase_key,
                        'Content-Type': 'application/json'
                    }
                    
                    update_req = urllib.request.Request(update_url, data=update_data, headers=update_headers, method='PATCH')
                    urllib.request.urlopen(update_req)
                    
                    print(f"Successfully decreased lessons_left for user {user_id}: {current_lessons} -> {new_lessons}")
                    
                    return {
                        'statusCode': 200,
                        'body': json.dumps({
                            'success': True,
                            'lessons_left': new_lessons,
                            'decreased_by': 1
                        })
                    }
            
            # Пользователь не найден
            return error_response('User not found')
            
        except Exception as e:
            print(f"Error decreasing lessons_left: {e}")
            return error_response(f'Error decreasing lessons: {str(e)}')
    
    # 11. Обновление streak и статистики при завершении аудио-урока
    if 'action' in body and body['action'] == 'update_audio_lesson_streak':
        user_id = body.get('user_id')
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            print(f"Updating audio lesson streak for user {user_id}")
            
            # Получаем текущие данные пользователя
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=current_streak,last_lesson_date,total_lessons_completed"
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
                    current_streak = user_data.get('current_streak', 0)
                    last_lesson_date_str = user_data.get('last_lesson_date')
                    total_lessons = user_data.get('total_lessons_completed', 0)
                    
                    # Определяем нужно ли обновлять streak
                    today = datetime.now(timezone.utc).date()
                    should_update_streak = True
                    
                    if last_lesson_date_str:
                        try:
                            last_lesson_date = datetime.fromisoformat(last_lesson_date_str.replace('Z', '+00:00')).date()
                            days_diff = (today - last_lesson_date).days
                            
                            if days_diff == 0:
                                # Уже практиковался сегодня - не обновляем streak
                                should_update_streak = False
                                print(f"User {user_id} already practiced today, keeping streak: {current_streak}")
                            elif days_diff == 1:
                                # Вчера практиковался - увеличиваем streak
                                current_streak += 1
                                print(f"User {user_id} practiced yesterday, incrementing streak to: {current_streak}")
                            else:
                                # Пропустил дни - сбрасываем streak
                                current_streak = 1
                                print(f"User {user_id} missed days, resetting streak to: 1")
                        except Exception as e:
                            print(f"Error parsing last_lesson_date: {e}")
                            current_streak = 1
                    else:
                        # Первая практика
                        current_streak = 1
                        print(f"User {user_id} first practice, setting streak to: 1")
                    
                    if should_update_streak:
                        # Обновляем streak, last_lesson_date и total_lessons_completed
                        update_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
                        update_data = json.dumps({
                            'current_streak': current_streak,
                            'last_lesson_date': today.isoformat(),
                            'total_lessons_completed': total_lessons + 1
                        }).encode('utf-8')
                        
                        update_headers = {
                            'Authorization': f'Bearer {supabase_key}',
                            'apikey': supabase_key,
                            'Content-Type': 'application/json'
                        }
                        
                        update_req = urllib.request.Request(update_url, data=update_data, headers=update_headers, method='PATCH')
                        urllib.request.urlopen(update_req)
                        
                        print(f"Successfully updated audio lesson stats for user {user_id}: streak={current_streak}, total_lessons={total_lessons + 1}")
                    
                    return {
                        'statusCode': 200,
                        'body': json.dumps({
                            'success': True,
                            'streak_updated': should_update_streak,
                            'new_streak': current_streak,
                            'total_lessons': total_lessons + (1 if should_update_streak else 0)
                        })
                    }
            
            # Пользователь не найден
            return error_response('User not found')
            
        except Exception as e:
            print(f"Error updating audio lesson streak: {e}")
            return error_response(f'Error updating audio lesson streak: {str(e)}')
    
    # 12. Сохранение feedback пользователя с начислением Starter pack
    if 'action' in body and body['action'] == 'save_feedback':
        user_id = body.get('user_id')
        feedback_text = body.get('feedback_text', '').strip()
        
        if not user_id or not feedback_text:
            return error_response('user_id and feedback_text are required')
        
        try:
            print(f"Saving feedback for user {user_id}")
            
            # Проверяем, оставлял ли пользователь фидбэк ранее
            check_url = f"{supabase_url}/rest/v1/feedback?telegram_id=eq.{user_id}&select=id"
            headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key
            }
            
            req = urllib.request.Request(check_url, headers=headers)
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                existing_feedback = json.loads(response_text) if response_text else []
                is_first_feedback = len(existing_feedback) == 0
            
            # Получаем user_id (UUID) из users таблицы
            user_uuid = None
            user_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=id"
            user_req = urllib.request.Request(user_url, headers=headers)
            with urllib.request.urlopen(user_req) as response:
                response_text = response.read().decode('utf-8')
                users = json.loads(response_text) if response_text else []
                if users:
                    user_uuid = users[0]['id']
            
            # Сохраняем feedback в базу
            feedback_data = {
                'user_id': user_uuid,
                'telegram_id': int(user_id),
                'text': feedback_text,
                'created_at': 'now()'
            }
            
            feedback_url = f"{supabase_url}/rest/v1/feedback"
            feedback_json = json.dumps(feedback_data).encode('utf-8')
            feedback_headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key,
                'Content-Type': 'application/json'
            }
            
            feedback_req = urllib.request.Request(feedback_url, data=feedback_json, headers=feedback_headers, method='POST')
            urllib.request.urlopen(feedback_req)
            
            print(f"Feedback saved for user {user_id}, first_feedback: {is_first_feedback}")
            
            # Если это первый фидбэк, начисляем Starter pack
            starter_pack_granted = False
            if is_first_feedback:
                try:
                    # Используем правильный ID Starter pack (тот же что и в complete_survey)
                    starter_pack_id = "7d9d5dbb-7ed2-4bdc-9d2f-c88929085ab5"
                    products_url = f"{supabase_url}/rest/v1/products?id=eq.{starter_pack_id}"
                    products_req = urllib.request.Request(products_url, headers=headers)
                    with urllib.request.urlopen(products_req) as response:
                        response_text = response.read().decode('utf-8')
                        products = json.loads(response_text) if response_text else []
                        
                        if products:
                            starter_pack = products[0]  # Правильный Starter pack по ID
                            
                            # Получаем текущие данные пользователя
                            current_user_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=lessons_left,package_expires_at"
                            current_req = urllib.request.Request(current_user_url, headers=headers)
                            with urllib.request.urlopen(current_req) as response:
                                response_text = response.read().decode('utf-8')
                                current_users = json.loads(response_text) if response_text else []
                                
                                if current_users:
                                    current_user = current_users[0]
                                    current_lessons = current_user.get('lessons_left', 0)
                                    current_expires_at = current_user.get('package_expires_at')
                                    
                                    # Вычисляем новые значения
                                    new_lessons = current_lessons + starter_pack.get('lessons_granted', 0)
                                    
                                    # Логика продления package_expires_at
                                    from datetime import datetime, timedelta
                                    duration_days = starter_pack.get('duration_days', 30)
                                    now = datetime.now()
                                    
                                    if current_expires_at:
                                        try:
                                            current_expires_date = datetime.fromisoformat(current_expires_at.replace('Z', '+00:00'))
                                            # Если текущая дата истечения в будущем, продляем от неё
                                            # ВСЕГДА продляем от существующей даты в таблице, независимо от того активна подписка или нет
                                            new_expires_date = current_expires_date + timedelta(days=duration_days)
                                            print(f"📅 ДАТА РАСЧЕТ: {current_expires_at} + {duration_days} дней = {new_expires_date.isoformat()}")
                                        except Exception as e:
                                            print(f"Error parsing current_expires_at '{current_expires_at}': {e}")
                                            # Если ошибка парсинга, продляем от текущего момента
                                            new_expires_date = now + timedelta(days=duration_days)
                                    else:
                                        # Если package_expires_at не установлен, устанавливаем от текущего момента
                                        new_expires_date = now + timedelta(days=duration_days)
                                    
                                    print(f"Updating package_expires_at: current='{current_expires_at}', new='{new_expires_date.isoformat()}', duration_days={duration_days}")
                                    
                                    # Обновляем пользователя
                                    update_data = {
                                        'lessons_left': new_lessons,
                                        'package_expires_at': new_expires_date.isoformat()
                                    }
                                    
                                    update_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
                                    update_json = json.dumps(update_data).encode('utf-8')
                                    update_headers = {
                                        'Authorization': f'Bearer {supabase_key}',
                                        'apikey': supabase_key,
                                        'Content-Type': 'application/json'
                                    }
                                    
                                    update_req = urllib.request.Request(update_url, data=update_json, headers=update_headers, method='PATCH')
                                    urllib.request.urlopen(update_req)
                                    
                                    starter_pack_granted = True
                                    print(f"Starter pack granted to user {user_id}: +{starter_pack.get('lessons_granted', 0)} lessons, +{duration_days} days")
                        
                except Exception as e:
                    print(f"Error granting starter pack to user {user_id}: {e}")
                    # Не прерываем выполнение, фидбэк уже сохранен
            
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'success': True,
                    'is_first_feedback': is_first_feedback,
                    'starter_pack_granted': starter_pack_granted
                })
            }
            
        except Exception as e:
            print(f"Error saving feedback: {e}")
            return error_response(f'Error saving feedback: {str(e)}')
    
    # 11. Проверка доступа к аудио-урокам
    if 'action' in body and body['action'] == 'check_audio_access':
        user_id = body.get('user_id')
        
        print(f"🚀🚀🚀 LAMBDA ВЫЗВАНА: check_audio_access для user {user_id}")
        print(f"🚀🚀🚀 ВЕРСИЯ КОДА: 2025-09-24 19:37 - ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ")
        print(f"🚀🚀🚀 ПРОБЛЕМА: 27.09.2025 17:19 > 24.09.2025 18:35 должно быть TRUE!")
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            from datetime import datetime, timedelta
            print(f"Checking audio access for user {user_id}")
            
            # Получаем данные пользователя из Supabase
            url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
            headers = {
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                users = json.loads(response_text) if response_text else []
                
                if not users:
                    return error_response('User not found')
                
                user = users[0]
                lessons_left = user.get('lessons_left', 0)
                package_expires_at = user.get('package_expires_at')
                interface_language = user.get('interface_language', 'ru')
                
                print(f"User {user_id}: lessons_left={lessons_left}, package_expires_at={package_expires_at}")
                
                # Проверяем доступ - ИСПРАВЛЯЕМ ЧАСОВОЙ ПОЯС
                from datetime import timezone
                now = datetime.now(timezone.utc)  # ПРИНУДИТЕЛЬНО UTC
                has_lessons = lessons_left > 0
                has_active_subscription = False
                
                print(f"🔍 ДЕТАЛЬНАЯ ПРОВЕРКА ДОСТУПА:")
                print(f"  now (UTC): {now}")
                print(f"  lessons_left: {lessons_left}")
                print(f"  has_lessons: {has_lessons}")
                print(f"  package_expires_at (raw): '{package_expires_at}'")
                
                if package_expires_at:
                    try:
                        print(f"🔥🔥🔥 ПАРСИМ ДАТУ: {package_expires_at}")
                        # ИСПРАВЛЯЕМ ПАРСИНГ - убеждаемся что обе даты в UTC
                        expires_date = datetime.fromisoformat(package_expires_at.replace('Z', '+00:00'))
                        
                        # ДЕТАЛЬНАЯ ДИАГНОСТИКА
                        print(f"🔥🔥🔥 expires_date: {expires_date} (timezone: {expires_date.tzinfo})")
                        print(f"🔥🔥🔥 now: {now} (timezone: {now.tzinfo})")
                        print(f"🔥🔥🔥 expires_date.timestamp(): {expires_date.timestamp()}")
                        print(f"🔥🔥🔥 now.timestamp(): {now.timestamp()}")
                        
                        # ПРАВИЛЬНОЕ СРАВНЕНИЕ
                        has_active_subscription = expires_date > now
                        print(f"🔥🔥🔥 РЕЗУЛЬТАТ: {expires_date} > {now} = {has_active_subscription}")
                        
                        # ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА ЧЕРЕЗ TIMESTAMP
                        timestamp_check = expires_date.timestamp() > now.timestamp()
                        print(f"🔥🔥🔥 TIMESTAMP CHECK: {expires_date.timestamp()} > {now.timestamp()} = {timestamp_check}")
                        
                        if has_active_subscription != timestamp_check:
                            print(f"🚨 НЕСООТВЕТСТВИЕ! datetime: {has_active_subscription}, timestamp: {timestamp_check}")
                            has_active_subscription = timestamp_check  # Используем timestamp как истину
                        
                        # ПРИНУДИТЕЛЬНО ТЕСТИРУЕМ БЕЗ ХАРДКОДА
                        print(f"🎯 ФИНАЛЬНЫЙ РЕЗУЛЬТАТ БЕЗ ХАРДКОДА: has_active_subscription = {has_active_subscription}")
                        
                        # ЕСЛИ РЕЗУЛЬТАТ FALSE - ВЫВОДИМ ДЕТАЛЬНУЮ ДИАГНОСТИКУ
                        if not has_active_subscription:
                            print(f"❌ ДОСТУП ОТКЛОНЕН!")
                            print(f"   expires_date: {expires_date}")
                            print(f"   now: {now}")
                            print(f"   expires_date.year: {expires_date.year}")
                            print(f"   expires_date.month: {expires_date.month}")
                            print(f"   expires_date.day: {expires_date.day}")
                            print(f"   now.year: {now.year}")
                            print(f"   now.month: {now.month}")
                            print(f"   now.day: {now.day}")
                            print(f"   Разница в днях: {(expires_date - now).days}")
                        else:
                            print(f"✅ ДОСТУП РАЗРЕШЕН!")
                    except Exception as e:
                        print(f"❌ Error parsing package_expires_at: {e}")
                else:
                    print(f"  package_expires_at is None/empty")
                
                # Доступ есть если есть уроки И активная подписка
                has_access = has_lessons and has_active_subscription
                
                print(f"🎯 ИТОГОВЫЙ РЕЗУЛЬТАТ: has_access={has_access} (lessons={has_lessons} AND subscription={has_active_subscription})")
                
                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'success': True,
                        'has_access': has_access,
                        'lessons_left': lessons_left,
                        'package_expires_at': package_expires_at,
                        'interface_language': interface_language,
                        'has_lessons': has_lessons,
                        'has_active_subscription': has_active_subscription
                    })
                }
                
        except Exception as e:
            print(f"Error checking audio access: {e}")
            return error_response(f'Error checking audio access: {str(e)}')
    
    # 12. Генерация финального фидбэка для диалога
    if 'action' in body and body['action'] == 'generate_dialog_feedback':
        user_id = body.get('user_id')
        user_lang = body.get('user_lang', 'ru')  # Default to Russian
        mode = body.get('mode', 'text_dialog')  # Default to text dialog
        
        if not user_id:
            return error_response('user_id is required')
        
        try:
            print(f"Generating dialog feedback for user {user_id}, mode: {mode}")
            
            # Генерируем финальный фидбэк через OpenAI в зависимости от режима и языка пользователя
            if mode == 'audio_dialog':
                # AUDIO DIALOG FEEDBACK
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

Keep it concise (max 150 words) and encouraging. Give realistic scores 70-95. Focus only on audio-based skills - speaking, pronunciation, fluency, and verbal communication."""
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

Keep it concise (max 150 words) and encouraging. Give realistic scores 70-95. Focus only on audio-based skills - speaking, pronunciation, fluency, and verbal communication."""
            else:
                # TEXT DIALOG FEEDBACK
                if user_lang == 'en':
                    feedback_prompt = """Generate a brief final feedback for a TEXT-BASED English conversation practice session. Write in English.

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

Keep it concise (max 150 words) and encouraging. Give realistic scores 70-95. Focus only on text-based skills - grammar, vocabulary, and written communication."""
            
            # Создаем специальный промпт для фидбэка без ограничений general режима
            openai_api_key = os.environ.get('OPENAI_API_KEY')
            if not openai_api_key:
                return error_response('OpenAI API key not found')
            
            data = {
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": "You are a helpful English tutor providing feedback on conversation practice."},
                    {"role": "user", "content": feedback_prompt}
                ],
                "max_tokens": 300,
                "temperature": 0.7
            }
            
            headers = {
                'Authorization': f'Bearer {openai_api_key}',
                'Content-Type': 'application/json'
            }
            
            req = urllib.request.Request(
                'https://api.openai.com/v1/chat/completions', 
                data=json.dumps(data).encode('utf-8'),
                headers=headers,
                method='POST'
            )
            
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode('utf-8'))
                if 'choices' in result and len(result['choices']) > 0:
                    openai_response = {
                        'success': True, 
                        'reply': result['choices'][0]['message']['content'].strip()
                    }
                else:
                    openai_response = {'success': False}
            
            if openai_response['success']:
                return success_response({
                    'feedback': openai_response['reply']
                })
            else:
                # Fallback feedback если OpenAI не отвечает
                fallback_feedback = """🎉 **Отличная работа!**

Спасибо за интересный диалог! Вы показали хорошие навыки общения на английском языке.

📊 **Ваши результаты:**
- **Письмо:** 85/100
- **Словарный запас:** 80/100  
- **Грамматика:** 90/100

💡 Продолжайте практиковаться - у вас отличный прогресс! 🚀"""
                
                return success_response({
                    'feedback': fallback_feedback
                })
                
        except Exception as e:
            print(f"Error generating dialog feedback: {e}")
            return error_response(f'Failed to generate feedback: {str(e)}')
    
    # 9. Установка режима ИИ для пользователя
    if 'action' in body and body['action'] == 'set_ai_mode':
        user_id = body.get('user_id')
        mode = body.get('mode')
        
        if not user_id or not mode:
            return error_response('user_id and mode are required')
        
        try:
            print(f"Setting AI mode '{mode}' for user {user_id}")
            
            # Сохраняем режим в Supabase
            update_data = {'ai_mode': mode}
            data_json = json.dumps(update_data)
            
            req = urllib.request.Request(
                f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}",
                data=data_json.encode('utf-8'),
                headers={
                    'apikey': supabase_key,
                    'Authorization': f'Bearer {supabase_key}',
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                method='PATCH'
            )
            
            with urllib.request.urlopen(req) as response:
                print(f"AI mode '{mode}' saved to Supabase for user {user_id}")
                return success_response({
                    'mode_set': mode,
                    'message': f'AI mode set to {mode}'
                })
                
        except Exception as e:
            print(f"Error setting AI mode: {e}")
            return error_response(f'Failed to set AI mode: {str(e)}')
    
    # New action 'get_ai_mode' - get mode from Supabase
    if 'action' in body and body['action'] == 'get_ai_mode':
        user_id = body.get('user_id')

        if not user_id:
            return error_response('user_id is required')

        try:
            print(f"Getting AI mode for user {user_id}")
            
            # Получаем режим из Supabase
            req = urllib.request.Request(
                f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=ai_mode",
                headers={
                    'apikey': supabase_key,
                    'Authorization': f'Bearer {supabase_key}',
                    'Content-Type': 'application/json'
                }
            )
            
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                if response_text:
                    users = json.loads(response_text)
                    if users:
                        ai_mode = users[0].get('ai_mode', 'translation')
                        print(f"Retrieved AI mode '{ai_mode}' for user {user_id}")
                        return success_response({
                            'ai_mode': ai_mode
                        })
                    else:
                        print(f"User {user_id} not found, returning default mode")
                        return success_response({
                            'ai_mode': 'translation'
                        })
                else:
                    print(f"Empty response from Supabase for user {user_id}")
                    return success_response({
                        'ai_mode': 'translation'
                    })

        except Exception as e:
            print(f"Error getting AI mode: {e}")
            return success_response({
                'ai_mode': 'translation'  # Fallback to default
            })
    
    # New action 'get_user_level' - get user's language level from survey
    if 'action' in body and body['action'] == 'get_user_level':
        telegram_id = body.get('telegram_id')
        
        if not telegram_id:
            return error_response('telegram_id is required')
        
        try:
            print(f"Getting user level for telegram_id: {telegram_id}")
            
            # Get user level from user_survey table
            req = urllib.request.Request(
                f"{supabase_url}/rest/v1/user_survey?telegram_id=eq.{telegram_id}&select=language_level",
                headers={
                    'apikey': supabase_key,
                    'Authorization': f'Bearer {supabase_key}',
                    'Content-Type': 'application/json'
                }
            )
            
            with urllib.request.urlopen(req) as response:
                response_text = response.read().decode('utf-8')
                if response_text:
                    surveys = json.loads(response_text)
                    if surveys:
                        level = surveys[0].get('language_level', 'Intermediate')
                        print(f"Retrieved level '{level}' for user {telegram_id}")
                        return success_response({
                            'level': level
                        })
                    else:
                        print(f"No survey found for user {telegram_id}, returning default")
                        return success_response({
                            'level': 'Intermediate'
                        })
                else:
                    print(f"Empty response from Supabase for user {telegram_id}")
                    return success_response({
                        'level': 'Intermediate'
                    })

        except Exception as e:
            print(f"Error getting user level: {e}")
            return success_response({
                'level': 'Intermediate'  # Fallback to default
            })
    
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

def check_text_trial_access(user_id, supabase_url, supabase_key):
    """Проверяет доступ к текстовому помощнику"""
    try:
        url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=text_trial_ends_at,package_expires_at,interface_language"
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'apikey': supabase_key
        }
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            
            if response_text:
                users = json.loads(response_text)
                if users:
                    user = users[0]
                    text_trial_ends_at = user.get('text_trial_ends_at')
                    package_expires_at = user.get('package_expires_at')
                    interface_language = user.get('interface_language', 'ru')
                    
                    now = datetime.now()
                    has_access = False
                    
                    # Проверяем text_trial_ends_at
                    if text_trial_ends_at:
                        try:
                            trial_end = datetime.fromisoformat(text_trial_ends_at.replace('Z', '+00:00'))
                            trial_now = datetime.now(trial_end.tzinfo) if trial_end.tzinfo else datetime.now()
                            if trial_now < trial_end:
                                has_access = True
                        except Exception as e:
                            print(f"Error parsing text_trial_ends_at: {e}")
                    
                    # Проверяем package_expires_at
                    if not has_access and package_expires_at:
                        try:
                            package_end = datetime.fromisoformat(package_expires_at.replace('Z', '+00:00'))
                            package_now = datetime.now(package_end.tzinfo) if package_end.tzinfo else datetime.now()
                            if package_now < package_end:
                                has_access = True
                        except Exception as e:
                            print(f"Error parsing package_expires_at: {e}")
                    
                    if has_access:
                        return {'has_access': True}
                    
                    # Нет доступа - вернуть локализованное сообщение
                    if interface_language == 'en':
                        message = "🔒 Your free text assistant trial has ended. Upgrade to continue getting help with English!"
                    else:
                        message = "🔒 Пробный период текстового помощника закончился. Оформите подписку, чтобы продолжить изучение английского!"
                    
                    return {'has_access': False, 'message': message}
        
        # Пользователь не найден
        return {'has_access': False, 'message': 'User not found. Please complete onboarding first with /start'}
        
    except Exception as e:
        print(f"Error checking text trial access: {e}")
        return {'has_access': False, 'message': 'Error checking access. Please try again.'}

def get_openai_response(message, mode='general'):
    """Получает ответ от OpenAI API с поддержкой разных режимов"""
    try:        
        # OpenAI API endpoint
        url = "https://api.openai.com/v1/chat/completions"
        
        # Получаем API ключ из переменных окружения
        openai_api_key = os.getenv('OPENAI_API_KEY')
        if not openai_api_key:
            return {'success': False, 'error': 'OpenAI API key not configured'}
        
        # Системные промпты для разных режимов
        system_prompts = {
            'translation': """You are a bilingual translation bot. Your only task is to automatically translate each incoming message:

If the message is in Russian → translate it into English.

If the message is in English → translate it into Russian.

Do not add explanations, comments, or extra text.
Do not ask questions or start conversations.
Only return the translated text, nothing else.""",
            
            'grammar': """You are the Grammar mode of a language-learning bot.
Your only task is to answer questions about English grammar.

Rules of behavior:

Treat broadly: any question about usage of words, forms, structures, or patterns in English (including prepositions, articles, tense choice, word order, conditionals, etc.) counts as grammar.

Only if the question is 100% unrelated to English grammar (e.g., "translate this text," "tell me about New York") → reply once: Этот режим отвечает только на вопросы о грамматике английского языка.

If the question is vague but grammar-related → ask one clarifying question.

If the question is clear → give a structured explanation immediately.

CRITICAL LANGUAGE RULE:

ALWAYS answer in the SAME language the user used for their question:
- If user writes in Russian → answer in Russian
- If user writes in English → answer in English  

Use English ONLY for examples and grammar terms.

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

IMPORTANT: Use single asterisks *word* for bold, not double **word** which may break Telegram parsing""",
            
            'text_dialog': """You are a friendly English conversation partner for structured dialog practice.

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

||Это звучит как потрясающая поездка! Какой момент больше всего запомнился во время отпуска? Пробовали ли вы местную еду, которая вас удивила?||""",
            
            'audio_dialog': "You are an English speaking coach. Focus on pronunciation tips, speaking practice, and conversational skills.",
            
            'general': """You are a concise English tutor. 
Only answer questions about English: grammar, vocabulary, translations, writing texts, interviews. 
If the question is not about English, respond: "I can only help with English. Try asking something about grammar, vocabulary, or translation"."""
        }
        
        system_prompt = system_prompts.get(mode, system_prompts['general'])
        print(f"Using AI mode: {mode}")
        
        # Подготавливаем данные для API
        data = {
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            "max_tokens": 500,
            "temperature": 0.7
        }
        
        headers = {
            'Authorization': f'Bearer {openai_api_key}',
            'Content-Type': 'application/json'
        }
        
        # Отправляем запрос
        req = urllib.request.Request(
            url, 
            data=json.dumps(data).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            response_data = json.loads(response_text)
            
            if 'choices' in response_data and response_data['choices']:
                reply = response_data['choices'][0]['message']['content'].strip()
                return {'success': True, 'reply': reply, 'mode': mode}
            else:
                return {'success': False, 'error': 'No response from OpenAI'}
                
    except Exception as e:
        print(f"Error getting OpenAI response: {e}")
        return {'success': False, 'error': str(e)}

def log_text_usage(user_id, supabase_url, supabase_key):
    """Логирует использование текстового помощника"""
    try:
        # 1. Обновляем общие счетчики пользователя
        url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}"
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {supabase_key}',
            'apikey': supabase_key
        }
        
        # Получаем текущие значения
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            if response_text:
                users = json.loads(response_text)
                if users:
                    user = users[0]
                    current_total = user.get('text_messages_total', 0)
                    
                    # Обновляем счетчики
                    update_data = {
                        'text_messages_total': current_total + 1,
                        'last_text_used_at': datetime.now().isoformat()
                    }
                    
                    req_update = urllib.request.Request(
                        url, 
                        data=json.dumps(update_data).encode('utf-8'),
                        headers=headers,
                        method='PATCH'
                    )
                    
                    with urllib.request.urlopen(req_update) as update_response:
                        print(f"User text usage updated for {user_id}")
        
        # 2. UPSERT в daily usage таблицу через raw SQL
        # Получаем user UUID для foreign key
        user_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=id"
        req_user = urllib.request.Request(user_url, headers=headers)
        
        with urllib.request.urlopen(req_user) as response:
            response_text = response.read().decode('utf-8')
            if response_text:
                users = json.loads(response_text)
                if users:
                    user_uuid = users[0]['id']
                    
                    # Используем POST с upsert для daily usage
                    daily_url = f"{supabase_url}/rest/v1/text_usage_daily"
                    daily_headers = {
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {supabase_key}',
                        'apikey': supabase_key,
                        'Prefer': 'resolution=merge-duplicates'
                    }
                    
                    today = datetime.now().date().isoformat()
                    daily_data = {
                        'user_id': user_uuid,
                        'day': today,
                        'messages': 1
                    }
                    
                    req_daily = urllib.request.Request(
                        daily_url, 
                        data=json.dumps(daily_data).encode('utf-8'),
                        headers=daily_headers,
                        method='POST'
                    )
                    
                    with urllib.request.urlopen(req_daily) as daily_response:
                        print(f"Daily text usage logged for {user_id}")
            
    except Exception as e:
        print(f"Error logging text usage: {e}")
        # Не возвращаем ошибку, так как это не критично для пользователя
# Lambda deployment trigger comment - updated for grammar spoilers fix
