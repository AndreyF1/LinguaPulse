#!/usr/bin/env python3
"""
Тест для проверки обновления streak полей
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta

def test_update_streak():
    """Тестируем обновление streak"""
    
    # Данные для теста
    test_user_id = 123456789  # Замените на реальный telegram_id
    supabase_url = "https://qpqwyvzpwwwyolnvtglw.supabase.co"
    supabase_key = "sb_secret_lghNz..."  # Замените на реальный ключ
    
    print(f"Testing streak update for user {test_user_id}")
    
    # 1. Получаем текущие данные пользователя
    url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{test_user_id}&select=current_streak,last_lesson_date"
    headers = {
        'Authorization': f'Bearer {supabase_key}',
        'apikey': supabase_key
    }
    
    print(f"Request URL: {url}")
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            print(f"Response: {response_text}")
            
            if response_text:
                users = json.loads(response_text)
                print(f"Found {len(users)} users")
                
                if users:
                    user_data = users[0]
                    current_streak = user_data.get('current_streak', 0)
                    last_lesson_date = user_data.get('last_lesson_date')
                    print(f"Current streak: {current_streak}")
                    print(f"Last lesson date: {last_lesson_date}")
                    
                    # 2. Обновляем streak
                    today = datetime.now().date()
                    new_streak = current_streak + 1
                    
                    update_url = f"{supabase_url}/rest/v1/users?telegram_id=eq.{test_user_id}"
                    update_data = json.dumps({
                        'current_streak': new_streak,
                        'last_lesson_date': today.isoformat()
                    }).encode('utf-8')
                    
                    update_headers = {
                        'Authorization': f'Bearer {supabase_key}',
                        'apikey': supabase_key,
                        'Content-Type': 'application/json'
                    }
                    
                    print(f"Updating streak to {new_streak}, date to {today}")
                    
                    update_req = urllib.request.Request(update_url, data=update_data, headers=update_headers, method='PATCH')
                    with urllib.request.urlopen(update_req) as update_response:
                        update_result = update_response.read().decode('utf-8')
                        print(f"Update result: {update_result}")
                        
                    # 3. Проверяем обновление
                    req2 = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req2) as response2:
                        response_text2 = response2.read().decode('utf-8')
                        print(f"After update: {response_text2}")
                        
                else:
                    print("User not found!")
            else:
                print("Empty response!")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_update_streak()
