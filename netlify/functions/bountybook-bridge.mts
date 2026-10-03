import type { Context, Config } from "@netlify/functions";
import { Wallet } from "ethers";

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const EXPECTED_AUD = "bboss-bountybook-write-v1";
const EXPECTED_REPO = "keketu1987-hue/ai-order-radar";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_SUB = "repo:keketu1987-hue@328019399/ai-order-radar@1366314604:ref:refs/heads/main";
const API = "https://api.bountybook.ai";
const MAX_REWARD_USD = 25;
const ALLOWED_ACTIONS = new Set(["status", "wallet_status", "claim", "queue", "submit"]);

function b64urlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function decodeJsonPart(part: string): any {
  return JSON.parse(Buffer.from(b64urlToBytes(part)).toString("utf8"));
}

async function verifyGithubOidc(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("bad_jwt_shape");
  const header = decodeJsonPart(parts[0]);
  const payload = decodeJsonPart(parts[1]);

  if (header.alg !== "RS256" || !header.kid) throw new Error("bad_jwt_header");
  if (payload.iss !== EXPECTED_ISSUER) throw new Error("bad_issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(EXPECTED_AUD)) throw new Error("bad_audience");
  if (payload.repository !== EXPECTED_REPO) throw new Error("bad_repository");
  if (payload.ref !== EXPECTED_REF) throw new Error("bad_ref");
  if (payload.event_name !== "push") throw new Error("bad_event");
  if (payload.sub !== EXPECTED_SUB) throw new Error("bad_subject");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) throw new Error("expired");
  if (typeof payload.iat !== "number" || payload.iat > now + 60) throw new Error("bad_iat");

  const cfg: any = await fetch(`${EXPECTED_ISSUER}/.well-known/openid-configuration`).then(async r => {
    if (!r.ok) throw new Error("oidc_config_failed");
    return r.json();
  });
  const jwks: any = await fetch(cfg.jwks_uri).then(async r => {
    if (!r.ok) throw new Error("jwks_failed");
    return r.json();
  });
  const jwk = jwks.keys?.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error("kid_not_found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error("bad_signature");
}

async function apiJson(path: string, init?: RequestInit) {
  const r = await fetch(`${API}${path}`, init);
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
  return { ok: r.ok, status: r.status, body };
}

function getSigner(): Wallet | null {
  const raw = Netlify.env.get("BOSS_EVM_PRIVATE_KEY")?.trim();
  if (!raw) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error("invalid_private_key_format");
  return new Wallet(raw);
}

async function getSession(wallet: Wallet) {
  const nonceResp = await apiJson(`/auth/nonce?address=${encodeURIComponent(wallet.address)}`);
  if (!nonceResp.ok) throw new Error(`nonce_failed_${nonceResp.status}`);
  const nonce = nonceResp.body?.nonce;
  if (typeof nonce !== "string" || nonce.length < 8) throw new Error("bad_nonce");
  const signature = await wallet.signMessage(nonce);
  const verifyResp = await apiJson("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  if (!verifyResp.ok || typeof verifyResp.body?.token !== "string") {
    throw new Error(`auth_verify_failed_${verifyResp.status}`);
  }
  return verifyResp.body.token as string;
}

function rewardUsd(job: any): number | null {
  const x = job?.budget_usdc ?? job?.budgetUsdc ?? job?.reward_usdc ?? job?.rewardUsd ?? job?.price_usd ?? job?.priceUsd;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return Response.json({ ok: false, error: "missing_oidc" }, { status: 401 });
  try { await verifyGithubOidc(auth.slice(7)); }
  catch (e: any) {
    return Response.json({ ok: false, error: "oidc_rejected", detail: String(e?.message || e) }, { status: 401 });
  }

  let input: any;
  try { input = await req.json(); }
  catch { return Response.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  const action = String(input?.action || "");
  if (!ALLOWED_ACTIONS.has(action)) {
    return Response.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  }

  if (action === "status") {
    const [stats, jobs] = await Promise.all([
      apiJson("/stats"),
      apiJson("/jobs?status=open"),
    ]);
    return Response.json({
      ok: stats.ok && jobs.ok,
      action,
      stats_status: stats.status,
      jobs_status: jobs.status,
      stats: stats.body,
      jobs: jobs.body,
      policy: {
        signer_scope: "EIP-191 BountyBook auth nonce only",
        arbitrary_message_signing: false,
        transactions: false,
        token_approvals: false,
        transfers: false,
        x402_payments: false,
        max_reward_usd: MAX_REWARD_USD,
      },
    }, { status: stats.ok && jobs.ok ? 200 : 502 });
  }

  let wallet: Wallet | null;
  try { wallet = getSigner(); }
  catch (e: any) {
    return Response.json({ ok: false, action, error: String(e?.message || e) }, { status: 503 });
  }

  if (action === "wallet_status") {
    return Response.json({
      ok: true,
      action,
      configured: Boolean(wallet),
      address: wallet?.address ?? null,
      policy: {
        signer_scope: "EIP-191 BountyBook auth nonce only",
        arbitrary_message_signing: false,
        transactions: false,
        token_approvals: false,
        transfers: false,
        x402_payments: false,
      },
    });
  }

  if (!wallet) {
    return Response.json({
      ok: false,
      action,
      error: "BOSS_EVM_PRIVATE_KEY_NOT_CONNECTED",
      remediation: "Set BOSS_EVM_PRIVATE_KEY as a secret Netlify production env var. Never paste it into chat.",
    }, { status: 503 });
  }

  const jobId = String(input?.job_id || "").trim();
  if (!/^[0-9a-fA-F-]{20,80}$/.test(jobId)) {
    return Response.json({ ok: false, action, error: "bad_job_id" }, { status: 400 });
  }

  const jr = await apiJson(`/jobs/${encodeURIComponent(jobId)}`);
  if (!jr.ok) {
    return Response.json({ ok: false, action, error: "job_lookup_failed", upstream_status: jr.status }, { status: 400 });
  }

  const reward = rewardUsd(jr.body);
  if (reward !== null && (reward <= 0 || reward > MAX_REWARD_USD)) {
    return Response.json({ ok: false, action, error: "reward_outside_policy", reward_usd: reward }, { status: 400 });
  }

  if (action === "claim" && String(jr.body?.status || "").toLowerCase() !== "open") {
    return Response.json({ ok: false, action, error: "job_not_open", job_status: jr.body?.status ?? null }, { status: 409 });
  }

  let token: string;
  try { token = await getSession(wallet); }
  catch (e: any) {
    return Response.json({ ok: false, action, error: String(e?.message || e) }, { status: 502 });
  }
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  if (action === "claim") {
    const cr = await apiJson(`/jobs/${encodeURIComponent(jobId)}/claim`, {
      method: "POST",
      headers,
      body: JSON.stringify({ executorAddress: wallet.address }),
    });
    return Response.json({
      ok: cr.ok,
      action,
      upstream_status: cr.status,
      job_id: jobId,
      executor_address: wallet.address,
      reward_usd: reward,
      result: cr.body,
    }, { status: cr.ok ? 200 : 409 });
  }

  if (action === "queue") {
    const qr = await apiJson(`/jobs/${encodeURIComponent(jobId)}/queue`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentAddress: wallet.address }),
    });
    return Response.json({
      ok: qr.ok,
      action,
      upstream_status: qr.status,
      job_id: jobId,
      executor_address: wallet.address,
      result: qr.body,
    }, { status: qr.ok ? 200 : 409 });
  }

  if (action === "submit") {
    const outputData = input?.output_data;
    const outputCID = input?.output_cid;
    const hasData = outputData && typeof outputData === "object";
    const hasCid = typeof outputCID === "string" && outputCID.length > 10 && outputCID.length < 200;
    if (!hasData && !hasCid) {
      return Response.json({ ok: false, action, error: "missing_output" }, { status: 400 });
    }
    const payload: any = { executorAddress: wallet.address };
    if (hasData) payload.outputData = outputData;
    if (hasCid) payload.outputCID = outputCID;
    const sr = await apiJson(`/jobs/${encodeURIComponent(jobId)}/submit`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    return Response.json({
      ok: sr.ok,
      action,
      upstream_status: sr.status,
      job_id: jobId,
      executor_address: wallet.address,
      result: sr.body,
    }, { status: sr.ok ? 200 : 409 });
  }

  return Response.json({ ok: false, error: "unsupported_action" }, { status: 400 });
};

export const config: Config = { path: "/api/bountybook-bridge" };
