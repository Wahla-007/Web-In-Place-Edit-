# Gmail Link Fix - "Email not found" Error

## Problem

When you send the form link via n8n Gmail node, recipients see the **"Email not found"** error page. However, when you open the form directly yourself, it works correctly.

## Root Cause

The link being sent via Gmail is **incomplete or malformed**. It's missing the unique request ID that identifies which email data to load.

### What Happens:
1. ❌ **Wrong**: Gmail sends a link like `https://your-domain.com/edit/` (missing ID)
2. ✅ **Correct**: Should be `https://your-domain.com/edit/abc123def456` (with unique ID)

When the ID is missing or wrong, the server can't find the email data in storage, so it shows "Email not found".

---

## Solution: Fix Your n8n Workflow

Your n8n workflow needs **two steps in sequence**:

### Step 1: Create the Edit Request (HTTP Request Node)

This step creates the unique edit link.

**Configuration:**
- **Node**: HTTP Request
- **Method**: POST
- **URL**: `https://your-domain.onrender.com/`
- **Authentication**: None (or add X-Webhook-Secret header if you enabled it)
- **Headers**:
  ```
  Content-Type: application/json
  ```
- **Body** (JSON):
  ```json
  {
    "email": "{{ $json.email }}",
    "subject": "{{ $json.subject }}",
    "body": "{{ $json.body }}"
  }
  ```

**Important**: Make sure the `email` field contains the recipient's email address. This is crucial for the form to work.

**Response** (what you'll get back):
```json
{
  "success": true,
  "requestId": "abc123def456",
  "editLink": "https://your-domain.onrender.com/edit/abc123def456",
  "email": "recipient@example.com",
  "expiresIn": "24 hours"
}
```

### Step 2: Send via Gmail (Gmail Node)

**Configuration:**
- **Node**: Gmail
- **Resource**: Message
- **Operation**: Send
- **To**: `{{ $json.email }}`
- **Subject**: Your subject line
- **Message**: Include the edit link from Step 1

**Message Body Example**:
```
Hi there,

Please review and edit the email content by clicking the link below:

{{ $node["HTTP Request"].json.editLink }}

This link will expire in 24 hours.

Best regards,
Your Team
```

**Critical**: Use `{{ $node["HTTP Request"].json.editLink }}` to reference the link from the previous HTTP Request node. Replace "HTTP Request" with whatever you named that node.

---

## Common Mistakes to Avoid

### ❌ Mistake 1: Hardcoding the Link
```
DON'T DO THIS:
https://your-domain.onrender.com/edit/
```
This has no ID, so it will always show "Email not found".

### ❌ Mistake 2: Wrong Expression Syntax
```json
// Wrong - missing node reference:
{{ $json.editLink }}

// Correct - referencing the HTTP Request node:
{{ $node["HTTP Request"].json.editLink }}
```

### ❌ Mistake 3: Missing Email Parameter
Make sure the initial POST request includes the `email` field:
```json
{
  "email": "user@example.com",  // ← Don't forget this!
  "subject": "Test",
  "body": "Content"
}
```

---

## Testing the Fix

### Local Test (without Gmail)

1. **Create a request** using curl or Postman:
```bash
curl -X POST https://your-domain.onrender.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "subject": "Test Subject",
    "body": "Test Body"
  }'
```

2. **Copy the editLink** from the response
3. **Open it in your browser** - you should see the form with data loaded

### Full n8n Test

1. Set up the workflow as described above
2. Trigger it with test data
3. Check your Gmail inbox
4. Click the link - should work perfectly

---

## Debugging Tips

### Check Render Logs

If it's still not working, check your Render logs for debugging info:

1. Go to your Render dashboard
2. Click on your service
3. View the **Logs** tab
4. Look for lines like:
   ```
   [Created] New request: abc123def456
   [Link] https://your-domain.onrender.com/edit/abc123def456
   ```

### Check n8n Execution

1. In n8n, click on an execution
2. Check the HTTP Request node output
3. Verify the `editLink` field exists and is complete

### Manual Link Test

Try manually crafting a link with an ID that you know exists:
1. Create a request via curl (as shown above)
2. Save the ID from the response
3. Manually type: `https://your-domain.onrender.com/edit/THE_ID`
4. If this works, the problem is in how the link is being generated/sent

---

## Example: Complete n8n Workflow

Here's what your workflow should look like:

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Trigger   │────→│ HTTP Request │────→│    Gmail     │
│  (Webhook)  │     │ Create Link  │     │  Send Link   │
└─────────────┘     └──────────────┘     └──────────────┘
                           │
                           ↓
                    Response contains:
                    {
                      "editLink": "..."
                    }
```

### Node 1: Webhook (or other trigger)
Receives initial data with email, subject, body

### Node 2: HTTP Request
```
POST https://your-domain.onrender.com/
Body:
{
  "email": "{{ $json.email }}",
  "subject": "{{ $json.subject }}",
  "body": "{{ $json.body }}"
}
```

### Node 3: Gmail
```
To: {{ $json.email }}
Message: Please edit here: {{ $node["HTTP Request"].json.editLink }}
```

---

## Still Not Working?

If you're still seeing "Email not found" after following these steps:

### 1. Verify Environment Variables
In Render, make sure `N8N_WEBHOOK_URL` is set correctly.

### 2. Check Email Storage Expiry
Data expires after 24 hours. Make sure you're testing with fresh links.

### 3. Check Rate Limiting
If you're testing rapidly, you might hit the rate limit (10 requests/minute per IP).

### 4. Enable Debug Logging
Temporarily add more logging to see what's happening:
- Check what ID is being looked up
- Check what's in the email store
- The server already logs this - just check Render logs

---

## Quick Checklist

Before sending via Gmail, verify:

- [ ] HTTP Request POST to your server runs successfully
- [ ] Response contains a valid `editLink` field
- [ ] The link includes a random ID (e.g., `/edit/abc123def456`)
- [ ] Gmail node references the link correctly with `{{ $node["..."].json.editLink }}`
- [ ] The recipient can open the link and see the form
- [ ] The form shows the correct email, subject, and body

---

## Need More Help?

If you're still stuck, provide:
1. A screenshot of your n8n workflow
2. The output from the HTTP Request node
3. The actual link that was sent via Gmail
4. Your Render logs showing what ID was created

This will help diagnose the exact issue!
