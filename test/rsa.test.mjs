// RSA PKCS#1 v1.5：用 Node 生成密钥对，加密后用私钥解密核对。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rsaEncrypt, parsePublicKey } from '../lib/rsa.js';

test('与 TCCT 页面里的 1024 位公钥格式兼容', () => {
  const tcct = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCXzo4R33qV3O+ZoG3xZNIAndQEmly3PBa6Euq7XOUNe//aODllAIAgRa71wE/p9DR2c0pG0YiEyWSp6FYWoKOBDBIoAupMmh0ZlVFM3u9G5Ah6o1OJIRsQz88KsWhEN72fRh/B1p5cba2sadlZB6BDmtPvD/DK6h00f0lqAZeYDwIDAQAB';
  const { e, k } = parsePublicKey(tcct);
  assert.equal(e, 65537n);
  assert.equal(k, 128);
  assert.equal(atob(rsaEncrypt(tcct, '12345')).length, 128);
});

test('加密结果可被私钥解密', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  // Node 22 禁用了 PKCS#1 v1.5 私钥解密，这里用私钥参数手动计算 c^d mod n 再拆填充
  const jwk = privateKey.export({ format: 'jwk' });
  const big = (b64u) => BigInt('0x' + Buffer.from(b64u, 'base64url').toString('hex'));
  const n = big(jwk.n), d = big(jwk.d);
  const modPow = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; };
  for (const msg of ['12345', 'p@ss w0rd!', '中文密码']) {
    for (let i = 0; i < 20; i++) {
      const ct = Buffer.from(rsaEncrypt(pem, msg), 'base64');
      assert.equal(ct.length, 128);
      const em = Buffer.from(modPow(BigInt('0x' + ct.toString('hex')), d, n).toString(16).padStart(256, '0'), 'hex');
      assert.equal(em[0], 0);
      assert.equal(em[1], 2);
      const sep = em.indexOf(0, 2);
      assert.ok(sep >= 10, '填充至少 8 个非零字节');
      assert.equal(em.subarray(sep + 1).toString('utf8'), msg);
    }
  }
});
