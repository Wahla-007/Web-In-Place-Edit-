const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const https = require('https');

// Load environment variables from .env file
require('dotenv').config();

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 3000;
const HOST = process.env.RENDER_EXTERNAL_URL || process.env.HOST || `http://localhost:${PORT}`;

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
// New webhook for radio button actions (Approve/Stop)
const N8N_ACTION_WEBHOOK_URL = process.env.N8N_ACTION_WEBHOOK_URL || '';

// Gemini API Keys with fallback support
const GEMINI_API_KEYS = [
    process.env.GEMINI_API_KEY || '',
    process.env.GEMINI_API_KEY_2 || '',
    process.env.GEMINI_API_KEY_3 || ''
].filter(key => key); // Remove empty keys

// For backwards compatibility
const GEMINI_API_KEY = GEMINI_API_KEYS[0] || '';
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



// In-memory storage for email data (keyed by unique ID)
// In production, you might want to use Redis or a database
const emailStore = new Map();

// Auto-cleanup old entries after 24 hours
const EXPIRY_TIME = 30 * 24 * 60 * 60 * 1000; // 24 hours in ms

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

// Gemini API call to rewrite email (with fallback support)
async function rewriteEmailWithAI(currentBody, feedback, keyIndex = 0) {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('AI rewriting is currently unavailable: No Gemini API keys configured.');
    }

    if (keyIndex >= GEMINI_API_KEYS.length) {
        throw new Error('AI Error: All API keys exhausted. Please try again later.');
    }

    const apiKey = GEMINI_API_KEYS[keyIndex];
    console.log(`[AI Debug] Using API key ${keyIndex + 1} of ${GEMINI_API_KEYS.length}`);

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            contents: [{
                parts: [{
                    text: `You are a professional email editor. Your task is to rewrite emails based on user feedback while maintaining the original intent and key information. Only return the rewritten email body, nothing else.\n\nPlease rewrite the following email based on this feedback: "${feedback}"\n\nOriginal email:\n${currentBody}`
                }]
            }]
        });

        console.log('[AI Debug] Sending request to Gemini...');

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            console.log(`[AI Debug] Gemini Response Status: ${res.statusCode}`);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', async () => {
                try {
                    const response = JSON.parse(data);

                    if (res.statusCode !== 200) {
                        const errorMessage = response.error ? response.error.message : 'Unknown API error';
                        console.error(`[AI Debug] Gemini API Error - Status: ${res.statusCode}, Message: ${errorMessage}`);

                        // Try fallback key for rate limit or auth errors
                        if (res.statusCode === 429 || res.statusCode === 401 || res.statusCode === 403) {
                            console.log(`[AI Debug] Key ${keyIndex + 1} failed, trying fallback...`);
                            try {
                                const result = await rewriteEmailWithAI(currentBody, feedback, keyIndex + 1);
                                resolve(result);
                            } catch (fallbackError) {
                                reject(fallbackError);
                            }
                            return;
                        }

                        reject(new Error(`AI Error (${res.statusCode}): ${errorMessage}`));
                        return;
                    }

                    if (response.error) {
                        console.error('[AI Debug] Gemini Error JSON:', response.error.message);
                        reject(new Error(`AI Error: ${response.error.message}`));
                    } else if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts[0]) {
                        resolve(response.candidates[0].content.parts[0].text.trim());
                    } else {
                        console.error('[AI Debug] Invalid Gemini response structure:', data);
                        reject(new Error('AI Error: Received an unexpected response format from Gemini.'));
                    }
                } catch (e) {
                    console.error('[AI Debug] Parse Error:', e.message, 'Data:', data);
                    reject(new Error('AI Error: Failed to process the response from Gemini.'));
                }
            });
        });

        req.on('error', (e) => {
            console.error('[AI Debug] Network Error:', e.message);
            reject(new Error(`AI Error (Network): Unable to connect to Gemini service. Please check your internet connection. (${e.message})`));
        });

        req.write(postData);
        req.end();
    });
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
            --bg-primary: #F8F9FA;
            --bg-secondary: #FFFFFF;
            --bg-tertiary: #F3F4F6;
            --accent-primary: #2563EB;
            --accent-secondary: #3B82F6;
            --accent-warning: #F59E0B;
            --text-primary: #1F2937;
            --text-secondary: #6B7280;
            --success: #10B981;
            --error: #EF4444;
            --border-color: #C5CBD3;
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
        }
        .container { width: 100%; max-width: 700px; }
        .card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        .header { text-align: center; margin-bottom: 1.5rem; }
        .header-icon {
            width: 56px; height: 56px;
            background: var(--accent-primary);
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 1rem;
        }
        .header-icon svg { width: 28px; height: 28px; fill: white; }
        h1 { color: var(--text-primary); font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
        .subtitle { color: var(--text-secondary); font-size: 0.9rem; }
        .form-group { margin-bottom: 1.25rem; }
        label { display: block; color: var(--text-primary); font-weight: 500; font-size: 0.875rem; margin-bottom: 0.5rem; }
        label span { color: var(--text-secondary); font-weight: 400; font-size: 0.75rem; }
        input[type="text"], textarea {
            width: 100%;
            background: #FFFFFF;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.75rem 1rem;
            color: var(--text-primary);
            font-family: inherit;
            font-size: 0.9rem;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
            outline: none;
        }
        input:focus, textarea:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
        }
        input:disabled, textarea:disabled {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
        }
        textarea { min-height: 200px; resize: vertical; line-height: 1.5; }
        .btn {
            width: 100%;
            background: var(--accent-primary);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 0.75rem 1.5rem;
            font-family: inherit;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        .btn:hover { background: #1D4ED8; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn svg { width: 18px; height: 18px; fill: currentColor; }
        .message {
            padding: 0.75rem 1rem;
            border-radius: 8px;
            margin-top: 1rem;
            display: none;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.875rem;
        }
        .message.success { background: rgba(16, 185, 129, 0.1); border: 1px solid var(--success); color: #047857; display: flex; }
        .message.error { background: rgba(239, 68, 68, 0.1); border: 1px solid var(--error); color: #B91C1C; display: flex; }
        .message svg { width: 18px; height: 18px; fill: currentColor; }
        .spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .info-badge {
            display: inline-flex; align-items: center; gap: 0.5rem;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            font-size: 0.75rem;
            padding: 0.375rem 0.75rem;
            border-radius: 6px;
            margin-bottom: 1.25rem;
        }
        .info-badge svg { width: 14px; height: 14px; fill: currentColor; }
        .info-badge.loaded { background: rgba(16, 185, 129, 0.1); color: #047857; }
        .info-badge.error { background: rgba(239, 68, 68, 0.1); color: #B91C1C; }
        .loading-overlay {
            position: fixed; inset: 0;
            background: rgba(255, 255, 255, 0.9);
            display: none;
            align-items: center; justify-content: center;
            z-index: 100;
        }
        .loading-overlay.active { display: flex; }
        .loading-content { text-align: center; color: var(--text-primary); }
        .loading-spinner { width: 40px; height: 40px; border: 3px solid var(--border-color); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
        .request-id { font-size: 0.7rem; color: var(--text-secondary); text-align: center; margin-top: 1.25rem; }
        
        /* Actions Section Styles */
        .actions-section {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1.25rem;
        }
        .actions-title {
            color: var(--text-primary);
            font-weight: 600;
            font-size: 0.95rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .actions-title svg { width: 18px; height: 18px; fill: var(--accent-primary); }
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .radio-option {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            cursor: pointer;
            padding: 0.5rem;
            border-radius: 8px;
            transition: background 0.2s ease;
        }
        .radio-option:hover { background: var(--bg-tertiary); }
        .radio-option input[type="radio"] {
            width: 18px;
            height: 18px;
            accent-color: var(--accent-primary);
            cursor: pointer;
        }
        .radio-option label {
            color: var(--text-primary);
            font-size: 0.9rem;
            cursor: pointer;
            margin-bottom: 0;
        }
        .btn-action {
            width: 100%;
            background: #F59E0B;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 0.75rem 1.5rem;
            font-family: inherit;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-top: 1rem;
        }
        .btn-action:hover { background: #D97706; }
        .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-action svg { width: 18px; height: 18px; fill: currentColor; }

        /* Rewrite with Feedback Styles */
        .rewrite-section {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1.25rem;
        }
        .rewrite-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1rem;
        }
        .rewrite-title {
            color: var(--text-primary);
            font-weight: 600;
            font-size: 0.95rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .rewrite-title svg { width: 18px; height: 18px; fill: var(--accent-primary); }
        .btn-apply {
            background: #10B981;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 0.5rem 1rem;
            font-family: inherit;
            font-size: 0.8rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.15s ease;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }
        .btn-apply:hover { background: #059669; }
        .btn-apply:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-apply svg { width: 14px; height: 14px; fill: currentColor; }
        .rewrite-textarea {
            width: 100%;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.85rem 1rem;
            color: var(--text-primary);
            font-family: inherit;
            font-size: 0.9rem;
            min-height: 80px;
            resize: vertical;
            transition: all 0.3s ease;
            outline: none;
        }
        .rewrite-textarea:focus {
            border-color: var(--accent-secondary);
            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2);
        }
        .rewrite-textarea::placeholder { color: var(--text-secondary); opacity: 0.7; }
        .ai-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            background: rgba(37, 99, 235, 0.1);
            color: var(--accent-primary);
            font-size: 0.65rem;
            font-weight: 600;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            margin-left: 0.5rem;
        }
        .ai-badge svg { width: 10px; height: 10px; fill: currentColor; }

        /* Two Section Layout */
        .sections-container {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1.25rem;
            margin-top: 1.25rem;
        }
        .section-panel {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
        }
        .section-panel-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
            padding-bottom: 0.75rem;
            border-bottom: 1px solid var(--border-color);
        }
        .section-panel-icon {
            width: 36px;
            height: 36px;
            background: var(--accent-primary);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .section-panel-icon svg {
            width: 18px;
            height: 18px;
            fill: white;
        }
        .section-panel-icon.action-icon {
            background: #F59E0B;
        }
        .section-panel-title {
            color: var(--text-primary);
            font-size: 1rem;
            font-weight: 600;
        }
        .section-panel-subtitle {
            color: var(--text-secondary);
            font-size: 0.75rem;
            margin-top: 0.125rem;
        }
        .section-content {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .section-footer {
            margin-top: auto;
            padding-top: 1rem;
        }


        /* N8N Footer */
        .n8n-footer {
            text-align: center;
            margin-top: 1.5rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border-color);
        }
        .n8n-footer span {
            color: var(--text-secondary);
            font-size: 0.8rem;
        }
        .n8n-logo {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            color: #ff6d5a;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-content">
            <div class="loading-spinner"></div>
            <p id="loadingText">Processing...</p>
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
                
                <!-- Contact Email (shown at top) -->
                <div class="form-group">
                    <label for="emailDisplay">Contact Email <span>(Read-only identifier)</span></label>
                    <input type="text" id="emailDisplay" name="emailDisplay" value="${escapeHtml(email)}" disabled style="opacity: 0.7; cursor: not-allowed;">
                </div>

                <!-- Two Sections Container -->
                <div class="sections-container">
                    
                    <!-- SECTION 1: Email Editing -->
                    <div class="section-panel">
                        <div class="section-panel-header">
                            <div class="section-panel-icon">
                                <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                            </div>
                            <div>
                                <div class="section-panel-title">Edit Email</div>
                                <div class="section-panel-subtitle">Modify subject, body & submit changes</div>
                            </div>
                        </div>
                        <div class="section-content">
                            <div class="form-group">
                                <label for="subject">Subject <span>(Email subject line)</span></label>
                                <input type="text" id="subject" name="subject" value="${escapeHtml(subject)}" ${status !== 'loaded' ? 'disabled' : ''}>
                            </div>
                            <div class="form-group">
                                <label for="body">Body <span>(Email content - edit in place)</span></label>
                                <textarea id="body" name="body" style="min-height: 180px;" ${status !== 'loaded' ? 'disabled' : ''}>${escapeHtml(body)}</textarea>
                            </div>
                            
                            <!-- Re-write with Feedback -->
                            <div class="rewrite-section" style="margin-bottom: 0;">
                                <div class="rewrite-header">
                                    <div class="rewrite-title">
                                        <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                                        Re-write with AI
                                        <span class="ai-badge">
                                            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                                            AI Powered
                                        </span>
                                    </div>
                                    <button type="button" class="btn-apply" id="applyBtn" ${status !== 'loaded' ? 'disabled' : ''}>
                                        <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                                        Apply
                                    </button>
                                </div>
                                <textarea class="rewrite-textarea" id="rewriteFeedback" placeholder="Enter instructions to rewrite... (e.g., 'Make it more formal')" ${status !== 'loaded' ? 'disabled' : ''}></textarea>
                            </div>
                        </div>
                        <div class="section-footer">
                            <button type="submit" class="btn" id="submitBtn" ${status !== 'loaded' ? 'disabled' : ''}>
                                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                                <span>Submit Edit</span>
                            </button>
                        </div>
                    </div>

                    <!-- SECTION 2: Quick Actions -->
                    <div class="section-panel">
                        <div class="section-panel-header">
                            <div class="section-panel-icon action-icon">
                                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                            </div>
                            <div>
                                <div class="section-panel-title">Quick Actions</div>
                                <div class="section-panel-subtitle">Approve or stop the email workflow</div>
                            </div>
                        </div>
                        <div class="section-content">
                            <div class="radio-group" style="gap: 1rem;">
                                <div class="radio-option" style="padding: 1rem; background: var(--bg-secondary); border-radius: 12px;">
                                    <input type="radio" id="actionStop" name="action" value="stop" ${status !== 'loaded' ? 'disabled' : ''}>
                                    <label for="actionStop" style="flex: 1;">
                                        <div style="font-weight: 600; color: var(--error);">Stop</div>
                                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">Cancel and stop the email workflow</div>
                                    </label>
                                </div>
                                <div class="radio-option" style="padding: 1rem; background: var(--bg-secondary); border-radius: 12px;">
                                    <input type="radio" id="actionApprove" name="action" value="approve" ${status !== 'loaded' ? 'disabled' : ''}>
                                    <label for="actionApprove" style="flex: 1;">
                                        <div style="font-weight: 600; color: var(--success);">Approve/Send</div>
                                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">Approve and send the email as-is</div>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div class="section-footer">
                            <button type="button" class="btn-action" id="actionBtn" ${status !== 'loaded' ? 'disabled' : ''}>
                                <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                                <span>Submit Action</span>
                            </button>
                        </div>
                    </div>
                </div>

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
            const ACTION_WEBHOOK_URL = '${N8N_ACTION_WEBHOOK_URL}';
            const form = document.getElementById('emailForm');
            const submitBtn = document.getElementById('submitBtn');
            const actionBtn = document.getElementById('actionBtn');
            const applyBtn = document.getElementById('applyBtn');
            const messageDiv = document.getElementById('message');
            const messageIcon = document.getElementById('messageIcon');
            const messageText = document.getElementById('messageText');
            const loadingOverlay = document.getElementById('loadingOverlay');
            const loadingTextEl = document.getElementById('loadingText');
            const requestId = document.getElementById('requestId').value;
            const bodyTextarea = document.getElementById('body');
            const rewriteFeedback = document.getElementById('rewriteFeedback');

            const subjectInput = document.getElementById('subject');
            const originalSubject = subjectInput.value;
            const originalBody = bodyTextarea.value;

            // Track edits: disable Quick Actions when subject or body is modified
            function checkForEdits() {
                const hasEdits = subjectInput.value !== originalSubject || bodyTextarea.value !== originalBody;
                actionBtn.disabled = hasEdits;
                document.querySelectorAll('input[name="action"]').forEach(r => r.disabled = hasEdits);
                if (hasEdits) {
                    document.querySelector('input[name="action"]:checked')?.checked && (document.querySelector('input[name="action"]:checked').checked = false);
                }
            }

            subjectInput.addEventListener('input', checkForEdits);
            bodyTextarea.addEventListener('input', checkForEdits);

            const icons = {
                success: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
                error: '<path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>'
            };

            function showMessage(text, isSuccess) {
                messageDiv.className = 'message ' + (isSuccess ? 'success' : 'error');
                messageIcon.innerHTML = isSuccess ? icons.success : icons.error;
                messageText.textContent = text;
            }

            function setLoading(isLoading, text = 'Processing...') {
                loadingOverlay.classList.toggle('active', isLoading);
                loadingTextEl.textContent = text;
            }

            // Apply AI Rewrite
            applyBtn.addEventListener('click', async function() {
                const feedback = rewriteFeedback.value.trim();
                const currentBody = bodyTextarea.value.trim();

                if (!feedback) {
                    showMessage('Please enter feedback/instructions for the rewrite', false);
                    return;
                }

                if (!currentBody) {
                    showMessage('No email content to rewrite', false);
                    return;
                }

                setLoading(true, 'AI is rewriting your email...');
                applyBtn.disabled = true;

                try {
                    const response = await fetch('/api/rewrite', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            currentBody: currentBody,
                            feedback: feedback
                        })
                    });

                    const result = await response.json();

                    if (!response.ok) {
                        throw new Error(result.error || 'Failed to rewrite email');
                    }

                    // Update the body textarea with the rewritten content
                    bodyTextarea.value = result.rewrittenBody;
                    rewriteFeedback.value = ''; // Clear feedback after successful rewrite
                    checkForEdits(); // Re-check edits after AI rewrite
                    showMessage('Email rewritten successfully!', true);
                } catch (error) {
                    showMessage('Rewrite failed: ' + error.message, false);
                } finally {
                    setLoading(false);
                    applyBtn.disabled = false;
                }
            });

            // Submit Action (Stop/Approve) - uses ACTION_WEBHOOK_URL
            actionBtn.addEventListener('click', async function() {
                const selectedAction = document.querySelector('input[name="action"]:checked');
                
                if (!selectedAction) {
                    showMessage('Please select an action (Stop or Approve/Send)', false);
                    return;
                }

                const action = selectedAction.value;
                const subject = document.getElementById('subject').value.trim();
                const body = document.getElementById('body').value.trim();
                const contactEmail = document.getElementById('contactEmail').value;

                setLoading(true, action === 'approve' ? 'Approving and sending...' : 'Stopping...');
                actionBtn.disabled = true;

                try {
                    const response = await fetch('/webhook/action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            requestId: requestId,
                            email: contactEmail,
                            subject: subject,
                            body: body,
                            action: action,
                            timestamp: new Date().toISOString(),
                            source: 'email-editor-action'
                        })
                    });

                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    showMessage(action === 'approve' ? 'Email approved and sent!' : 'Process stopped successfully!', true);
                    // Disable all buttons and inputs after successful submission
                    actionBtn.disabled = true;
                    submitBtn.disabled = true;
                    applyBtn.disabled = true;
                    document.getElementById('subject').disabled = true;
                    document.getElementById('body').disabled = true;
                    rewriteFeedback.disabled = true;
                    document.querySelectorAll('input[name="action"]').forEach(r => r.disabled = true);
                } catch (error) {
                    showMessage('Action failed: ' + error.message, false);
                    actionBtn.disabled = false;
                } finally {
                    setLoading(false);
                }
            });

            // Form Submit (In-Place Edit) - uses original WEBHOOK_URL
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

                setLoading(true, 'Sending edited email...');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<div class="spinner"></div><span>Sending...</span>';

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
                            action: 'edit',
                            timestamp: new Date().toISOString(),
                            source: 'email-editor'
                        })
                    });

                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    showMessage('Email submitted successfully!', true);
                    // Disable all buttons and inputs after successful submission
                    submitBtn.disabled = true;
                    actionBtn.disabled = true;
                    applyBtn.disabled = true;
                    document.getElementById('subject').disabled = true;
                    document.getElementById('body').disabled = true;
                    rewriteFeedback.disabled = true;
                    document.querySelectorAll('input[name="action"]').forEach(r => r.disabled = true);
                } catch (error) {
                    showMessage('Failed to send: ' + error.message, false);
                } finally {
                    setLoading(false);
                    submitBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg><span>Submit</span>';
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
    // POST /api/rewrite - AI Rewrite endpoint
    // =====================================================
    if (req.method === 'POST' && pathname === '/api/rewrite') {
        try {
            const data = await parseBody(req);
            const { currentBody, feedback } = data;

            if (!currentBody || !feedback) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Missing currentBody or feedback'
                }));
                return;
            }

            if (!GEMINI_API_KEY) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Gemini API key not configured. Set GEMINI_API_KEY environment variable.'
                }));
                return;
            }

            console.log('[AI Rewrite] Processing request...');
            const rewrittenBody = await rewriteEmailWithAI(currentBody, feedback);
            console.log('[AI Rewrite] Successfully rewritten');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                rewrittenBody: rewrittenBody
            }));
        } catch (error) {
            console.error('[AI Rewrite Error]', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message || 'Failed to rewrite email'
            }));
        }
        return;
    }

    // =====================================================
    // POST / or /create - Create new email edit request
    // Returns JSON with unique link
    // =====================================================
    if (req.method === 'POST' && (pathname === '/' || pathname === '/create')) {

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

            console.log('[DEBUG] Received data:', JSON.stringify(data, null, 2));

            // Store the email data with timestamp
            emailStore.set(id, {
                email: data.email || '',  // Contact email (read-only identifier)
                subject: data.subject || '',
                body: data.body || '',
                createdAt: Date.now(),
                submitted: false
            });

            console.log('[DEBUG] Stored data for ID:', id, JSON.stringify(emailStore.get(id), null, 2));

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

        console.log('[DEBUG] Viewing edit form for ID:', id);
        console.log('[DEBUG] Email store size:', emailStore.size);
        console.log('[DEBUG] Retrieved data:', JSON.stringify(emailData, null, 2));

        if (!emailData) {
            // Not found or expired
            console.log('[DEBUG] Data not found for ID:', id);
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
                emailData.action = data.action || 'edit';
                emailData.submitted = true;
                emailData.submittedAt = Date.now();
                console.log(`[Submitted] Request: ${requestId} | Email: ${emailData.email || data.email || 'N/A'} | Action: ${data.action || 'edit'}`);
            }

            // Ensure email is always included in the webhook payload
            const webhookPayload = {
                ...data,
                email: data.email || (emailData ? emailData.email : ''), // Fallback to stored email
            };

            console.log('[Webhook Payload]', JSON.stringify(webhookPayload, null, 2));

            // Forward to n8n webhook
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
    // POST /webhook/action - Proxy to action webhook (Stop/Approve)
    // =====================================================
    if (req.method === 'POST' && pathname === '/webhook/action') {
        try {
            const data = await parseBody(req);
            const requestId = data.requestId;

            // Mark as submitted in our store
            const emailData = emailStore.get(requestId);
            if (emailData) {
                emailData.subject = data.subject || emailData.subject;
                emailData.body = data.body || emailData.body;
                emailData.action = data.action || 'approve';
                emailData.submitted = true;
                emailData.submittedAt = Date.now();
                console.log(`[Action Submitted] Request: ${requestId} | Email: ${emailData.email || data.email || 'N/A'} | Action: ${data.action}`);
            }

            // Ensure email is always included in the webhook payload
            const webhookPayload = {
                ...data,
                email: data.email || (emailData ? emailData.email : ''),
            };

            console.log('[Action Webhook Payload]', JSON.stringify(webhookPayload, null, 2));

            // Forward to action webhook (Stop/Approve)
            const webhookUrl = new URL(N8N_ACTION_WEBHOOK_URL);

            // Add parameters as query string for n8n convenience
            webhookUrl.searchParams.append('action', data.action || 'approve');
            webhookUrl.searchParams.append('requestId', requestId || '');
            webhookUrl.searchParams.append('email', webhookPayload.email || '');

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
                    console.log(`[Action Webhook Forward] Status: ${proxyRes.statusCode}`);
                    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(responseBody || JSON.stringify({ success: true }));
                });
            });

            proxyReq.on('error', (error) => {
                console.error('[Action Webhook Error]', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Failed to forward to action webhook',
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
    // GET / - Return a blank form
    // =====================================================
    if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(generateFormPage('new', '', '', '', 'loaded'));
        return;
    }

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           📧 Email Editor Server (AI Enhanced)                 ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  Server running at: http://localhost:${PORT}                      ║`);
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║  ENDPOINTS:                                                    ║');
    console.log('║                                                                ║');
    console.log('║  POST /           → Create new request, get unique link       ║');
    console.log('║  GET  /edit/:id   → Show form for specific request            ║');
    console.log('║  GET  /status/:id → Check if request was submitted            ║');
    console.log('║  POST /api/rewrite → AI-powered email rewriting               ║');
    console.log('║                                                                ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log('║  AI REWRITE: ' + (GEMINI_API_KEY ? '✅ Enabled' : '❌ Disabled (set GEMINI_API_KEY)') + '                         ║');
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
