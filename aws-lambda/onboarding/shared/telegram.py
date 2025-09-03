"""
Telegram API client for LinguaPulse
"""
import os
import json
import requests
from typing import Optional, Dict, Any, List

class TelegramClient:
    def __init__(self):
        self.bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
        
        if not self.bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN must be set")
        
        self.base_url = f"https://api.telegram.org/bot{self.bot_token}"
    
    def send_message(self, chat_id: int, text: str, parse_mode: str = None, 
                    reply_markup: Dict = None) -> bool:
        """Send message to Telegram chat"""
        try:
            payload = {
                'chat_id': chat_id,
                'text': text
            }
            
            if parse_mode:
                payload['parse_mode'] = parse_mode
            
            if reply_markup:
                payload['reply_markup'] = json.dumps(reply_markup)
            
            response = requests.post(
                f"{self.base_url}/sendMessage",
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                return True
            else:
                print(f"Telegram API error: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"Error sending message to {chat_id}: {e}")
            return False
    
    def answer_callback_query(self, callback_query_id: str, text: str = None) -> bool:
        """Answer callback query"""
        try:
            payload = {
                'callback_query_id': callback_query_id
            }
            
            if text:
                payload['text'] = text
            
            response = requests.post(
                f"{self.base_url}/answerCallbackQuery",
                json=payload,
                timeout=10
            )
            
            return response.status_code == 200
            
        except Exception as e:
            print(f"Error answering callback query {callback_query_id}: {e}")
            return False
    
    def edit_message_text(self, chat_id: int, message_id: int, text: str, 
                         parse_mode: str = None, reply_markup: Dict = None) -> bool:
        """Edit message text"""
        try:
            payload = {
                'chat_id': chat_id,
                'message_id': message_id,
                'text': text
            }
            
            if parse_mode:
                payload['parse_mode'] = parse_mode
            
            if reply_markup:
                payload['reply_markup'] = json.dumps(reply_markup)
            
            response = requests.post(
                f"{self.base_url}/editMessageText",
                json=payload,
                timeout=10
            )
            
            return response.status_code == 200
            
        except Exception as e:
            print(f"Error editing message {message_id}: {e}")
            return False

# Global instance
telegram = TelegramClient()
