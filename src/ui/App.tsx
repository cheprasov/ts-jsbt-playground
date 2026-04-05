import React, { useEffect, useMemo, useState } from 'react';
import { JSBT } from '@cheprasov/jsbt';

const samples = [
    `return {
    id: 123456,
    name: 'John Doe',
    isActive: true,
    age: 42,
    tags: ['node', 'typescript', 'binary', 'serialization'],
    scores: Array.from({ length: 100 }, (_, i) => i * 3.14159),
    createdAt: new Date().toISOString(),
    balance: 12345.67,
    meta: {
        retries: 3,
        source: 'playground',
        flags: { a: true, b: false, c: true },
    },
};`,
    `const baseDate = new Date();
const baseScores = Array.from({ length: 20 }, (_, i) => i * 1.2345);

return Array.from({ length: 10_000 }, (_, i) => ({
    id: i % 100,
    name: \`User \${i % 50}\`,
    isActive: i % 3 !== 0,
    age: 25 + (i % 5),
    tags: ['node', 'typescript', 'binary', 'serialization']
        .sort(() => Math.random() * 2 - 1)
        .slice(0, 3)
        .sort(),
    scores: baseScores,
    createdAt: baseDate.toISOString(),
    balance: 1000 + (i % 10),
    meta: {
        retries: i % 3,
        source: 'bulk-playground',
        flags: { a: true, b: false, c: true },
        group: \`group-\${i % 10}\`,
    },
}));
`,
];

type EncodeResult = {
    payload: string;
    sizeBytes: number;
    encodeMs: number;
};

type DecodeResult = {
    value: any;
    decodeMs: number;
};

function nowMs(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function strToBytesLatin1(str: string): Uint8Array {
    // JSBT payload is a string where each charCode is a byte (0..255),
    // and sometimes a 2-byte sequence is used internally. For display we treat
    // charCode as bytes the same way JSBT ByteStream reads it.
    // This is best-effort for UI stats.
    const arr: number[] = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c <= 0xff) {
            arr.push(c);
        } else {
            // two-byte char: low byte first, then high byte
            arr.push(c & 0xff, (c & 0xff00) >>> 8);
        }
    }
    return new Uint8Array(arr);
}

function toBase64(bytes: Uint8Array): string {
    // browser-safe base64
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        bin += String.fromCharCode(...slice);
    }
    return btoa(bin);
}

function prettyBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const kb = n / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
}

function safePreview(value: unknown): string {
    const seen = new WeakSet<object>();

    const replacer = (_key: string, v: any) => {
        if (typeof v === 'bigint') return `BigInt(${v.toString()})`;
        if (typeof v === 'symbol') return `Symbol(${String(v).slice(7, -1)})`;
        if (v instanceof Date) return { $type: 'Date', value: v.toISOString() };

        if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) {
            return { $type: 'ArrayBuffer', byteLength: v.byteLength };
        }

        if (typeof Uint8Array !== 'undefined' && v instanceof Uint8Array) {
            return {
                $type: 'Uint8Array',
                length: v.length,
                previewHex: bytesToHex(v.subarray(0, 32)) + (v.length > 32 ? '…' : ''),
            };
        }

        if (v && typeof v === 'object') {
            if (seen.has(v)) return { $ref: true };
            seen.add(v);

            if (v instanceof Map) {
                return { $type: 'Map', entries: Array.from(v.entries()).slice(0, 50) };
            }
            if (v instanceof Set) {
                return { $type: 'Set', values: Array.from(v.values()).slice(0, 50) };
            }
        }

        return v;
    };

    try {
        return JSON.stringify(value, replacer, 2);
    } catch {
        // Fallback for very weird cases
        return String(value);
    }
}

function getSample() {
    return samples.sort(() => Math.random() * 2 - 1)[0];
}

function encodeValue(value: unknown): EncodeResult {
    const t0 = nowMs();
    const payload = JSBT.encode(value as any);
    const t1 = nowMs();
    const bytes = strToBytesLatin1(payload);
    return { payload, sizeBytes: bytes.byteLength, encodeMs: t1 - t0 };
}

function decodeValue(payload: string): DecodeResult {
    const t0 = nowMs();
    const value = JSBT.decode(payload);
    const t1 = nowMs();
    return { value, decodeMs: t1 - t0 };
}

export default function App() {
    const sample = useMemo(() => getSample(), []);

    const [inputText, setInputText] = useState<string>(sample);

    const [lastEncodedJSONSize, setLastEncodedJSONSize] = useState<number | null>(null);
    const [lastEncoded, setLastEncoded] = useState<EncodeResult | null>(null);
    const [lastDecoded, setLastDecoded] = useState<DecodeResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setError(null);
        setLastEncodedJSONSize(null);
        setLastEncoded(null);
        setLastDecoded(null);
    }, []);

    const payloadBytes = useMemo(() => (lastEncoded ? strToBytesLatin1(lastEncoded.payload) : null), [lastEncoded]);
    const payloadHex = useMemo(() => (payloadBytes ? bytesToHex(payloadBytes) : ''), [payloadBytes]);
    const payloadBin = useMemo(() => (payloadBytes ? bytesToBin(payloadBytes) : ''), [payloadBytes]);

    const onEncode = () => {
        setError(null);
        try {
            const v = eval(`(function InputFunc(){ ${inputText} })();`);
            const enc = encodeValue(v);
            console.log('Original value', v);
            console.log('Encoded JSBT', enc.payload);
            try {
                setLastEncodedJSONSize(JSON.stringify(v).length);
            } catch (e) {
                setLastEncodedJSONSize(0);
            }
            setLastEncoded(enc);
            const dec = decodeValue(enc.payload);
            setLastDecoded(dec);
            console.log('Decoded JSBT', dec.value);
        } catch (e: any) {
            setError(e?.message ? String(e.message) : String(e));
        }
    };

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <div>
                        <div className="title">JSBT Playground (JSBT v1.3.2)</div>
                    </div>
                </div>

                <div className="topActions">
                    <a className="link" href="https://github.com/cheprasov/ts-jsbt" target="_blank" rel="noreferrer">
                        GitHub
                    </a>
                </div>
            </header>

            <div className="grid">
                <section className="card">
                    <div className="cardHeader">
                        <div>
                            <div className="cardTitle">Eval Input</div>
                            <div className="cardHint"></div>
                        </div>
                    </div>

                    <textarea
                        className="editor"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        spellCheck={false}
                    />
                    <div className="buttons">
                        <button className="btn primary" onClick={onEncode}>
                            Encode
                        </button>
                    </div>

                    {error ? (
                        <div className="error">
                            <strong>Error:</strong> {error}
                        </div>
                    ) : null}

                    <div className="split" style={{ marginTop: 24 }}>
                        <div className="pane">
                            <div className="paneHeader">
                                <span>Binary </span>
                                {payloadBytes ? <span className="muted">({payloadBytes.byteLength} bytes)</span> : null}
                            </div>
                            <textarea
                                className="mono"
                                value={lastEncoded?.payload}
                                readOnly
                                spellCheck={false}
                                placeholder="Encode something to see base64"
                            />
                        </div>

                        <div className="pane" style={{ marginTop: 12 }}>
                            <div className="paneHeader">Hex</div>
                            <textarea
                                className="mono"
                                value={payloadHex}
                                readOnly
                                spellCheck={false}
                                placeholder="Encode something to see hex"
                            />
                        </div>

                        <div className="pane" style={{ marginTop: 12 }}>
                            <div className="paneHeader">Bin</div>
                            <textarea
                                className="mono"
                                value={payloadBin}
                                readOnly
                                spellCheck={false}
                                placeholder="Encode something to see bin"
                            />
                        </div>
                    </div>
                    <div className="pane" style={{ marginTop: 12 }}>
                        <div className="paneHeader">Decoded preview (see console for better output)</div>
                        <pre className="preview">{lastDecoded ? safePreview(lastDecoded.value) : '—'}</pre>
                    </div>
                </section>

                <section className="card">
                    <div className="cardHeader">
                        <div>
                            <div className="cardTitle">Output</div>
                            <div className="cardHint">Payload stats, base64/hex preview, and decoded preview.</div>
                        </div>
                    </div>

                    <div className="statsRow">
                        <Stat label="JSON size" value={lastEncodedJSONSize ? prettyBytes(lastEncodedJSONSize) : '—'} />
                        <Stat
                            label="JSBT size"
                            value={lastEncoded ? prettyBytes(lastEncoded.sizeBytes) : '—'}
                            value2={
                                lastEncodedJSONSize && lastEncoded
                                    ? ` - ${Math.round((lastEncoded.sizeBytes / lastEncodedJSONSize) * 100)}% of JSON`
                                    : ''
                            }
                        />
                        <Stat label="Encode time" value={lastEncoded ? `${lastEncoded.encodeMs.toFixed(2)} ms` : '—'} />
                        <Stat label="Decode time" value={lastDecoded ? `${lastDecoded.decodeMs.toFixed(2)} ms` : '—'} />
                    </div>

                    <div className="footnote">
                        <div>
                            <strong>Note:</strong> This UI uses JSON.parse for the JSON tab. JSBT itself does not
                            evaluate code during decoding.
                        </div>
                    </div>
                </section>
            </div>

            <footer className="footer">
                <div className="footerInner">
                    <span className="muted">
                        Tip: Use the “Repeated” dataset to see how graph-like encoding can deduplicate shared
                        sub-structures.
                    </span>
                </div>
            </footer>
        </div>
    );
}

function Button(props: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    disabled?: boolean;
}) {
    const variant = props.variant ?? 'secondary';
    return (
        <button className={`btn btn--${variant}`} onClick={props.onClick} disabled={props.disabled} type="button">
            {props.children}
        </button>
    );
}

function Stat(props: { label: string; value: string; value2?: string }) {
    return (
        <div className="stat">
            <div className="stat__label">{props.label}</div>
            <div className="stat__value">
                {props.value}
                {props.value2 ? ` ${props.value2}` : ''}
            </div>
        </div>
    );
}

function formatBytes(n: number): string {
    if (!Number.isFinite(n)) return String(n);
    if (n < 1024) return `${n} B`;
    const kb = n / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
}

function bytesToHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        out += b.toString(16).padStart(2, '0');
        if (i !== bytes.length - 1) out += ' ';
    }
    return out;
}

function bytesToBin(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        out += b.toString(2).padStart(8, '0');
        if (i !== bytes.length - 1) out += ' ';
    }
    return out;
}

function base64FromBytes(bytes: Uint8Array): string {
    // Browser-safe base64
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function bytesFromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
}

function stringifyPreview(value: unknown): string {
    const seen = new WeakSet<object>();

    const replacer = (_key: string, v: any) => {
        if (v && typeof v === 'object') {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);

            if (v instanceof Date) {
                return { $type: 'Date', value: v.toISOString() };
            }
            if (v instanceof Set) {
                return { $type: 'Set', values: Array.from(v.values()) };
            }
            if (v instanceof Map) {
                return { $type: 'Map', entries: Array.from(v.entries()) };
            }
            if (v instanceof ArrayBuffer) {
                return { $type: 'ArrayBuffer', byteLength: v.byteLength };
            }
            if (ArrayBuffer.isView(v)) {
                const ctor = v.constructor?.name ?? 'TypedArray';
                const arr = Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
                return { $type: ctor, byteLength: v.byteLength, bytes: arr.slice(0, 64), truncated: arr.length > 64 };
            }
        }
        return v;
    };

    try {
        return JSON.stringify(value, replacer, 2);
    } catch {
        return String(value);
    }
}
