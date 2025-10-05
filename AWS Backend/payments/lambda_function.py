import os
import json
import base64
import hashlib
import hmac
from urllib.parse import parse_qs
from datetime import datetime, timedelta, timezone

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
YOOMONEY_SECRET = os.environ.get("YOOMONEY_WEBHOOK_SECRET", "")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# Маппинг пакета → дни/уроки
PKG = {
    "fe88e77a-7931-410d-8a74-5b0473798c6c": {"days": 30, "lessons": 30},  # 30 дней
    "551f676f-22e7-4c8c-ae7a-c5a8de655438": {"days": 14, "lessons": 10},  # 2 недели
    "3ec3f495-7257-466b-a0ba-bfac669a68c8": {"days": 3,  "lessons": 3},   # 3 дня
}

# Цены пакетов (в копейках) - для валидации
PRICE = {
    "fe88e77a-7931-410d-8a74-5b0473798c6c": 109000,  # 30 дней - 1090₽
    "551f676f-22e7-4c8c-ae7a-c5a8de655438": 59000,   # 2 недели - 590₽
    "3ec3f495-7257-466b-a0ba-bfac669a68c8": 200,     # 3 дня - 2₽ (для тестирования, вместо 14900)
}

def _response(status=200, body="OK"):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "text/plain"},
        "body": body,
    }

def notify_telegram(user_id, text):
    """Отправляем уведомление в Telegram пользователю"""
    try:
        bot_token = os.environ.get("BOT_TOKEN")
        if not bot_token:
            print(f"⚠️ BOT_TOKEN not set, skipping Telegram notification")
            return
        
        # Получаем telegram_id из user_id (UUID)
        telegram_id = None
        try:
            # Получаем telegram_id из Supabase
            url = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=telegram_id"
            headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
            r = requests.get(url, headers=headers, timeout=3)
            if r.status_code == 200:
                users = r.json()
                if users:
                    telegram_id = users[0].get('telegram_id')
        except Exception as e:
            print(f"⚠️ Error getting telegram_id: {e}")
            return
        
        if not telegram_id:
            print(f"⚠️ No telegram_id found for user {user_id}")
            return
        
        # Отправляем сообщение
        telegram_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": telegram_id,
            "text": text,
            "parse_mode": "Markdown"
        }
        
        r = requests.post(telegram_url, json=payload, timeout=4)
        if r.status_code == 200:
            print(f"✅ Telegram notification sent to {telegram_id}")
        else:
            print(f"⚠️ Telegram notification failed: {r.status_code} - {r.text}")
            
    except Exception as e:
        print(f"⚠️ Error sending Telegram notification: {e}")

def _sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()

def verify_signature(params: dict) -> bool:
    """
    Формула YooMoney для quickpay/wallet:
    sha1_hex(
      notification_type&operation_id&amount&currency&datetime&
      sender&codepro&secret&label
    )
    """
    if not YOOMONEY_SECRET:
        print("❌ YOOMONEY_WEBHOOK_SECRET not set, rejecting request")
        return False  # В продакшене обязательно

    pieces = [
        params.get("notification_type", ""),
        params.get("operation_id", ""),
        params.get("amount", ""),
        params.get("currency", ""),
        params.get("datetime", ""),
        params.get("sender", ""),
        params.get("codepro", ""),
        YOOMONEY_SECRET,
        params.get("label", ""),
    ]
    calc = _sha1_hex("&".join(pieces))
    received_hash = params.get("sha1_hash", "")
    
    print(f"🔐 Signature verification: calculated={calc}, received={received_hash}")
    return calc == received_hash

def parse_event_body(event) -> dict:
    """Достаём form-urlencoded тело из API Gateway event"""
    body = event.get("body", "") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8", errors="ignore")
    
    print(f"📦 Raw body: {body}")
    
    # parse_qs -> dict[str, list[str]]
    parsed = {k: v[0] for k, v in parse_qs(body).items()}
    print(f"📦 Parsed params: {parsed}")
    return parsed

def supabase_upsert_payment(order_id, user_id, product_id, amount, provider_operation_id, label, raw, status="paid"):
    """Записываем платеж в таблицу payments (идемпотентно)"""
    # Генерируем UUID на основе order_id для идемпотентности
    import uuid
    payment_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"yoomoney-{order_id}"))
    
    url = f"{SUPABASE_URL}/rest/v1/payments?on_conflict=id"
    payload = [{
        "id": payment_id,                # UUID для идемпотентности
        "user_id": user_id,
        "product_id": product_id,
        "amount": int(round(float(amount))) if amount else None,
        "status": status,
        "provider": "yoomoney",
        "provider_operation_id": provider_operation_id,
        "label": label,
        "raw": raw,
        "created_at": datetime.now(timezone.utc).isoformat()
    }]
    
    print(f"💰 Upserting payment: {payload}")
    try:
        r = requests.post(url, headers=HEADERS, data=json.dumps(payload), timeout=5)
        r.raise_for_status()
        print(f"✅ Payment recorded successfully")
    except requests.HTTPError as e:
        # Если дубликат по provider_operation_id - это нормально
        if e.response.status_code == 409:  # Conflict
            print(f"⚠️ Duplicate provider_operation_id: {provider_operation_id}")
            return "duplicate"
        else:
            raise e

def supabase_get_user(user_id):
    """Получаем данные пользователя"""
    url = f"{SUPABASE_URL}/rest/v1/users"
    params = {
        "id": f"eq.{user_id}",
        "select": "id,package_expires_at,lessons_left"
    }
    r = requests.get(url, headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}, params=params, timeout=5)
    r.raise_for_status()
    arr = r.json()
    return arr[0] if arr else None

def supabase_update_user(user_id, new_expiry_iso, new_lessons):
    """Обновляем доступ пользователя"""
    url = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}"
    payload = {
        "package_expires_at": new_expiry_iso,
        "lessons_left": new_lessons
    }
    
    print(f"👤 Updating user {user_id}: expiry={new_expiry_iso}, lessons={new_lessons}")
    r = requests.patch(url, headers=HEADERS, data=json.dumps(payload), timeout=5)
    r.raise_for_status()
    print(f"✅ User access updated successfully")

def lambda_handler(event, context):
    # Принудительное логирование для диагностики
    print("=" * 50)
    print("🚀 YOOMONEY WEBHOOK CALLED")
    print("=" * 50)
    print(f"Event: {json.dumps(event, default=str)}")
    print(f"Context: {json.dumps(vars(context), default=str)}")
    print("=" * 50)
    
    try:
        # 1) Распарсить form-data
        params = parse_event_body(event)
        
        # 2) Строгая проверка подписи
        if not verify_signature(params):
            print("❌ Signature verification failed")
            return _response(403, "Bad signature")
        
        # 3) Распаковать label = base64({"u","pkg","o"})
        lbl = params.get("label", "")
        try:
            info = json.loads(base64.b64decode(lbl).decode("utf-8"))
            user_id = info["u"]
            product_id = info["pkg"]
            order_id = info["o"]
            print(f"🏷️ Label decoded: user_id={user_id}, product_id={product_id}, order_id={order_id}")
        except Exception as e:
            print(f"❌ Error decoding label: {e}")
            return _response(400, "Bad label")
        
        # 4) Валидация суммы vs пакет
        amount = params.get("amount", "")
        exp_amount = PRICE.get(product_id)
        if exp_amount is None:
            print(f"❌ Unknown product_id: {product_id}")
            supabase_upsert_payment(order_id, user_id, product_id, amount, params.get("operation_id", ""), lbl, {"m": "unknown_product", "raw": params}, "failed")
            return _response(400, "Unknown product")
        
        if int(round(float(amount))) != exp_amount:
            print(f"❌ Amount mismatch: expected {exp_amount}, got {amount}")
            supabase_upsert_payment(order_id, user_id, product_id, amount, params.get("operation_id", ""), lbl, {"m": "amount_mismatch", "expected": exp_amount, "received": amount, "raw": params}, "failed")
            return _response(400, "Amount mismatch")
        
        # 5) Записать платёж в payments (идемпотентно)
        provider_operation_id = params.get("operation_id", "")
        try:
            result = supabase_upsert_payment(order_id, user_id, product_id, amount, provider_operation_id, lbl, params)
            if result == "duplicate":
                print(f"✅ Duplicate operation_id, returning OK")
                return _response(200, "Duplicate op_id")
        except Exception as e:
            print(f"❌ Database payments error: {e}")
            # Не валим вебхук - YooMoney будет ретраить
            return _response(200, "OK")
        
        # 6) Начислить доступ
        conf = PKG.get(product_id)
        if conf:
            print(f"📦 Package found: {conf}")
            try:
                urow = supabase_get_user(user_id)
                base_dt = datetime.now(timezone.utc)
                
                if urow and urow.get("package_expires_at"):
                    try:
                        cur = datetime.fromisoformat(urow["package_expires_at"].replace("Z", "+00:00"))
                        if cur > base_dt:
                            base_dt = cur
                            print(f"⏰ Extending existing subscription from {cur}")
                    except Exception as e:
                        print(f"⚠️ Error parsing existing expiry: {e}")
                
                new_expiry = base_dt + timedelta(days=conf["days"])
                new_lessons = (urow.get("lessons_left") if urow else 0) or 0
                new_lessons += conf["lessons"]
                
                supabase_update_user(user_id, new_expiry.isoformat(), new_lessons)
                print(f"🎉 Access granted: +{conf['days']} days, +{conf['lessons']} lessons")
                
                # 7) Уведомление в Telegram
                try:
                    notification_text = f"💳 *Оплата получена!* ✅\n\n+{conf['lessons']} уроков до {new_expiry.date()}\n\nПриятной практики! 🎯"
                    notify_telegram(user_id, notification_text)
                except Exception as e:
                    print(f"⚠️ Telegram notification error: {e}")
                
            except Exception as e:
                print(f"⚠️ Access grant error: {e}")
                # Не валим вебхук — платёж уже записан; доступ можно догнать ретраем
        else:
            print(f"⚠️ Unknown package ID: {product_id}")
        
        print(f"✅ Webhook processed successfully")
        return _response(200, "OK")
        
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        # Не валим вебхук - YooMoney будет ретраить
        return _response(200, "OK")
