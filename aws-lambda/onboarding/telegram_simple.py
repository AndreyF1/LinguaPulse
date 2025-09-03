"""
Simple Telegram API client for LinguaPulse (without external dependencies)
"""
import os
import json
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any, List

class TelegramClient:
    def __init__(self):
        self.bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
        
        if not self.bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN must be set")
        
        self.base_url = f"https://api.telegram.org/bot{self.bot_token}"
    
    def _make_request(self, method: str, endpoint: str, data: Dict = None) -> bool:
        """Make HTTP request to Telegram API"""
        url = f"{self.base_url}/{endpoint}"
        
        if data:
            data = json.dumps(data).encode('utf-8')
        
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method=method)
        
        try:
            with urllib.request.urlopen(req) as response:
                result = response.read().decode('utf-8')
                response_data = json.loads(result)
                return response_data.get('ok', False)
        except Exception as e:
            print(f"Telegram API error: {e}")
            return False
    
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
            
            return self._make_request('POST', 'sendMessage', payload)
                
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
            
            return self._make_request('POST', 'answerCallbackQuery', payload)
            
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
            
            return self._make_request('POST', 'editMessageText', payload)
            
        except Exception as e:
            print(f"Error editing message {message_id}: {e}")
            return False

# Global instance
telegram = TelegramClient()
