const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 3000;
const HOST = process.env.RENDER_EXTERNAL_URL || process.env.HOST || `http://localhost:${PORT}`;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://your-n8n-instance.com/webhook/your-webhook-id';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your-secret-token-change-this'; // Available but not enforced
// ============================================================

// ============================================================
// SECURITY: Rate Limiting
// ============================================================
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // 10 requests per minute

function getRealIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.headers['x-real-ip'] ||
        req.connection.remoteAddress ||
        'unknown';
}

function checkRateLimit(ip) {
    const now = Date.now();
    const requests = rateLimit.get(ip) || [];

    // Filter out old requests outside the time window
    const recentRequests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);

    // Check if limit exceeded
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
        return false;
    }

    // Add current request
    recentRequests.push(now);
    rateLimit.set(ip, recentRequests);
    return true;
}

// Cleanup rate limit data every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, requests] of rateLimit.entries()) {
        const recentRequests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
        if (recentRequests.length === 0) {
            rateLimit.delete(ip);
        } else {
            rateLimit.set(ip, recentRequests);
        }
    }
}, 5 * 60 * 1000);

// ============================================================
// SECURITY: Token Authentication
// ============================================================
function verifyWebhookToken(req) {
    const token = req.headers['x-webhook-secret'] || req.headers['authorization']?.replace('Bearer ', '');
    return token === WEBHOOK_SECRET;
}


// In-memory storage for email data (keyed by unique ID)
// In production, you might want to use Redis or a database
const emailStore = new Map();

// Auto-cleanup old entries after 24 hours
const EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours in ms

function cleanupExpired() {
    const now = Date.now();
    for (const [id, data] of emailStore.entries()) {
        if (now - data.createdAt > EXPIRY_TIME) {
            emailStore.delete(id);
            console.log(`[Cleanup] Expired entry: ${id}`);
        }
    }
}
setInterval(cleanupExpired, 60 * 60 * 1000); // Run cleanup every hour

// Generate unique ID
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

// Parse request body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                if (req.headers['content-type']?.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(body);
                    resolve({
                        subject: params.get('subject') || '',
                        body: params.get('body') || ''
                    });
                } else if (body.trim().startsWith('{')) {
                    resolve(JSON.parse(body));
                } else if (body) {
                    const params = new URLSearchParams(body);
                    resolve({
                        subject: params.get('subject') || '',
                        body: params.get('body') || ''
                    });
                } else {
                    resolve({ subject: '', body: '' });
                }
            } catch (e) {
                resolve({ subject: '', body: '' });
            }
        });
        req.on('error', reject);
    });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Generate the form page HTML
function generateFormPage(id, email, subject, body, status = 'loaded') {
    const statusText = status === 'loaded' ? 'Email loaded - ready to edit' :
        status === 'expired' ? 'This link has expired' :
            status === 'notfound' ? 'Email not found' : 'Ready';
    const statusClass = status === 'loaded' ? 'loaded' : status === 'expired' || status === 'notfound' ? 'error' : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Editor</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
        }
        body::before {
            content: '';
            position: fixed;
            top: -50%; left: -50%;
            width: 200%; height: 200%;
            background: radial-gradient(ellipse at center, var(--accent-glow) 0%, transparent 50%);
            animation: pulse 8s ease-in-out infinite;
            pointer-events: none;
        }
        @keyframes pulse {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
        }
        .container { width: 100%; max-width: 700px; position: relative; z-index: 1; }
        .card {
            background: linear-gradient(145deg, var(--bg-secondary), var(--bg-tertiary));
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 2.5rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 60px -15px var(--accent-glow);
        }
        .header { text-align: center; margin-bottom: 2rem; }
        .header-icon {
            width: 60px; height: 60px;
            background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
            border-radius: 16px;
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 1rem;
            box-shadow: 0 10px 30px -10px var(--accent-glow);
        }
        .header-icon svg { width: 32px; height: 32px; fill: white; }
        h1 { color: var(--text-primary); font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; }
        .subtitle { color: var(--text-secondary); font-size: 0.95rem; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; color: var(--text-primary); font-weight: 500; font-size: 0.9rem; margin-bottom: 0.5rem; }
        label span { color: var(--text-secondary); font-weight: 400; font-size: 0.8rem; }
        input[type="text"], textarea {
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
        input:focus, textarea:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px var(--accent-glow);
        }
        textarea { min-height: 280px; resize: vertical; line-height: 1.6; }
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
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px -10px var(--accent-glow); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .btn svg { width: 20px; height: 20px; fill: currentColor; }
        .message {
            padding: 1rem 1.25rem;
            border-radius: 12px;
            margin-top: 1.5rem;
            display: none;
            align-items: center;
            gap: 0.75rem;
            font-weight: 500;
        }
        .message.success { background: rgba(16, 185, 129, 0.15); border: 1px solid var(--success); color: var(--success); display: flex; }
        .message.error { background: rgba(239, 68, 68, 0.15); border: 1px solid var(--error); color: var(--error); display: flex; }
        .message svg { width: 24px; height: 24px; fill: currentColor; }
        .spinner { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .info-badge {
            display: inline-flex; align-items: center; gap: 0.5rem;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            font-size: 0.8rem;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            margin-bottom: 1.5rem;
        }
        .info-badge svg { width: 14px; height: 14px; fill: currentColor; }
        .info-badge.loaded { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .info-badge.error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
        .loading-overlay {
            position: fixed; inset: 0;
            background: rgba(15, 15, 26, 0.8);
            display: none;
            align-items: center; justify-content: center;
            z-index: 100;
        }
        .loading-overlay.active { display: flex; }
        .loading-content { text-align: center; color: var(--text-primary); }
        .loading-spinner { width: 50px; height: 50px; border: 3px solid var(--border-color); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
        .request-id { font-size: 0.7rem; color: var(--text-secondary); text-align: center; margin-top: 1.5rem; opacity: 0.5; }
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
                    <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                </div>
                <h1>Edit Email</h1>
                <p class="subtitle">Review and edit the content below, then submit</p>
            </div>
            <div class="info-badge ${statusClass}" id="statusBadge">
                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                <span id="statusText">${statusText}</span>
            </div>
            <form id="emailForm">
                <input type="hidden" id="requestId" value="${escapeHtml(id)}">
                <input type="hidden" id="contactEmail" value="${escapeHtml(email)}">
                <div class="form-group">
                    <label for="emailDisplay">Contact Email <span>(Read-only identifier)</span></label>
                    <input type="text" id="emailDisplay" name="emailDisplay" value="${escapeHtml(email)}" disabled style="opacity: 0.7; cursor: not-allowed;">
                </div>
                <div class="form-group">
                    <label for="subject">Subject <span>(Email subject line)</span></label>
                    <input type="text" id="subject" name="subject" value="${escapeHtml(subject)}" ${status !== 'loaded' ? 'disabled' : ''}>
                </div>
                <div class="form-group">
                    <label for="body">Body <span>(Email content - edit in place)</span></label>
                    <textarea id="body" name="body" ${status !== 'loaded' ? 'disabled' : ''}>${escapeHtml(body)}</textarea>
                </div>
                <button type="submit" class="btn" id="submitBtn" ${status !== 'loaded' ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    <span>Send</span>
                </button>
                <div class="message" id="message">
                    <svg id="messageIcon" viewBox="0 0 24 24"></svg>
                    <span id="messageText"></span>
                </div>
            </form>
            <div class="request-id">Request ID: ${escapeHtml(id)}</div>
        </div>
    </div>
    <script>
        (function() {
            const WEBHOOK_URL = '${N8N_WEBHOOK_URL}';
            const form = document.getElementById('emailForm');
            const submitBtn = document.getElementById('submitBtn');
            const messageDiv = document.getElementById('message');
            const messageIcon = document.getElementById('messageIcon');
            const messageText = document.getElementById('messageText');
            const loadingOverlay = document.getElementById('loadingOverlay');
            const requestId = document.getElementById('requestId').value;

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
                    submitBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg><span>Send</span>';
                }
            }

            form.addEventListener('submit', async function(e) {
                e.preventDefault();
                messageDiv.className = 'message';
                
                const subject = document.getElementById('subject').value.trim();
                const body = document.getElementById('body').value.trim();
                const contactEmail = document.getElementById('contactEmail').value;

                if (!subject && !body) {
                    showMessage('Please enter at least a subject or body', false);
                    return;
                }

                setLoading(true);

                try {
                    // Send to our server's webhook proxy endpoint
                    // The server will forward it to n8n, avoiding CORS
                    const response = await fetch('/webhook', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requestId: requestId,
                            email: contactEmail,
                            subject: subject,
                            body: body,
                            timestamp: new Date().toISOString(),
                            source: 'email-editor'
                        })
                    });

                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    showMessage('Email submitted successfully!', true);
                    submitBtn.disabled = true;
                } catch (error) {
                    showMessage('Failed to send: ' + error.message, false);
                } finally {
                    setLoading(false);
                }
            });
        })();
    </script>
</body>
</html>`;
}

// Create the server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // =====================================================
    // POST / or /create - Create new email edit request
    // Returns JSON with unique link
    // =====================================================
    if (req.method === 'POST' && (pathname === '/' || pathname === '/create')) {
        // SECURITY: Token authentication temporarily disabled for testing
        // if (!verifyWebhookToken(req)) {
        //     console.log('[Security] Unauthorized create request - invalid token');
        //     res.writeHead(401, { 'Content-Type': 'application/json' });
        //     res.end(JSON.stringify({
        //         success: false,
        //         error: 'Invalid token'
        //     }));
        //     return;
        // }

        // SECURITY: Check rate limit
        const clientIP = getRealIP(req);
        if (!checkRateLimit(clientIP)) {
            console.log(`[Security] Rate limit exceeded for IP: ${clientIP}`);
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Too many requests. Please try again later.'
            }));
            return;
        }

        try {
            const data = await parseBody(req);
            const id = generateId();

            // Store the email data with timestamp
            emailStore.set(id, {
                email: data.email || '',  // Contact email (read-only identifier)
                subject: data.subject || '',
                body: data.body || '',
                createdAt: Date.now(),
                submitted: false
            });

            // Determine the base URL
            let baseUrl = HOST;
            if (req.headers.host && !HOST.includes('localhost')) {
                baseUrl = `https://${req.headers.host}`;
            }

            const editLink = `${baseUrl}/edit/${id}`;

            console.log(`[Created] New request: ${id}`);
            console.log(`[Link] ${editLink}`);

            // Return JSON with the link
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                requestId: id,
                editLink: editLink,
                email: data.email || '',
                expiresIn: '24 hours'
            }));
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Server error' }));
        }
        return;
    }

    // =====================================================
    // GET /edit/:id - Show the form for a specific request
    // =====================================================
    if (req.method === 'GET' && pathname.startsWith('/edit/')) {
        // SECURITY: Check rate limit to prevent brute-force ID guessing
        const clientIP = getRealIP(req);
        if (!checkRateLimit(clientIP)) {
            console.log(`[Security] Rate limit exceeded for IP: ${clientIP}`);
            res.writeHead(429, { 'Content-Type': 'text/html' });
            res.end('<h1>429 Too Many Requests</h1><p>Please try again later.</p>');
            return;
        }

        const id = pathname.replace('/edit/', '');
        const emailData = emailStore.get(id);

        if (!emailData) {
            // Not found or expired
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(generateFormPage(id, '', '', '', 'notfound'));
            return;
        }

        if (emailData.submitted) {
            // Already submitted
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(generateFormPage(id, emailData.email || '', emailData.subject, emailData.body, 'expired'));
            return;
        }

        // Show the form with the data
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(generateFormPage(id, emailData.email || '', emailData.subject, emailData.body, 'loaded'));
        return;
    }

    // =====================================================
    // POST /submit/:id - Mark request as submitted
    // =====================================================
    if (req.method === 'POST' && pathname.startsWith('/submit/')) {
        const id = pathname.replace('/submit/', '');
        const emailData = emailStore.get(id);

        if (emailData) {
            const data = await parseBody(req);
            emailData.subject = data.subject || emailData.subject;
            emailData.body = data.body || emailData.body;
            emailData.submitted = true;
            emailData.submittedAt = Date.now();
            console.log(`[Submitted] Request: ${id}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // =====================================================
    // GET /status/:id - Check status of a request
    // =====================================================
    if (req.method === 'GET' && pathname.startsWith('/status/')) {
        const id = pathname.replace('/status/', '');
        const emailData = emailStore.get(id);

        if (!emailData) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ found: false, status: 'not_found' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            found: true,
            status: emailData.submitted ? 'submitted' : 'pending',
            subject: emailData.subject,
            body: emailData.body,
            createdAt: new Date(emailData.createdAt).toISOString(),
            submittedAt: emailData.submittedAt ? new Date(emailData.submittedAt).toISOString() : null
        }));
        return;
    }

    // =====================================================
    // POST /webhook - Proxy to n8n webhook (avoids CORS)
    // =====================================================
    if (req.method === 'POST' && pathname === '/webhook') {
        try {
            const data = await parseBody(req);
            const requestId = data.requestId;

            // Mark as submitted in our store
            const emailData = emailStore.get(requestId);
            if (emailData) {
                emailData.subject = data.subject || emailData.subject;
                emailData.body = data.body || emailData.body;
                emailData.submitted = true;
                emailData.submittedAt = Date.now();
                console.log(`[Submitted] Request: ${requestId} | Email: ${emailData.email || data.email || 'N/A'}`);
            }

            // Ensure email is always included in the webhook payload
            const webhookPayload = {
                ...data,
                email: data.email || (emailData ? emailData.email : ''), // Fallback to stored email
            };

            console.log('[Webhook Payload]', JSON.stringify(webhookPayload, null, 2));

            // Forward to n8n webhook
            const https = require('https');
            const urlModule = require('url');
            const webhookUrl = new URL(N8N_WEBHOOK_URL);

            const postData = JSON.stringify(webhookPayload);

            const options = {
                hostname: webhookUrl.hostname,
                port: webhookUrl.port || 443,
                path: webhookUrl.pathname + webhookUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const proxyReq = https.request(options, (proxyRes) => {
                let responseBody = '';
                proxyRes.on('data', (chunk) => {
                    responseBody += chunk;
                });
                proxyRes.on('end', () => {
                    console.log(`[Webhook Forward] Status: ${proxyRes.statusCode}`);
                    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(responseBody || JSON.stringify({ success: true }));
                });
            });

            proxyReq.on('error', (error) => {
                console.error('[Webhook Error]', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Failed to forward to webhook',
                    details: error.message
                }));
            });

            proxyReq.write(postData);
            proxyReq.end();
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Server error' }));
        }
        return;
    }

    // =====================================================
    // GET / - Health check / info
    // =====================================================
    if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            service: 'Email Editor - Human in the Loop',
            status: 'running',
            usage: {
                createRequest: 'POST / with { "subject": "...", "body": "..." }',
                editForm: 'GET /edit/:requestId',
                checkStatus: 'GET /status/:requestId'
            },
            activeRequests: emailStore.size
        }));
        return;
    }

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           📧 Email Editor Server (Instance-based)              ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  Server running at: http://localhost:${PORT}                      ║`);
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║  ENDPOINTS:                                                    ║');
    console.log('║                                                                ║');
    console.log('║  POST /           → Create new request, get unique link       ║');
    console.log('║  GET  /edit/:id   → Show form for specific request            ║');
    console.log('║  GET  /status/:id → Check if request was submitted            ║');
    console.log('║                                                                ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║  EXAMPLE:                                                      ║');
    console.log('║                                                                ║');
    console.log('║  curl -X POST http://localhost:3000/ \\                        ║');
    console.log('║    -H "Content-Type: application/json" \\                      ║');
    console.log('║    -d \'{"subject":"Hello","body":"Content"}\'                  ║');
    console.log('║                                                                ║');
    console.log('║  Response: { "editLink": "http://.../edit/abc123" }           ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
});
