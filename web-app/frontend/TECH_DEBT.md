# Technical Debt & Future Improvements

## 🔴 High Priority

### 1. Replace ScriptProcessorNode with AudioWorkletNode
**Status**: Deprecated API warning  
**File**: `components/ConversationScreen.tsx`

**Problem:**
```
[Deprecation] The ScriptProcessorNode is deprecated. 
Use AudioWorkletNode instead.
```

**Current code** (lines ~104, ~256):
```typescript
scriptProcessorRef.current = inputAudioContext.createScriptProcessor(4096, 1, 1);
```

**Solution:**
- Create AudioWorklet processor for audio capture
- Replace ScriptProcessorNode with AudioWorkletNode
- Benefits: Better performance, no main thread blocking

**Resources:**
- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- https://bit.ly/audio-worklet

**Estimated effort**: 3-4 hours

---

## 🟡 Medium Priority

### 2. Move Supabase credentials to environment variables
**Status**: Hardcoded in `supabaseClient.ts`  
**Security**: Low risk (anon key is public), but best practice

**Current:**
```typescript
const SUPABASE_URL = 'https://qpqwyvzpwwwyolnvtglw.supabase.co';
const supabaseAnonKey = 'eyJhbGci...'
```

**Solution:**
```typescript
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

---

### 3. Optimize bundle size (596KB)
**Status**: Large bundle warning from Vite

**Current:**
```
dist/assets/index-DX_uMzii.js  596.42 kB │ gzip: 153.55 kB
(!) Some chunks are larger than 500 kB
```

**Solutions:**
- Code splitting for routes (lazy load History/Conversation screens)
- Dynamic imports for heavy libraries (@google/genai, @supabase/supabase-js)
- Tree shaking optimization

**Estimated effort**: 2-3 hours

---

## 🟢 Low Priority / Nice-to-have

### 4. Add error boundaries
**Status**: No error boundaries in React tree

**Problem**: If component crashes, entire app white screens

**Solution**: Add ErrorBoundary components around major sections

---

### 5. Add loading skeletons
**Status**: Some screens show blank while loading

**Solution**: Replace loading spinners with skeleton UI for better perceived performance

---

### 6. Implement service worker for offline support
**Status**: App requires internet

**Benefits:**
- Cache static assets
- Offline fallback page
- Faster subsequent loads

---

### 7. Add analytics tracking
**Status**: No analytics

**Options:**
- Cloudflare Web Analytics (privacy-friendly, built-in)
- PostHog (self-hosted analytics)
- Mixpanel (user behavior)

---

### 8. Internationalization (i18n)
**Status**: Hardcoded Russian text in many places

**Problem**: HistoryScreen, feedback, UI text is in Russian

**Solution:** Add i18n library (react-i18next) for multi-language support

---

## 🔧 Refactoring Candidates

### 9. Extract audio utilities
**File**: `components/ConversationScreen.tsx` (600+ lines)

**Problem**: Massive component with audio logic mixed with UI

**Solution**: Extract to custom hooks:
- `useAudioCapture()` - microphone handling
- `useGeminiLive()` - Gemini API connection
- `useTranscript()` - transcript state management

---

### 10. Type safety improvements
**Areas:**
- JSONB fields (transcript, scores) - create Zod schemas
- API responses - add runtime validation
- Edge Function responses - typed fetch wrappers

---

## 📊 Performance Monitoring

### Metrics to track:
- Time to Interactive (TTI)
- First Contentful Paint (FCP)
- Bundle size over time
- API response times (Edge Functions)

### Tools:
- Lighthouse CI in GitHub Actions
- Cloudflare Analytics
- Sentry for error tracking

---

## 🔒 Security Enhancements

### 11. Rate limiting
**Status**: No rate limits on Edge Functions

**Risk**: API abuse, cost overruns

**Solution**: Add rate limiting middleware to Edge Functions

---

### 12. Input sanitization
**Status**: No validation on user inputs

**Files**: LoginScreen (email), ConversationScreen (transcript)

**Solution**: Add validation library (Zod, Yup)

---

## 📝 Documentation

### 13. Add JSDoc comments
**Status**: Minimal documentation in code

**Priority files:**
- `UserContext.tsx` - explain auth flow
- `ConversationScreen.tsx` - document audio pipeline
- Edge Functions - API documentation

---

## Last Updated
2025-10-28

## Notes
- Focus on #1 (AudioWorklet) first as it's a deprecated API
- Bundle optimization (#3) should be done before adding more features
- Most other items can be tackled incrementally

