const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://your-n8n-instance.com/webhook/your-webhook-id';
// ============================================================

// Read the HTML template
const htmlTemplate = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Parse request body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                // Try JSON first
                if (req.headers['content-type']?.includes('application/json')) {
                    resolve(JSON.parse(body));
                }
                // Try form-urlencoded
                else if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(body);
                    resolve({
                        subject: params.get('subject') || '',
                        body: params.get('body') || ''
                    });
                }
                // Try to auto-detect
                else if (body.trim().startsWith('{')) {
                    resolve(JSON.parse(body));
                } else {
                    const params = new URLSearchParams(body);
                    resolve({
                        subject: params.get('subject') || '',
                        body: params.get('body') || ''
                    });
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

// Generate page with injected data
function generatePage(subject, body) {
    // Inject the data into the page using a script that runs on load
    const dataScript = `
    <script>
        window.addEventListener('DOMContentLoaded', function() {
            document.getElementById('subject').value = ${JSON.stringify(subject || '')};
            document.getElementById('body').value = ${JSON.stringify(body || '')};
            if (${JSON.stringify(subject || '')} || ${JSON.stringify(body || '')}) {
                document.getElementById('statusText').textContent = 'Email loaded - ready to edit';
                document.getElementById('statusBadge').classList.add('loaded');
                document.getElementById('initLoading').classList.add('hidden');
            }
        });
    </script>
    </body>`;

    // Also update the webhook URL in the page
    let page = htmlTemplate.replace(
        "const WEBHOOK_URL = 'https://your-n8n-instance.com/webhook/your-webhook-id';",
        `const WEBHOOK_URL = '${N8N_WEBHOOK_URL}';`
    );

    // Inject the data script
    page = page.replace('</body>', dataScript);

    return page;
}

// Create server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    // Handle POST to receive email data
    if (req.method === 'POST' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/edit')) {
        try {
            const data = await parseBody(req);
            console.log('Received payload:', data);

            const page = generatePage(data.subject, data.body);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(page);
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server Error');
        }
        return;
    }

    // Handle GET with query parameters
    if (req.method === 'GET' && (parsedUrl.pathname === '/' || parsedUrl.pathname === '/edit')) {
        const subject = parsedUrl.query.subject || '';
        const body = parsedUrl.query.body || '';

        const page = generatePage(subject, body);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
        return;
    }

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           📧 Email Editor Server Running                   ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  HTTP Endpoint: http://localhost:${PORT}/                     ║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  USAGE:                                                    ║');
    console.log('║                                                            ║');
    console.log('║  POST (JSON):                                              ║');
    console.log(`║    curl -X POST http://localhost:${PORT}/ \\                   ║`);
    console.log('║      -H "Content-Type: application/json" \\                 ║');
    console.log('║      -d \'{"subject":"Hello","body":"Email content"}\'       ║');
    console.log('║                                                            ║');
    console.log('║  POST (Form):                                              ║');
    console.log(`║    curl -X POST http://localhost:${PORT}/ \\                   ║`);
    console.log('║      -d "subject=Hello&body=Email content"                 ║');
    console.log('║                                                            ║');
    console.log('║  GET:                                                      ║');
    console.log(`║    http://localhost:${PORT}/?subject=Hello&body=Content       ║`);
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
});
