import json
import os
import urllib.request
import urllib.parse

def lambda_handler(event, context):
    """
    Lambda функция с поддержкой Supabase
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
    
    # Простой ping test
    if 'test' in body:
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'message': 'Pong! Lambda is working'})
        }
    
    # Обработка onboarding
    if 'action' in body and body['action'] == 'start_onboarding':
        user_id = body.get('user_id', 'unknown')
        
        # Пытаемся создать пользователя в Supabase
        try:
            supabase_url = os.environ.get('SUPABASE_URL')
            supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
            
            if not supabase_url or not supabase_key:
                print("Supabase credentials not found")
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': 'Supabase not configured'})
                }
            
            # Создаем пользователя в Supabase
            user_data = {
                'telegram_id': user_id,
                'username': f'user_{user_id}',
                'interface_language': 'ru',
                'lessons_left': 3,
                'is_active': True
            }
            
            print(f"Creating user in Supabase: {user_data}")
            
            # Отправляем запрос в Supabase
            url = f"{supabase_url}/rest/v1/users"
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {supabase_key}',
                'apikey': supabase_key
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
                
                return {
                    'statusCode': 200,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({
                        'message': 'OK',
                        'message_sent': True,
                        'user_id': user_id,
                        'supabase_result': result
                    })
                }
                
        except urllib.error.HTTPError as e:
            if e.code == 409:  # Conflict - user already exists
                print(f"User {user_id} already exists in Supabase")
                return {
                    'statusCode': 200,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({
                        'message': 'OK',
                        'message_sent': True,
                        'user_id': user_id,
                        'supabase_result': {'status': 'user_exists'}
                    })
                }
            else:
                print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({
                        'error': f'HTTP Error {e.code}',
                        'message_sent': False
                    })
                }
        except Exception as e:
            print(f"Error creating user in Supabase: {e}")
            return {
                'statusCode': 500,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': f'Failed to create user: {str(e)}',
                    'message_sent': False
                })
            }
    
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'message': 'OK'})
    }
# Test comment
