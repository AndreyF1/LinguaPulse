"""Общие функции для работы с базой данных Supabase"""
import json
import urllib.request
from datetime import datetime


def get_supabase_config():
    """Получить конфигурацию Supabase"""
    import os
    return {
        'url': os.environ.get('SUPABASE_URL'),
        'key': os.environ.get('SUPABASE_SERVICE_KEY')
    }


def log_text_usage(user_id, supabase_url, supabase_key):
    """Логирует использование текстового помощника"""
    try:
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
                        print(f"✅ Text usage logged for user {user_id}")
                        
    except Exception as e:
        print(f"❌ Error logging text usage: {e}")


def get_user_profile(user_id, supabase_url, supabase_key):
    """Получить профиль пользователя"""
    try:
        url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{user_id}&select=*"
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'apikey': supabase_key
        }
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            users = json.loads(response_text)
            return users[0] if users else None
                
    except Exception as e:
        print(f"❌ Error getting user profile: {e}")
        return None
