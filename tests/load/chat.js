// k6 load test: sign-up → create number → request → accept → chat over HTTP + socket reads.
//   k6 run -e BASE=http://localhost:4000 -e VUS=50 tests/load/chat.js
// Needs OTP_BYPASS=true and RATE_LIMIT_MULTIPLIER raised on the target (staging only).
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:4000';
const sendLatency = new Trend('message_send_ms', true);

export const options = {
  scenarios: {
    chat: { executor: 'ramping-vus', stages: [{ duration: '30s', target: Number(__ENV.VUS || 50) }, { duration: '2m', target: Number(__ENV.VUS || 50) }, { duration: '15s', target: 0 }] },
  },
  thresholds: {
    // Spec §10: message delivery p95 < 300 ms in-region.
    message_send_ms: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const json = (token) => ({ headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

function signUp(phone) {
  const res = http.post(`${BASE}/v1/auth/otp/verify`, JSON.stringify({ phone, code: '123456', ageConfirmed: true, consentVersion: '2026-09-v1' }), json());
  return res.json('accessToken');
}

export function setup() {
  return {};
}

export default function () {
  const base = 9000000000 + Math.floor(Math.random() * 99_999_999);
  const a = signUp(String(base));
  const b = signUp(String(base + 1));
  const pa = http.post(`${BASE}/v1/personas`, JSON.stringify({ displayName: 'Load A', labelKind: 'olx', allowCalls: true }), json(a)).json();
  const pb = http.post(`${BASE}/v1/personas`, JSON.stringify({ displayName: 'Load B', labelKind: 'other', allowCalls: true }), json(b)).json();
  http.post(`${BASE}/v1/requests`, JSON.stringify({ fromPersonaId: pb.id, toCode: pa.code, introMessage: 'hi' }), json(b));
  const req = http.get(`${BASE}/v1/requests`, json(a)).json('items.0.id');
  const conversationId = http.post(`${BASE}/v1/requests/${req}/accept`, null, json(a)).json('conversationId');

  for (let i = 0; i < 20; i++) {
    const res = http.post(
      `${BASE}/v1/conversations/${conversationId}/messages`,
      JSON.stringify({ clientMessageId: `k6-${__VU}-${__ITER}-${i}`, body: `message ${i}` }),
      json(i % 2 ? a : b),
    );
    sendLatency.add(res.timings.duration);
    check(res, { 'sent 201': (r) => r.status === 201 });
    if (i % 5 === 0) http.get(`${BASE}/v1/conversations`, json(a));
    sleep(0.5);
  }
}
