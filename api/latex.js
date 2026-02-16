/**
 * LaTeX Compilation Proxy
 * Uses YtoTech latex-on-http API (free, no API key)
 * POST /api/latex  â€” compiles LaTeX source and returns PDF
 */
const https = require('https');

module.exports = function latexHandler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, compiler = 'pdflatex' } = req.body;

    if (!code || !code.trim()) {
        return res.status(400).json({ error: 'No LaTeX code provided' });
    }

    // Validate compiler choice
    const validCompilers = ['pdflatex', 'xelatex', 'lualatex', 'platex', 'uplatex'];
    const selectedCompiler = validCompilers.includes(compiler) ? compiler : 'pdflatex';

    // Build request payload for YtoTech API
    const payload = JSON.stringify({
        compiler: selectedCompiler,
        resources: [
            {
                main: true,
                content: code
            }
        ]
    });

    const options = {
        hostname: 'latex.ytotech.com',
        port: 443,
        path: '/builds/sync',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 60000, // 60s timeout for compilation
    };

    const apiReq = https.request(options, (apiRes) => {
        const contentType = (apiRes.headers['content-type'] || '').toLowerCase();
        const chunks = [];

        apiRes.on('data', (chunk) => chunks.push(chunk));
        apiRes.on('end', () => {
            const bodyBuffer = Buffer.concat(chunks);
            const isSuccessStatus = apiRes.statusCode >= 200 && apiRes.statusCode < 300;
            // Be tolerant of leading bytes inserted by intermediaries.
            const pdfSigIndex = bodyBuffer.slice(0, Math.min(bodyBuffer.length, 1024)).indexOf(Buffer.from('%PDF-', 'ascii'));
            const hasPdfHeader = pdfSigIndex >= 0;
            const isPdfResponse =
                contentType.includes('application/pdf') ||
                contentType.includes('application/x-pdf') ||
                hasPdfHeader;

            if (isSuccessStatus && isPdfResponse) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="document-${Date.now()}.pdf"`);
                return res.send(bodyBuffer);
            }

            const body = bodyBuffer.toString('utf-8');
            let errorMsg = 'LaTeX compilation failed';
            try {
                const parsed = JSON.parse(body);
                errorMsg = parsed.logs || parsed.error || parsed.message || body;
            } catch (e) {
                if (hasPdfHeader) {
                    errorMsg = 'Received PDF content from compiler but with an unexpected HTTP status.';
                } else {
                    errorMsg = body || `HTTP ${apiRes.statusCode}`;
                }
            }

            res.status(apiRes.statusCode || 500).json({
                error: 'Compilation failed',
                logs: errorMsg,
            });
        });
    });
    apiReq.on('error', (err) => {
        console.error('LaTeX API error:', err.message);
        res.status(502).json({ error: 'Failed to reach LaTeX compilation service', details: err.message });
    });

    apiReq.on('timeout', () => {
        apiReq.destroy();
        res.status(504).json({ error: 'LaTeX compilation timed out' });
    });

    apiReq.write(payload);
    apiReq.end();
};
