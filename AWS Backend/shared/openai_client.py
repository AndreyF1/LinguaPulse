"""Общий клиент для работы с OpenAI API"""
import json
import urllib.request
import os


def get_openai_response(message, system_prompt=None, model='gpt-4o-mini', temperature=0.7, max_tokens=1000):
    """Получить ответ от OpenAI API"""
    try:
        openai_api_key = os.environ.get('OPENAI_API_KEY')
        if not openai_api_key:
            return {'success': False, 'error': 'OpenAI API key not found'}
        
        # Формируем сообщения
        messages = []
        if system_prompt:
            messages.append({'role': 'system', 'content': system_prompt})
        messages.append({'role': 'user', 'content': message})
        
        # Подготавливаем запрос
        data = {
            'model': model,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': max_tokens
        }
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {openai_api_key}'
        }
        
        # Отправляем запрос
        req = urllib.request.Request(
            'https://api.openai.com/v1/chat/completions',
            data=json.dumps(data).encode('utf-8'),
            headers=headers
        )
        
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            response_data = json.loads(response_text)
            
            if 'choices' in response_data and response_data['choices']:
                reply = response_data['choices'][0]['message']['content'].strip()
                return {'success': True, 'reply': reply}
            else:
                return {'success': False, 'error': 'No response from OpenAI'}
                
    except Exception as e:
        print(f"❌ OpenAI API error: {e}")
        return {'success': False, 'error': str(e)}
