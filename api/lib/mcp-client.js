const { spawn } = require('node:child_process');

function parseArgs(rawArgs) {
    if (!rawArgs) return [];
    if (Array.isArray(rawArgs)) return rawArgs.map((v) => String(v));
    return String(rawArgs)
        .split(' ')
        .map((v) => v.trim())
        .filter(Boolean);
}

function createStdioMcpClient(command, args = [], env = process.env) {
    const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
    });

    let closed = false;
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
    child.on('exit', () => { closed = true; });

    let buffer = Buffer.alloc(0);
    const pending = [];
    const notifications = [];

    child.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;

            const headerText = buffer.slice(0, headerEnd).toString('utf8');
            const lenMatch = headerText.match(/Content-Length:\s*(\d+)/i);
            if (!lenMatch) {
                buffer = buffer.slice(headerEnd + 4);
                continue;
            }

            const contentLength = Number(lenMatch[1]);
            const total = headerEnd + 4 + contentLength;
            if (buffer.length < total) break;

            const body = buffer.slice(headerEnd + 4, total).toString('utf8');
            buffer = buffer.slice(total);

            let json;
            try {
                json = JSON.parse(body);
            } catch {
                continue;
            }

            if (Object.prototype.hasOwnProperty.call(json, 'id')) {
                const idx = pending.findIndex((p) => p.id === json.id);
                if (idx !== -1) {
                    const [req] = pending.splice(idx, 1);
                    if (json.error) req.reject(new Error(json.error.message || 'MCP request failed.'));
                    else req.resolve(json.result);
                }
            } else {
                notifications.push(json);
            }
        }
    });

    let reqId = 1;
    function request(method, params = {}) {
        if (closed) return Promise.reject(new Error('MCP process is closed.'));
        const id = reqId++;
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        const framed = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;

        return new Promise((resolve, reject) => {
            pending.push({ id, resolve, reject });
            child.stdin.write(framed, 'utf8', (err) => {
                if (err) {
                    const idx = pending.findIndex((p) => p.id === id);
                    if (idx !== -1) pending.splice(idx, 1);
                    reject(err);
                }
            });
        });
    }

    function notify(method, params = {}) {
        if (closed) return;
        const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
        const framed = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
        child.stdin.write(framed, 'utf8');
    }

    async function close() {
        if (closed) return;
        child.kill('SIGTERM');
    }

    return {
        request,
        notify,
        close,
        notifications,
        getStderr: () => stderr.join(''),
    };
}

module.exports = {
    createStdioMcpClient,
    parseArgs,
};
