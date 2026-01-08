// ============================================================
// CONFIGURATION - Set your n8n webhook URL here
// ============================================================
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://your-n8n-instance.com/webhook/your-webhook-id';
// ============================================================

// The complete HTML page template
const htmlTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Editor</title>
    <meta name="description" content="Human-in-the-loop email editor for webhook integration">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --bg-primary: #0f0f1a;
            --bg-secondary: #1a1a2e;
            --bg-tertiary: #252542;
            --accent-primary: #6366f1;
            --accent-secondary: #8b5cf6;
            --accent-glow: rgba(99, 102, 241, 0.3);
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --success: #10b981;
            --error: #ef4444;
            --border-color: #334155;
        }

        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            position: relative;
            overflow-x: hidden;
        }

        body::before {
            content: '';
            position: fixed;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 50%);
            animation: pulse 8s ease-in-out infinite;
            pointer-events: none;
            z-index: 0;
        }

        @keyframes pulse {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
        }

        .container {
            width: 100%;
            max-width: 700px;
            position: relative;
            z-index: 1;
        }

        .card {
            background: linear-gradient(145deg, var(--bg-secondary), var(--bg-tertiary));
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 2.5rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5),
                        0 0 60px -15px var(--accent-glow);
            backdrop-filter: blur(10px);
        }

        .header {
            text-align: center;
            margin-bottom: 2rem;
        }

        .header-icon {
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1rem;
            box-shadow: 0 10px 30px -10px var(--accent-glow);
        }

        .header-icon svg {
            width: 32px;
            height: 32px;
            fill: white;
        }

        h1 {
            color: var(--text-primary);
            font-size: 1.75rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -0.025em;
        }

        .subtitle {
            color: var(--text-secondary);
            font-size: 0.95rem;
            font-weight: 400;
        }

        .form-group {
            margin-bottom: 1.5rem;
        }

        label {
            display: block;
            color: var(--text-primary);
            font-weight: 500;
            font-size: 0.9rem;
            margin-bottom: 0.5rem;
        }

        label span {
            color: var(--text-secondary);
            font-weight: 400;
            font-size: 0.8rem;
        }

        input[type="text"],
        textarea {
            width: 100%;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1rem 1.25rem;
            color: var(--text-primary);
            font-family: inherit;
            font-size: 1rem;
            transition: all 0.3s ease;
            outline: none;
        }

        input[type="text"]:focus,
        textarea:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px var(--accent-glow);
        }

        input::placeholder,
        textarea::placeholder {
            color: var(--text-secondary);
            opacity: 0.6;
        }

        textarea {
            min-height: 280px;
            resize: vertical;
            line-height: 1.6;
        }

        .btn {
            width: 100%;
            background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
            color: white;
            border: none;
            border-radius: 12px;
            padding: 1rem 2rem;
            font-family: inherit;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            position: relative;
            overflow: hidden;
        }

        .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s ease;
        }

        .btn:hover::before {
            left: 100%;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px -10px var(--accent-glow);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        .message {
            padding: 1rem 1.25rem;
            border-radius: 12px;
            margin-top: 1.5rem;
            display: none;
            align-items: center;
            gap: 0.75rem;
            font-weight: 500;
            animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .message.success {
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid var(--success);
            color: var(--success);
            display: flex;
        }

        .message.error {
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid var(--error);
            color: var(--error);
            display: flex;
        }

        .message svg {
            width: 24px;
            height: 24px;
            fill: currentColor;
            flex-shrink: 0;
        }

        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .info-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            font-size: 0.8rem;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            margin-bottom: 1.5rem;
        }

        .info-badge svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .info-badge.loaded {
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
        }

        .loading-overlay {
            position: fixed;
            inset: 0;
            background: rgba(15, 15, 26, 0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 100;
            backdrop-filter: blur(4px);
        }

        .loading-overlay.active {
            display: flex;
        }

        .loading-content {
            text-align: center;
            color: var(--text-primary);
        }

        .loading-spinner {
            width: 50px;
            height: 50px;
            border: 3px solid var(--border-color);
            border-top-color: var(--accent-primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }

        @media (max-width: 640px) {
            body {
                padding: 1rem;
            }

            .card {
                padding: 1.5rem;
            }

            h1 {
                font-size: 1.5rem;
            }

            textarea {
                min-height: 200px;
            }
        }
    </style>
</head>
<body>
    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-content">
            <div class="loading-spinner"></div>
            <p>Sending edited email...</p>
        </div>
    </div>

    <div class="container">
        <div class="card">
            <div class="header">
                <div class="header-icon">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                    </svg>
                </div>
                <h1>Edit Email</h1>
                <p class="subtitle">Review and edit the content below, then submit</p>
            </div>

            <div class="info-badge {{STATUS_CLASS}}" id="statusBadge">
                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                <span id="statusText">{{STATUS_TEXT}}</span>
            </div>

            <form id="emailForm">
                <div class="form-group">
                    <label for="subject">Subject <span>(Email subject line)</span></label>
                    <input 
                        type="text" 
                        id="subject" 
                        name="subject" 
                        placeholder="Email subject will appear here..."
                        value="{{SUBJECT}}"
                    >
                </div>

                <div class="form-group">
                    <label for="body">Body <span>(Email content - edit in place)</span></label>
                    <textarea 
                        id="body" 
                        name="body" 
                        placeholder="Email body will appear here..."
                    >{{BODY}}</textarea>
                </div>

                <button type="submit" class="btn" id="submitBtn">
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    <span>Submit Edited Email</span>
                </button>

                <div class="message" id="message">
                    <svg id="messageIcon" viewBox="0 0 24 24"></svg>
                    <span id="messageText"></span>
                </div>
            </form>
        </div>
    </div>

    <script>
        (function() {
            'use strict';

            const WEBHOOK_URL = '{{WEBHOOK_URL}}';

            const form = document.getElementById('emailForm');
            const subjectInput = document.getElementById('subject');
            const bodyInput = document.getElementById('body');
            const submitBtn = document.getElementById('submitBtn');
            const messageDiv = document.getElementById('message');
            const messageIcon = document.getElementById('messageIcon');
            const messageText = document.getElementById('messageText');
            const loadingOverlay = document.getElementById('loadingOverlay');

            const icons = {
                success: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
                error: '<path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>'
            };

            function showMessage(text, isSuccess) {
                messageDiv.className = 'message ' + (isSuccess ? 'success' : 'error');
                messageIcon.innerHTML = isSuccess ? icons.success : icons.error;
                messageText.textContent = text;
            }

            function setLoading(isLoading) {
                loadingOverlay.classList.toggle('active', isLoading);
                submitBtn.disabled = isLoading;
                
                if (isLoading) {
                    submitBtn.innerHTML = '<div class="spinner"></div><span>Sending...</span>';
                } else {
                    submitBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg><span>Submit Edited Email</span>';
                }
            }

            async function handleSubmit(e) {
                e.preventDefault();
                messageDiv.className = 'message';

                const subject = subjectInput.value.trim();
                const body = bodyInput.value.trim();

                if (!subject && !body) {
                    showMessage('Please enter at least a subject or body', false);
                    return;
                }

                setLoading(true);

                try {
                    const response = await fetch(WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            subject: subject,
                            body: body,
                            timestamp: new Date().toISOString(),
                            source: 'email-editor'
                        })
                    });

                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    showMessage('Email submitted successfully!', true);
                } catch (error) {
                    showMessage('Failed to send: ' + error.message, false);
                } finally {
                    setLoading(false);
                }
            }

            form.addEventListener('submit', handleSubmit);
        })();
    </script>
</body>
</html>`;

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Generate page with data
function generatePage(subject, body) {
    const hasData = subject || body;

    return htmlTemplate
        .replace('{{SUBJECT}}', escapeHtml(subject || ''))
        .replace('{{BODY}}', escapeHtml(body || ''))
        .replace('{{WEBHOOK_URL}}', N8N_WEBHOOK_URL)
        .replace('{{STATUS_CLASS}}', hasData ? 'loaded' : '')
        .replace('{{STATUS_TEXT}}', hasData ? 'Email loaded - ready to edit' : 'No data received - enter content manually');
}

// Parse body from request
async function parseBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString();

    const contentType = req.headers['content-type'] || '';

    try {
        if (contentType.includes('application/json')) {
            return JSON.parse(body);
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(body);
            return {
                subject: params.get('subject') || '',
                body: params.get('body') || ''
            };
        } else if (body.trim().startsWith('{')) {
            return JSON.parse(body);
        } else if (body) {
            const params = new URLSearchParams(body);
            return {
                subject: params.get('subject') || '',
                body: params.get('body') || ''
            };
        }
    } catch (e) {
        // Ignore parse errors
    }

    return { subject: '', body: '' };
}

// Vercel serverless function handler
module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    let subject = '';
    let body = '';

    // Handle POST - receive payload
    if (req.method === 'POST') {
        const data = await parseBody(req);
        subject = data.subject || '';
        body = data.body || '';
    }

    // Handle GET - check query params
    if (req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host}`);
        subject = url.searchParams.get('subject') || '';
        body = url.searchParams.get('body') || '';
    }

    const page = generatePage(subject, body);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(page);
};
