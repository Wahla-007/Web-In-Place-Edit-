# 🔒 Security Implementation Summary

## ✅ Implemented Security Features

### 1. **Rate Limiting**
- **Protection**: Prevents spam, DDoS, and brute-force attacks
- **Limit**: 10 requests per minute per IP address
- **Scope**: Applied to:
  - `POST /create` - Creating edit requests
  - `GET /edit/:id` - Accessing edit forms
- **Response**: `429 Too Many Requests`
- **Auto-cleanup**: Rate limit data expires automatically

### 2. **Token Authentication**
- **Protection**: Prevents unauthorized API access
- **Method**: Secret token validation via HTTP header
- **Headers Accepted**:
  - `X-Webhook-Secret: your-token`
  - `Authorization: Bearer your-token`
- **Scope**: Applied to:
  - `POST /create` - Only n8n with valid token can create links
- **Response**: `401 Unauthorized` if token is missing/invalid

---

## 🔧 Configuration Required

### Environment Variables (Render Dashboard)

**Add these in Render → Your Service → Environment:**

```bash
# Required - Your n8n webhook URL
N8N_WEBHOOK_URL=https://herd.coaldev.org/webhook/9115aba7-1438-4f1e-9410-baee846fcefb

# Required - Secret token for authentication
WEBHOOK_SECRET=<GENERATE_A_SECURE_TOKEN>
```

### Generate Secure Token

Run this command to generate a cryptographically secure token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Example output:**
```
7f3d8e2a9b1c5f6e4d7a8b9c0e1f2d3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e
```

Use this token for `WEBHOOK_SECRET` in Render AND in your n8n HTTP Request headers.

---

## 📋 n8n Configuration

### HTTP Request Node Setup

**URL:** `https://web-in-place-edit.onrender.com/`  
**Method:** `POST`  
**Authentication:** None (using custom header)

**Headers:**
```json
{
  "Content-Type": "application/json",
  "X-Webhook-Secret": "7f3d8e2a9b1c5f6e4d7a8b9c0e1f2d3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e"
}
```

**Body:**
```json
{
  "email": "{{ $json.email }}",
  "subject": "{{ $json.subject }}",
  "body": "{{ $json.body }}"
}
```

---

## 🛡️ Security Features Details

### Rate Limiting Implementation

```javascript
// Rate limit map: IP → [timestamp, timestamp, ...]
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;  // 10 requests max
```

**How it works:**
1. Extracts real IP from `X-Forwarded-For` (Render provides this)
2. Tracks last 10 requests per IP in a 60-second sliding window
3. If limit exceeded → returns `429 Too Many Requests`
4. Auto-cleans expired data every 5 minutes

### Token Authentication Implementation

```javascript
function verifyWebhookToken(req) {
    const token = req.headers['x-webhook-secret'] || 
                  req.headers['authorization']?.replace('Bearer ', '');
    return token === WEBHOOK_SECRET;
}
```

**How it works:**
1. Checks for token in `X-Webhook-Secret` or `Authorization` header
2. Compares with environment variable `WEBHOOK_SECRET`
3. If invalid/missing → returns `401 Unauthorized`

---

## 🧪 Testing

### Test Rate Limiting

```bash
# Send 11 requests quickly (should see 429 on 11th)
for i in {1..11}; do
  curl -X POST https://web-in-place-edit.onrender.com/ \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Secret: your-token" \
    -d '{"email":"test@test.com","subject":"Test","body":"Test"}' 
done
```

### Test Token Authentication

```bash
# Valid token - should work
curl -X POST https://web-in-place-edit.onrender.com/ \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-actual-token" \
  -d '{"email":"test@test.com","subject":"Test","body":"Test"}'

# Invalid token - should return 401
curl -X POST https://web-in-place-edit.onrender.com/ \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: wrong-token" \
  -d '{"email":"test@test.com","subject":"Test","body":"Test"}'

# No token - should return 401
curl -X POST https://web-in-place-edit.onrender.com/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","subject":"Test","body":"Test"}'
```

---

## 📊 Security Monitoring

### Server Logs to Watch For

```
[Security] Rate limit exceeded for IP: 123.45.67.89
[Security] Unauthorized create request - invalid token
[Webhook Forward] Status: 200
```

Check your Render logs regularly for suspicious activity:
- Multiple failed auth attempts
- High rate limit violations
- Unusual IP patterns

---

## ⚠️ Important Security Notes

1. **Keep WEBHOOK_SECRET Secret!**
   - Never commit it to GitHub
   - Only set it in Render environment variables
   - Rotate it periodically (every 90 days)

2. **Rate Limits Are Per-IP**
   - Legitimate users behind same NAT share limits
   - Adjust `MAX_REQUESTS_PER_WINDOW` if needed

3. **HTTPS Only**
   - Render provides HTTPS by default
   - Never expose this over HTTP in production

4. **Monitor Logs**
   - Check for unusual patterns
   - Set up alerts for repeated 401/429 errors

---

## 🔄 Rotating Your Secret Token

If you suspect your token is compromised:

1. Generate new token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Update `WEBHOOK_SECRET` in Render environment variables
3. Update `X-Webhook-Secret` header in n8n
4. Deploy/restart your Render service

---

## 📈 Future Security Enhancements

**Not yet implemented (nice-to-have):**
- [ ] Input length validation (prevent large payloads)
- [ ] Content Security Policy headers
- [ ] IP whitelisting/blacklisting
- [ ] Request signature verification
- [ ] Audit logging with timestamps
- [ ] Two-factor authentication for edit links

---

## ✅ Current Security Status

| Feature | Status | Protection Level |
|---------|--------|------------------|
| Rate Limiting | ✅ Implemented | High |
| Token Authentication | ✅ Implemented | High |
| XSS Protection | ✅ Built-in | High |
| HTTPS | ✅ Render Default | High |
| Link Expiry | ✅ 24 hours | Medium |
| One-Time Use | ✅ Implemented | Medium |
| CORS | ✅ Configured | Low |

**Overall Security Rating:** 🔒🔒🔒🔒 (Good)

---

## 🆘 Troubleshooting

### "401 Unauthorized" Error
- Check `WEBHOOK_SECRET` is set in Render
- Verify `X-Webhook-Secret` header matches exactly
- Check for trailing spaces in token

### "429 Too Many Requests" Error
- Wait 1 minute and retry
- Check if multiple users share same IP (NAT/VPN)
- Consider increasing `MAX_REQUESTS_PER_WINDOW` if legitimate

### n8n Can't Create Links
- Ensure `X-Webhook-Secret` header is added to HTTP Request node
- Verify token is copied correctly (no extra spaces)
- Check Render logs for authentication errors
