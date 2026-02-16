/**
 * /api/execute — Server-side proxy for code execution
 * Uses Godbolt Compiler Explorer API (free, no key needed)
 * Supports: C, C++, Java, Go, Rust, Ruby, PHP, Swift, Perl, Python, and more.
 */

// ─── Godbolt Compiler Explorer ──────────────────────────────────
const GODBOLT_API = 'https://godbolt.org/api';

// Godbolt compiler IDs mapped by language
// These are stable IDs from godbolt.org/api/compilers/{lang}
const GODBOLT_COMPILERS = {
    'c': 'cg141',          // GCC 14.1 for C
    'c++': 'g141',           // GCC 14.1 for C++
    'cpp': 'g141',           // alias
    'java': 'java2101',       // OpenJDK 21.0.1
    'go': 'gl1220',         // Go 1.22.0
    'golang': 'gl1220',         // alias
    'rust': 'r1810',          // Rust 1.81.0
    'python': 'python312',      // CPython 3.12
    'python3': 'python312',
    'ruby': 'ruby340',        // Ruby 3.4.0
    'swift': 'swift510',       // Swift 5.10
    'typescript': 'tsc_0_0_35_gc',  // TypeScript
    'haskell': 'ghc982',         // GHC 9.8.2
    'd': 'dmd2109',        // DMD
    'nim': 'nim200',         // Nim 2.0.0
    'scala': 'scalac3_3_1',    // Scala 3.3.1
    'zig': 'z0130',          // Zig 0.13.0
    'pascal': 'fpc322',         // Free Pascal 3.2.2
    'fortran': 'gfortran141',    // GFortran 14.1
    'ocaml': 'ocaml5_2_0',     // OCaml 5.2.0
    'erlang': 'erl26',          // Erlang
};

// Some languages are better served by alternative APIs
// because Godbolt doesn't support execution for them.
// We'll try Godbolt first, then fallback to showing a message.

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { language, code, stdin } = req.body;

    if (!language || !code) {
        return res.status(400).json({ error: 'Missing "language" or "code" in request body' });
    }

    const langKey = language.toLowerCase().trim();

    // First try Godbolt
    let compilerId = GODBOLT_COMPILERS[langKey];

    // If no direct match, try to auto-discover a compiler
    if (!compilerId) {
        try {
            compilerId = await discoverCompiler(langKey);
        } catch (e) {
            // ignore
        }
    }

    if (!compilerId) {
        return res.status(400).json({
            error: `Unsupported language: "${language}". Supported: ${Object.keys(GODBOLT_COMPILERS).join(', ')}`
        });
    }

    try {
        const result = await executeOnGodbolt(compilerId, code, stdin || '');
        return res.status(200).json(result);
    } catch (err) {
        console.error('Execute proxy error:', err);
        return res.status(502).json({
            error: 'Failed to execute code',
            details: err.message,
        });
    }
};

/**
 * Execute code on Godbolt Compiler Explorer
 */
async function executeOnGodbolt(compilerId, code, stdin) {
    const response = await fetch(`${GODBOLT_API}/compiler/${compilerId}/compile`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({
            source: code,
            options: {
                userArguments: '',
                executeParameters: {
                    args: '',
                    stdin: stdin,
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

    // Normalize to our Piston-compatible format
    const stdout = (data.stdout || []).map(s => s.text).join('\n');
    const stderr = (data.stderr || []).map(s => s.text).join('\n');

    const buildStdout = (data.buildResult?.stdout || []).map(s => s.text).join('\n');
    const buildStderr = (data.buildResult?.stderr || []).map(s => s.text).join('\n');

    return {
        run: {
            stdout: stdout,
            stderr: stderr,
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
}

/**
 * Auto-discover a compiler for a language from Godbolt
 */
async function discoverCompiler(lang) {
    const res = await fetch(`${GODBOLT_API}/compilers/${lang}`, {
        headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const compilers = await res.json();
    // Prefer ones with execution support
    const execCompiler = compilers.find(c => c.supportsExecute);
    return execCompiler?.id || compilers[0]?.id || null;
}
