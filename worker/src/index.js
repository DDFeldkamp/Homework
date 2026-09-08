const DATA_KEY = "gradescope-deadlines";

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "";
  const allowOrigin = allowed && origin === allowed ? origin : (allowed ? allowed : origin || "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function authorized(request, expected) {
  const supplied = bearer(request);
  return Boolean(expected && supplied && supplied === expected);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {status: 204, headers: corsHeaders(request, env)});
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ok: true}, 200, request, env);
    }

    if (url.pathname === "/sync" && request.method === "POST") {
      if (!authorized(request, env.SYNC_TOKEN)) {
        return jsonResponse({error: "Unauthorized"}, 401, request, env);
      }
      let payload;
      try { payload = await request.json(); }
      catch { return jsonResponse({error: "Invalid JSON"}, 400, request, env); }
      if (!payload || !Array.isArray(payload.assignments)) {
        return jsonResponse({error: "Payload must contain an assignments array"}, 400, request, env);
      }
      await env.DEADLINES_KV.put(DATA_KEY, JSON.stringify(payload));
      return jsonResponse({ok: true, assignments: payload.assignments.length}, 200, request, env);
    }

    if (url.pathname === "/deadlines" && request.method === "GET") {
      if (!authorized(request, env.DASHBOARD_PASSWORD)) {
        return jsonResponse({error: "Unauthorized"}, 401, request, env);
      }
      const raw = await env.DEADLINES_KV.get(DATA_KEY);
      if (!raw) return jsonResponse({synced_at: null, assignments: []}, 200, request, env);
      return new Response(raw, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders(request, env),
        },
      });
    }

    return jsonResponse({error: "Not found"}, 404, request, env);
  },
};
