const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// In-memory subscriber store (persists as long as the server runs)
// For production, upgrade to Deno KV: https://deno.com/kv
const subs = new Map();

const KOFI_TOKEN = Deno.env.get("KOFI_TOKEN") || "";
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "";

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // ── POST /kofi-webhook ──────────────────────────────────────────
  if (url.pathname === "/kofi-webhook" && request.method === "POST") {
    let data: Record<string, string>;
    try {
      const form = await request.formData();
      const dataStr = form.get("data") as string;
      data = JSON.parse(dataStr);
    } catch {
      return new Response("Bad request", { status: 400, headers: CORS_HEADERS });
    }

    if (KOFI_TOKEN && data.verification_token !== KOFI_TOKEN) {
      return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
    }

    const email = (data.email || "").toLowerCase().trim();
    if (!email) {
      return new Response("No email", { status: 400, headers: CORS_HEADERS });
    }

    const tierName = (data.tier_name || "").toLowerCase();
    const amount = parseFloat(data.amount || "0");
    let plan = "premium";
    if (tierName.includes("basic")) plan = "basic";
    else if (tierName.includes("premium")) plan = "premium";
    else if (amount > 0 && amount < 9.99) plan = "basic";

    subs.set(email, {
      subscribed: true,
      plan,
      amount,
      type: data.type || "",
      kofi_transaction_id: data.kofi_transaction_id || "",
      updated: Date.now(),
    });

    return new Response("ok", { headers: CORS_HEADERS });
  }

  // ── POST /verify ────────────────────────────────────────────────
  if (url.pathname === "/verify" && request.method === "POST") {
    let body: { email?: string };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ subscribed: false });
    }

    const email = (body.email || "").toLowerCase().trim();
    if (!email) return jsonResponse({ subscribed: false });

    const record = subs.get(email);
    if (!record) return jsonResponse({ subscribed: false });

    return jsonResponse(record);
  }

  // ── POST /admin/set ─────────────────────────────────────────────
  if (url.pathname === "/admin/set" && request.method === "POST") {
    let body: { token?: string; email?: string; subscribed?: boolean; plan?: string };
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400, headers: CORS_HEADERS });
    }

    if (!ADMIN_TOKEN || body.token !== ADMIN_TOKEN) {
      return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
    }

    const email = (body.email || "").toLowerCase().trim();
    if (!email) return new Response("No email", { status: 400, headers: CORS_HEADERS });

    const record = {
      subscribed: !!body.subscribed,
      plan: body.plan || "premium",
      type: "manual",
      updated: Date.now(),
    };
    subs.set(email, record);
    return jsonResponse({ ok: true, record });
  }

  return new Response("Not found", { status: 404, headers: CORS_HEADERS });
});
