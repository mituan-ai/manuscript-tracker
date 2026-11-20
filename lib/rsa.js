// RSA PKCS#1 v1.5 公钥加密（与 JSEncrypt 输出一致），用于 TCCT CMS 登录。
// WebCrypto 不支持 PKCS#1 v1.5 加密，所以用 BigInt 实现。

function readDer(bytes, pos) {
  const tag = bytes[pos++];
  let len = bytes[pos++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + bytes[pos++];
  }
  return { tag, start: pos, end: pos + len };
}

function bytesToBigInt(bytes) {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt('0x' + (hex || '0'));
}

function bigIntToBytes(n, len) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

/** 解析 Base64 的 SubjectPublicKeyInfo（-----BEGIN PUBLIC KEY----- 的内容）。 */
export function parsePublicKey(b64) {
  const der = Uint8Array.from(atob(b64.replace(/-----[^-]+-----|\s+/g, '')), (c) => c.charCodeAt(0));
  const spki = readDer(der, 0); // SEQUENCE
  const algo = readDer(der, spki.start); // SEQUENCE (AlgorithmIdentifier)
  const bits = readDer(der, algo.end); // BIT STRING
  const rsaKey = readDer(der, bits.start + 1); // 跳过 unused-bits 字节；SEQUENCE
  const n = readDer(der, rsaKey.start); // INTEGER modulus
  const e = readDer(der, n.end); // INTEGER exponent
  const nBytes = der.slice(n.start, n.end);
  const modulus = bytesToBigInt(nBytes);
  const k = (modulus.toString(16).length + 1) >> 1;
  return { n: modulus, e: bytesToBigInt(der.slice(e.start, e.end)), k };
}

/** 加密字符串，返回 Base64 密文。 */
export function rsaEncrypt(publicKeyB64, text) {
  const { n, e, k } = parsePublicKey(publicKeyB64);
  const m = new TextEncoder().encode(text);
  if (m.length > k - 11) throw new Error('RSA 明文过长');
  const em = new Uint8Array(k);
  em[1] = 0x02;
  const ps = em.subarray(2, k - m.length - 1);
  crypto.getRandomValues(ps);
  for (let i = 0; i < ps.length; i++) while (ps[i] === 0) ps[i] = crypto.getRandomValues(new Uint8Array(1))[0];
  em[k - m.length - 1] = 0;
  em.set(m, k - m.length);
  const c = modPow(bytesToBigInt(em), e, n);
  return btoa(String.fromCharCode(...bigIntToBytes(c, k)));
}
