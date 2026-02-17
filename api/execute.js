/**
 * /api/execute — Server-side proxy for code execution (Godbolt API).
 */

const GODBOLT_API = 'https://godbolt.org/api';

const GODBOLT_COMPILERS = {
    c: 'cg141',
    'c++': 'g141',
    cpp: 'g141',
    java: 'java2101',
    go: 'gl1220',
    golang: 'gl1220',
    rust: 'r1810',
    python: 'python312',
    python3: 'python312',
    ruby: 'ruby340',
    swift: 'swift510',
    typescript: 'tsc_0_0_35_gc',
    haskell: 'ghc982',
    d: 'dmd2109',
    nim: 'nim200',
    scala: 'scalac3_3_1',
    zig: 'z0130',
    pascal: 'fpc322',
    fortran: 'gfortran141',
    ocaml: 'ocaml5_2_0',
    erlang: 'erl26',
};

const SAFE_EXECUTION_DEFAULTS = {
    allowedLanguages: Object.keys(GODBOLT_COMPILERS),
    maxCodeSize: 20_000,
    maxRuntimeMs: 10_000,
    maxStdoutBytes: 16_000,
};

function normalizeLanguage(language) {
    return String(language || '').toLowerCase().trim();
}

function truncateOutput(value, limit) {
    const text = String(value || '');
    if (Buffer.byteLength(text, 'utf8') <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 64))}\n... [output truncated]`;
}

function enforceExecutionLimits({ language, code, stdin = '', limits = {} }) {
    const maxCodeSize = Number(limits.maxCodeSize || SAFE_EXECUTION_DEFAULTS.maxCodeSize);
    const maxRuntimeMs = Number(limits.maxRuntimeMs || SAFE_EXECUTION_DEFAULTS.maxRuntimeMs);
    const maxStdoutBytes = Number(limits.maxStdoutBytes || SAFE_EXECUTION_DEFAULTS.maxStdoutBytes);
    const allowedLanguages = Array.isArray(limits.allowedLanguages) && limits.allowedLanguages.length > 0
        ? limits.allowedLanguages.map(normalizeLanguage)
        : SAFE_EXECUTION_DEFAULTS.allowedLanguages;

    const langKey = normalizeLanguage(language);
    if (!allowedLanguages.includes(langKey)) {
        throw new Error(`Language "${language}" is not allowed for safe execution.`);
    }
    if (!code || !String(code).trim()) {
        throw new Error('Code is required.');
    }
    if (Buffer.byteLength(String(code), 'utf8') > maxCodeSize) {
        throw new Error(`Code exceeds max allowed size (${maxCodeSize} bytes).`);
    }
    if (Buffer.byteLength(String(stdin || ''), 'utf8') > 8_000) {
        throw new Error('stdin exceeds max allowed size (8000 bytes).');
    }

    return {
        langKey,
        code: String(code),
        stdin: String(stdin || ''),
        maxRuntimeMs,
        maxStdoutBytes,
    };
}

async function executeOnGodbolt(compilerId, code, stdin, maxRuntimeMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), maxRuntimeMs);
    try {
        const response = await fetch(`${GODBOLT_API}/compiler/${compilerId}/compile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
                source: code,
                options: {
                    userArguments: '',
                    executeParameters: {
                        args: '',
                        stdin,
                    },
                    compilerOptions: {
                        executorRequest: true,
                    },
                    filters: {
                        execute: true,
                    },
                },
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Godbolt API error (${response.status}): ${text.slice(0, 200)}`);
        }

        const data = await response.json();
        const stdout = (data.stdout || []).map((s) => s.text).join('\n');
        const stderr = (data.stderr || []).map((s) => s.text).join('\n');
        const buildStdout = (data.buildResult?.stdout || []).map((s) => s.text).join('\n');
        const buildStderr = (data.buildResult?.stderr || []).map((s) => s.text).join('\n');

        return {
            run: {
                stdout,
                stderr,
                signal: data.timedOut ? 'SIGKILL' : null,
                code: data.code,
            },
            compile: {
                stdout: buildStdout,
                stderr: buildStderr,
                code: data.buildResult?.code,
            },
            didExecute: data.didExecute,
            compiler: compilerId,
            language: data.inputFilename || '',
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function discoverCompiler(lang) {
    const res = await fetch(`${GODBOLT_API}/compilers/${lang}`, {
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const compilers = await res.json();
    const execCompiler = compilers.find((c) => c.supportsExecute);
    return execCompiler?.id || compilers[0]?.id || null;
}

async function executeCodeWithLimits({ language, code, stdin = '', limits = {} }) {
    const validated = enforceExecutionLimits({ language, code, stdin, limits });
    let compilerId = GODBOLT_COMPILERS[validated.langKey];
    if (!compilerId) {
        compilerId = await discoverCompiler(validated.langKey);
    }
    if (!compilerId) {
        throw new Error(`Unsupported language: "${language}".`);
    }

    const result = await executeOnGodbolt(
        compilerId,
        validated.code,
        validated.stdin,
        validated.maxRuntimeMs,
    );

    return {
        ...result,
        run: {
            ...result.run,
            stdout: truncateOutput(result.run?.stdout, validated.maxStdoutBytes),
            stderr: truncateOutput(result.run?.stderr, validated.maxStdoutBytes),
        },
        compile: {
            ...result.compile,
            stdout: truncateOutput(result.compile?.stdout, validated.maxStdoutBytes),
            stderr: truncateOutput(result.compile?.stderr, validated.maxStdoutBytes),
        },
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { language, code, stdin } = req.body || {};
    if (!language || !code) {
        return res.status(400).json({ error: 'Missing "language" or "code" in request body' });
    }

    try {
        const result = await executeCodeWithLimits({
            language,
            code,
            stdin: stdin || '',
            limits: SAFE_EXECUTION_DEFAULTS,
        });
        return res.status(200).json(result);
    } catch (err) {
        console.error('Execute proxy error:', err.message);
        return res.status(502).json({
            error: 'Failed to execute code',
            details: err.message,
        });
    }
};

module.exports.executeCodeWithLimits = executeCodeWithLimits;
module.exports.SAFE_EXECUTION_DEFAULTS = SAFE_EXECUTION_DEFAULTS;
module.exports.__test = {
    enforceExecutionLimits,
    truncateOutput,
};
