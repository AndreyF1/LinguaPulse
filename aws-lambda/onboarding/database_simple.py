"""
Simple Supabase database client for LinguaPulse (without external dependencies)
"""
import os
import json
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

class SupabaseClient:
    def __init__(self):
        self.url = os.environ.get("SUPABASE_URL")
        self.key = os.environ.get("SUPABASE_ANON_KEY")
        
        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
        
        self.base_url = f"{self.url}/rest/v1"
        self.headers = {
            'apikey': self.key,
            'Authorization': f'Bearer {self.key}',
            'Content-Type': 'application/json'
        }
    
    def _make_request(self, method: str, endpoint: str, data: Dict = None) -> Dict:
        """Make HTTP request to Supabase"""
        url = f"{self.base_url}/{endpoint}"
        
        if data:
            data = json.dumps(data).encode('utf-8')
        
        req = urllib.request.Request(url, data=data, headers=self.headers, method=method)
        
        try:
            with urllib.request.urlopen(req) as response:
                result = response.read().decode('utf-8')
                return json.loads(result) if result else []
        except urllib.error.HTTPError as e:
            print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
            return []
        except Exception as e:
            print(f"Request error: {e}")
            return []
    
    def get_user_by_telegram_id(self, telegram_id: int) -> Optional[Dict[str, Any]]:
        """Get user by telegram_id"""
        try:
            result = self._make_request('GET', f'users?telegram_id=eq.{telegram_id}&select=*')
            return result[0] if result else None
        except Exception as e:
            print(f"Error getting user by telegram_id {telegram_id}: {e}")
            return None
    
    def create_user(self, telegram_id: int, username: str = None, interface_language: str = 'en') -> Optional[Dict[str, Any]]:
        """Create new user"""
        try:
            user_data = {
                'telegram_id': telegram_id,
                'username': username,
                'interface_language': interface_language,
                'lessons_left': 0,
                'total_lessons_completed': 0,
                'current_streak': 0,
                'is_active': True
            }
            
            result = self._make_request('POST', 'users', user_data)
            return result[0] if result else None
        except Exception as e:
            print(f"Error creating user {telegram_id}: {e}")
            return None
    
    def update_user_language(self, telegram_id: int, language: str) -> bool:
        """Update user's interface language"""
        try:
            data = {'interface_language': language}
            result = self._make_request('PATCH', f'users?telegram_id=eq.{telegram_id}', data)
            return len(result) > 0
        except Exception as e:
            print(f"Error updating user language {telegram_id}: {e}")
            return False
    
    def update_user_survey(self, telegram_id: int, language_level: str) -> bool:
        """Update user's language level from survey"""
        try:
            data = {
                'current_level': language_level,
                'quiz_completed_at': datetime.utcnow().isoformat()
            }
            result = self._make_request('PATCH', f'users?telegram_id=eq.{telegram_id}', data)
            return len(result) > 0
        except Exception as e:
            print(f"Error updating user survey {telegram_id}: {e}")
            return False
    
    def grant_starter_pack(self, telegram_id: int) -> bool:
        """Grant starter pack (3 lessons for 3 days) to user"""
        try:
            # Get starter pack product
            starter_pack = self.get_product_by_id('7d9d5dbb-7ed2-4bdc-9d2f-c88929085ab5')
            if not starter_pack:
                print("Starter pack product not found")
                return False
            
            # Calculate expiry date (3 days from now)
            expiry_date = datetime.utcnow() + timedelta(days=starter_pack['duration_days'])
            
            # Update user with starter pack
            data = {
                'lessons_left': starter_pack['lessons_granted'],
                'package_expires_at': expiry_date.isoformat()
            }
            result = self._make_request('PATCH', f'users?telegram_id=eq.{telegram_id}', data)
            return len(result) > 0
        except Exception as e:
            print(f"Error granting starter pack to {telegram_id}: {e}")
            return False
    
    def get_product_by_id(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get product by ID"""
        try:
            result = self._make_request('GET', f'products?id=eq.{product_id}&select=*')
            return result[0] if result else None
        except Exception as e:
            print(f"Error getting product {product_id}: {e}")
            return None
    
    def get_active_products(self) -> List[Dict[str, Any]]:
        """Get all active products"""
        try:
            result = self._make_request('GET', 'products?is_active=eq.true&select=*')
            return result if result else []
        except Exception as e:
            print(f"Error getting active products: {e}")
            return []

# Global instance
db = SupabaseClient()
