# Email Editor - Webhook Relay for n8n

A human-in-the-loop email editor that receives email data, allows editing, and sends it back to n8n.

---

## 🚀 Deploy to Render (FREE)

### Step 1: Push to GitHub

```bash
cd "d:\web form"
git init
git add .
git commit -m "Email editor for n8n"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/email-editor.git
git push -u origin main
```

### Step 2: Deploy on Render

1. Go to **[render.com](https://render.com)** and sign up (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your **GitHub repository**
4. Configure:
   - **Name**: `email-editor`
   - **Runtime**: `Node`
   - **Build Command**: *(leave empty)*
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free**
5. Click **"Create Web Service"**

### Step 3: Set Environment Variable

In Render dashboard → Your service → **Environment**:
- Add: `N8N_WEBHOOK_URL` = `https://your-n8n.com/webhook/xyz`

---

## 📧 Your Endpoint

After deployment:
```
https://email-editor.onrender.com/
```

---

## 🔗 n8n Integration

### Send data TO this editor (HTTP Request node):
```
POST https://email-editor.onrender.com/
Content-Type: application/json

{
  "email": "john.doe@example.com",
  "subject": "Your email subject",
  "body": "Your email body content"
}
```

**Note:** The `email` field is a contact identifier that will be passed through the entire workflow. It's displayed as read-only in the form and sent back to n8n with the edited content.

### Receive data FROM the editor:
Set up another webhook in n8n to receive the edited email.

---

## Flow

```
n8n Webhook #1  →  POST to Email Editor  →  User edits  →  Submit  →  n8n Webhook #2
```

---

## Local Development

```bash
node server.js
# Open http://localhost:3000/?subject=Test&body=Hello
```
