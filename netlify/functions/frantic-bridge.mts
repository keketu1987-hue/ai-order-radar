import type { Context, Config } from "@netlify/functions";

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const EXPECTED_AUD = "bboss-frantic-write-v1";
const EXPECTED_REPO = "keketu1987-hue/ai-order-radar";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_SUB = "repo:keketu1987-hue@328019399/ai-order-radar@1366314604:ref:refs/heads/main";
const AGENT_KID = "agent-77d7ed";

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

  const cfg = await fetch(`${EXPECTED_ISSUER}/.well-known/openid-configuration`).then(async r => {
    if (!r.ok) throw new Error("oidc_config_failed");
    return r.json();
  });
  const jwks = await fetch(cfg.jwks_uri).then(async r => {
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
  return payload;
}

async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
  return { ok: r.ok, status: r.status, body };
}

function extractPriceCents(b: any): number | null {
  const candidates = [
    b?.price_cents,
    b?.priceCents,
    typeof b?.priceUsd === "number" ? Math.round(b.priceUsd * 100) : null,
    typeof b?.price_usd === "number" ? Math.round(b.price_usd * 100) : null,
  ];
  for (const x of candidates) if (Number.isInteger(x) && x >= 0) return x;
  return null;
}

function extractAvailable(b: any): number | null {
  const candidates = [
    b?.claim_progress?.available,
    b?.claimProgress?.available,
    b?.available_slots,
    b?.availableSlots,
  ];
  for (const x of candidates) if (Number.isInteger(x)) return x;
  return null;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return Response.json({ ok: false, error: "missing_oidc" }, { status: 401 });

  try {
    await verifyGithubOidc(auth.slice(7));
  } catch (e: any) {
    return Response.json({ ok: false, error: "oidc_rejected", detail: String(e?.message || e) }, { status: 401 });
  }

  let input: any;
  try { input = await req.json(); }
  catch { return Response.json({ ok: false, error: "bad_json" }, { status: 400 }); }

  if (input.action === "status") {
    const r = await json(`https://gofrantic.com/v1/agents/${AGENT_KID}/status`);
    return Response.json({ ok: r.ok, upstream_status: r.status, result: r.body }, { status: r.ok ? 200 : 502 });
  }

  const token = Netlify.env.get("FRANTIC_AGENT_TOKEN");
  if (!token) return Response.json({ ok: false, error: "MISSING_FRANTIC_AGENT_TOKEN" }, { status: 503 });

  if (input.action === "claim") {
    const bounty = String(input.bounty || "").trim();
    if (!/^(?:\d+|p-[a-z0-9]+)$/i.test(bounty)) {
      return Response.json({ ok: false, error: "bad_bounty_id" }, { status: 400 });
    }

    const br = await json(`https://gofrantic.com/v1/bounties/${encodeURIComponent(bounty)}`);
    if (!br.ok) return Response.json({ ok: false, error: "bounty_lookup_failed", upstream_status: br.status }, { status: 400 });

    const cents = extractPriceCents(br.body);
    const available = extractAvailable(br.body);
    if (cents === null || cents <= 0 || cents > 1000) {
      return Response.json({ ok: false, error: "bounty_price_not_allowed", price_cents: cents }, { status: 400 });
    }
    if (available !== null && available < 1) {
      return Response.json({ ok: false, error: "no_available_slots", available }, { status: 409 });
    }

    const sr = await json(`https://gofrantic.com/v1/agents/${AGENT_KID}/status`);
    const active = sr.body?.activeClaims ?? sr.body?.active_claims ?? sr.body?.work?.activeClaims ?? 0;
    if (Number(active) > 0) {
      return Response.json({ ok: false, error: "active_claim_exists", active_claims: active }, { status: 409 });
    }

    const cr = await json("https://gofrantic.com/v1/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bounty, agent_kid: AGENT_KID, agent_token: token }),
    });
    return Response.json(
      { ok: cr.ok, upstream_status: cr.status, result: cr.body },
      { status: cr.ok ? 200 : 409 },
    );
  }

  if (input.action === "submit") {
    const claimId = String(input.claim_id || "").trim();
    const refs = Array.isArray(input.artifact_refs) ? input.artifact_refs : [];
    if (!/^[0-9a-f-]{32,120}$/i.test(claimId)) {
      return Response.json({ ok: false, error: "bad_claim_id" }, { status: 400 });
    }
    if (refs.length < 1 || refs.length > 20 || refs.some((x: any) => typeof x !== "string" || x.length > 2000)) {
      return Response.json({ ok: false, error: "bad_artifact_refs" }, { status: 400 });
    }

    const dr = await json("https://gofrantic.com/v1/deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim_id: claimId, agent_kid: AGENT_KID, agent_token: token, artifact_refs: refs }),
    });
    return Response.json(
      { ok: dr.ok, upstream_status: dr.status, result: dr.body },
      { status: dr.ok ? 200 : 409 },
    );
  }

  return Response.json({ ok: false, error: "unsupported_action" }, { status: 400 });
};

export const config: Config = { path: "/api/frantic-bridge" };
