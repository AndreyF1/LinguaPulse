# 🚀 Deployment Guide: Cloudflare Pages

## Prerequisites
- ✅ Cloudflare account with `linguapulse.ai` domain
- ✅ GitHub repository connected
- ✅ Gemini API Key

---

## 📋 Step-by-Step Deployment

### 1️⃣ **Login to Cloudflare Dashboard**
1. Go to: https://dash.cloudflare.com
2. Navigate to: **Workers & Pages** (left sidebar)
3. Click: **Create application** → **Pages** → **Connect to Git**

---

### 2️⃣ **Connect GitHub Repository**
1. Select repository: **`AndreyF1/LinguaPulse`**
2. Click: **Begin setup**

---

### 3️⃣ **Configure Build Settings**

#### **Project Name:**
```
linguapulse-web
```

#### **Production Branch:**
```
main
```

#### **Framework Preset:**
```
Vite
```

#### **Build Command:**
```
cd web-app/frontend && npm install && npm run build
```

#### **Build Output Directory:**
```
web-app/frontend/dist
```

#### **Root Directory (optional):**
Leave empty (we handle path in build command)

---

### 4️⃣ **Set Environment Variables**

Click **Add variable** and add:

| Variable Name      | Value                                      |
|--------------------|--------------------------------------------|
| `GEMINI_API_KEY`   | `AIzaSyBRp8FXE_lU1-jIlQvUZvrR6qSna1d_i-E` |
| `NODE_VERSION`     | `20`                                       |

> ⚠️ **Important**: These values are encrypted and secure in Cloudflare.

---

### 5️⃣ **Deploy**
1. Click: **Save and Deploy**
2. Wait 2-3 minutes for first build
3. Cloudflare will provide a temporary URL like: `linguapulse-web.pages.dev`

---

### 6️⃣ **Connect Custom Domain**

#### **Option A: Subdomain (e.g., `app.linguapulse.ai`)**
1. In Cloudflare Pages project → **Custom domains**
2. Click: **Set up a custom domain**
3. Enter: `app.linguapulse.ai`
4. Cloudflare will auto-configure DNS (domain is already in Cloudflare)
5. Wait 1-2 minutes for SSL certificate

#### **Option B: Root domain (`linguapulse.ai`)**
1. In Cloudflare Pages project → **Custom domains**
2. Click: **Set up a custom domain**
3. Enter: `linguapulse.ai`
4. Cloudflare will auto-configure DNS
5. Wait 1-2 minutes for SSL certificate

> 💡 **Recommendation**: Use subdomain `app.linguapulse.ai` for the app, keep root domain for marketing site.

---

## 🔄 Automatic Deployments

Once configured, **every push to `main` branch** triggers automatic deployment:
1. You push code to GitHub
2. Cloudflare detects the push
3. Runs build command
4. Deploys to production
5. Updates `linguapulse.ai` instantly

---

## 🧪 Preview Deployments

**Every Pull Request** gets a unique preview URL:
- Test changes before merging
- Share with team for review
- No impact on production

---

## 📊 Monitoring

### **View Deployment Logs:**
1. Cloudflare Dashboard → **Workers & Pages**
2. Select: **linguapulse-web**
3. View: **Deployments** tab
4. Click any deployment to see logs

### **Analytics:**
- **Web Analytics**: Cloudflare provides built-in analytics
- **Error Tracking**: Check browser console and Cloudflare logs

---

## 🛠️ Troubleshooting

### **Build Fails:**
```bash
# Test build locally first:
cd web-app/frontend
npm install
npm run build

# Check logs in Cloudflare Dashboard
```

### **Environment Variables Not Working:**
- Make sure `GEMINI_API_KEY` is set in Cloudflare Pages settings
- Re-deploy after adding variables (click "Retry deployment")

### **404 on Routes:**
- Check that `_redirects` file is copied to `dist/`
- Run build locally and verify `dist/_redirects` exists

### **Node Version Issues:**
- `.node-version` file forces Node 20
- If issues persist, set `NODE_VERSION=20` in Cloudflare env vars

---

## 🔒 Security Notes

1. **Never commit `.env` files** - they're in `.gitignore`
2. **Gemini API Key** is encrypted in Cloudflare
3. **Supabase credentials** are currently hardcoded in `supabaseClient.ts`
   - TODO: Move to environment variables for production

---

## 🚀 Next Steps After Deployment

1. ✅ Test the deployed app: `https://app.linguapulse.ai`
2. ✅ Verify Magic Link auth works
3. ✅ Test Gemini voice conversation
4. ✅ Check Supabase connection
5. ⚠️ Move Supabase credentials to environment variables
6. 📊 Enable Cloudflare Web Analytics

---

## 📞 Support

- **Cloudflare Docs**: https://developers.cloudflare.com/pages/
- **Vite Docs**: https://vitejs.dev/guide/
- **Project Issues**: Check GitHub Issues tab

---

**Deployed by**: Cloudflare Pages  
**Last Updated**: 2025-10-28  
**Status**: ✅ Production Ready

