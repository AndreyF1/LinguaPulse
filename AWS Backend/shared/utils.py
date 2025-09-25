"""Общие утилиты для Lambda функций"""
import json


def success_response(data):
    """Создать успешный ответ"""
    return {
        'statusCode': 200,
        'body': json.dumps({
            'success': True,
            **data
        })
    }


def error_response(error_message, status_code=400):
    """Создать ответ с ошибкой"""
    return {
        'statusCode': status_code,
        'body': json.dumps({
            'success': False,
            'error': error_message
        })
    }


def parse_request_body(event):
    """Парсинг тела запроса"""
    try:
        if isinstance(event.get('body'), str):
            return json.loads(event['body'])
        return event.get('body', {})
    except json.JSONDecodeError:
        return {}


def validate_required_fields(body, required_fields):
    """Проверка обязательных полей"""
    missing_fields = []
    for field in required_fields:
        if field not in body or not body[field]:
            missing_fields.append(field)
    
    if missing_fields:
        return f"Missing required fields: {', '.join(missing_fields)}"
    
    return None
