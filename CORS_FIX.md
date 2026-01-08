# CORS Fix - Summary

## Problem

You were experiencing a CORS (Cross-Origin Resource Sharing) error:

```
Access to fetch at 'https://herd.coaldev.org/webhook/...' from origin 'https://web-in-place-edit.onrender.com' has been blocked by CORS policy
```

## Root Cause

The frontend JavaScript was making a **direct browser request** to the external n8n webhook at `herd.coaldev.org`. When a browser makes a cross-origin request, the target server must explicitly allow it with CORS headers. Since `herd.coaldev.org` doesn't return the required `Access-Control-Allow-Origin` header, the browser blocks the request.

## Solution

Instead of making the request directly from the browser to the external webhook, I've implemented a **proxy pattern**:

1. **Frontend → Your Server** (same origin, no CORS issue)
2. **Your Server → n8n Webhook** (server-to-server, no CORS issue)

## Changes Made

### 1. Updated Frontend Code (server.js:310-348)

**Before:**
```javascript
// Made two separate requests directly to external webhook
await fetch('/submit/' + requestId, ...);  // Submit to server
await fetch(WEBHOOK_URL, ...);             // Direct to n8n webhook (CORS ERROR!)
```

**After:**
```javascript
// Single request to our proxy endpoint
const response = await fetch('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        requestId: requestId,
        subject: subject,
        body: body,
        timestamp: new Date().toISOString(),
        source: 'email-editor'
    })
});
```

### 2. Added Proxy Endpoint (server.js:490-555)

Created a new `POST /webhook` endpoint that:
- Marks the email as submitted in the local store
- Forwards the request to the n8n webhook URL
- Returns the webhook's response back to the frontend

```javascript
if (req.method === 'POST' && pathname === '/webhook') {
    // Save submission locally
    // Forward to n8n using https.request (server-to-server)
    // Return response
}
```

## How It Works Now

```
┌─────────────┐        ┌──────────────────┐        ┌─────────────┐
│   Browser   │───────>│   Your Server    │───────>│  n8n Webhook│
│  (Frontend) │<───────│  (Proxy/Backend) │<───────│(herd.coaldev│
└─────────────┘        └──────────────────┘        └─────────────┘
   Same-origin           Server-to-server
   No CORS issue         No CORS issue
```

## Testing

After redeploying to Render, the error should be gone. You can verify by:

1. Submitting a test email through your form
2. Check the browser console - no CORS errors
3. Check your Render logs - you should see `[Webhook Forward] Status: 200`

## Environment Variable Required

Make sure your Render environment has this set:
```
N8N_WEBHOOK_URL=https://herd.coaldev.org/webhook/9115aba7-1438-4f1e-9410-baee846fcefb
```

## Next Steps

1. **Commit and push** the changes to GitHub
2. **Redeploy** on Render (or wait for auto-deploy if enabled)
3. **Test** the email submission form
