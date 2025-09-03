"""
AWS Lambda function for LinguaPulse onboarding (replaces newbies-funnel.js)
Handles language selection and mini-survey with new package-based logic
"""
import json
import os
import sys
from typing import Dict, Any

# Add shared modules to path
sys.path.append('/opt/python')
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'shared'))

from database import db
from telegram import telegram

# Localization texts
TEXTS = {
    'en': {
        'welcome': "👋 Hello! I'm LinguaPulse, an AI teacher created to help you learn English.\n\n🌍 What language should I use for the interface?",
        'language_selected': "Great! Now let's determine your English level with a quick survey.",
        'survey_question_1': "How would you describe your current English level?",
        'survey_question_2': "What's your main goal with English?",
        'survey_question_3': "How often do you practice English?",
        'survey_complete': "🎉 Perfect! You've completed the survey.\n\n🎁 As a welcome gift, you've received a **Starter Pack**:\n• 3 free lessons\n• Valid for 3 days\n• Start whenever you want\n\nUse /lesson to see your lessons and start practicing!",
        'error': "Sorry, something went wrong. Please try again later."
    },
    'ru': {
        'welcome': "👋 Привет! Я LinguaPulse, AI учитель, созданный для помощи в изучении английского языка.\n\n🌍 На каком языке оставить интерфейс?",
        'language_selected': "Отлично! Теперь давайте определим ваш уровень английского с помощью быстрого опроса.",
        'survey_question_1': "Как бы вы описали свой текущий уровень английского?",
        'survey_question_2': "Какова ваша основная цель с английским?",
        'survey_question_3': "Как часто вы практикуете английский?",
        'survey_complete': "🎉 Отлично! Вы завершили опрос.\n\n🎁 В качестве приветственного подарка вы получили **Стартовый пакет**:\n• 3 бесплатных урока\n• Действителен 3 дня\n• Начинайте когда захотите\n\nИспользуйте /lesson чтобы увидеть ваши уроки и начать практику!",
        'error': "Извините, произошла ошибка. Попробуйте позже."
    }
}

def get_text(language: str, key: str) -> str:
    """Get localized text"""
    return TEXTS.get(language, TEXTS['en']).get(key, key)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for onboarding
    """
    try:
        print(f"Onboarding Lambda received event: {json.dumps(event)}")
        
        # Extract data from event
        raw_data = event.get('body')
        if isinstance(raw_data, str):
            raw_data = json.loads(raw_data)
        
        chat_id = raw_data.get('user_id') or raw_data.get('message', {}).get('chat', {}).get('id')
        if not chat_id:
            print("No chat_id found in event")
            return {'statusCode': 400, 'body': 'No chat_id found'}
        
        # Handle different action types
        action = raw_data.get('action')
        
        if action == 'start_onboarding':
            return handle_start_onboarding(chat_id, raw_data)
        elif raw_data.get('callback_query', {}).get('data', '').startswith('language:'):
            return handle_language_selection(chat_id, raw_data)
        elif raw_data.get('callback_query', {}).get('data', '').startswith('survey:'):
            return handle_survey_response(chat_id, raw_data)
        else:
            print(f"Unknown action: {action}")
            return {'statusCode': 400, 'body': 'Unknown action'}
            
    except Exception as e:
        print(f"Error in onboarding Lambda: {e}")
        return {'statusCode': 500, 'body': 'Internal server error'}

def handle_start_onboarding(chat_id: int, raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle start onboarding action"""
    try:
        # Check if user already exists and completed survey
        user = db.get_user_by_telegram_id(chat_id)
        
        if user and user.get('quiz_completed_at'):
            # User already completed onboarding
            telegram.send_message(
                chat_id, 
                "Welcome back! Use /lesson to see your learning options.",
                parse_mode='Markdown'
            )
            return {'statusCode': 200, 'body': 'User already onboarded'}
        
        # Check if user has language preference
        if user and user.get('interface_language'):
            # User has language, start survey
            return start_survey(chat_id, user['interface_language'])
        
        # New user - send language selection
        welcome_text = get_text('en', 'welcome') + "\n\n" + get_text('ru', 'welcome')
        
        reply_markup = {
            'inline_keyboard': [[
                {'text': '🇷🇺 Русский', 'callback_data': 'language:ru'},
                {'text': '🇺🇸 English', 'callback_data': 'language:en'}
            ]]
        }
        
        telegram.send_message(chat_id, welcome_text, reply_markup=reply_markup)
        return {'statusCode': 200, 'body': 'Language selection sent'}
        
    except Exception as e:
        print(f"Error in handle_start_onboarding: {e}")
        return {'statusCode': 500, 'body': 'Error starting onboarding'}

def handle_language_selection(chat_id: int, raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle language selection callback"""
    try:
        callback_data = raw_data.get('callback_query', {}).get('data', '')
        language = callback_data.split(':')[1]
        
        # Answer callback query
        callback_query_id = raw_data.get('callback_query', {}).get('id')
        if callback_query_id:
            telegram.answer_callback_query(callback_query_id)
        
        # Create or update user with language preference
        user = db.get_user_by_telegram_id(chat_id)
        if not user:
            # Create new user
            username = raw_data.get('message', {}).get('from', {}).get('username')
            db.create_user(chat_id, username, language)
        else:
            # Update existing user
            db.update_user_language(chat_id, language)
        
        # Start survey
        return start_survey(chat_id, language)
        
    except Exception as e:
        print(f"Error in handle_language_selection: {e}")
        return {'statusCode': 500, 'body': 'Error handling language selection'}

def start_survey(chat_id: int, language: str) -> Dict[str, Any]:
    """Start the survey"""
    try:
        # Send survey start message
        message = get_text(language, 'language_selected')
        
        # Survey questions with options
        survey_questions = {
            'en': {
                'question_1': "How would you describe your current English level?",
                'options_1': [
                    {'text': 'Beginner', 'callback_data': 'survey:level:beginner'},
                    {'text': 'Intermediate', 'callback_data': 'survey:level:intermediate'},
                    {'text': 'Advanced', 'callback_data': 'survey:level:advanced'}
                ]
            },
            'ru': {
                'question_1': "Как бы вы описали свой текущий уровень английского?",
                'options_1': [
                    {'text': 'Начинающий', 'callback_data': 'survey:level:beginner'},
                    {'text': 'Средний', 'callback_data': 'survey:level:intermediate'},
                    {'text': 'Продвинутый', 'callback_data': 'survey:level:advanced'}
                ]
            }
        }
        
        question_text = survey_questions[language]['question_1']
        options = survey_questions[language]['options_1']
        
        reply_markup = {
            'inline_keyboard': [options]
        }
        
        telegram.send_message(chat_id, f"{message}\n\n{question_text}", reply_markup=reply_markup)
        return {'statusCode': 200, 'body': 'Survey started'}
        
    except Exception as e:
        print(f"Error in start_survey: {e}")
        return {'statusCode': 500, 'body': 'Error starting survey'}

def handle_survey_response(chat_id: int, raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle survey response"""
    try:
        callback_data = raw_data.get('callback_query', {}).get('data', '')
        callback_query_id = raw_data.get('callback_query', {}).get('id')
        
        # Answer callback query
        if callback_query_id:
            telegram.answer_callback_query(callback_query_id)
        
        # Parse survey response
        if callback_data.startswith('survey:level:'):
            level = callback_data.split(':')[2]
            
            # Update user with language level
            db.update_user_survey(chat_id, level)
            
            # Grant starter pack
            db.grant_starter_pack(chat_id)
            
            # Get user language for final message
            user = db.get_user_by_telegram_id(chat_id)
            user_language = user.get('interface_language', 'en') if user else 'en'
            
            # Send completion message
            completion_message = get_text(user_language, 'survey_complete')
            telegram.send_message(chat_id, completion_message, parse_mode='Markdown')
            
            return {'statusCode': 200, 'body': 'Survey completed and starter pack granted'}
        
        return {'statusCode': 400, 'body': 'Invalid survey response'}
        
    except Exception as e:
        print(f"Error in handle_survey_response: {e}")
        return {'statusCode': 500, 'body': 'Error handling survey response'}
