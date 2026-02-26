var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.ts
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://timesweeper.pages.dev",
  "https://timesweeper.app"
]);
function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}
__name(isAllowedOrigin, "isAllowedOrigin");
function shouldAllowLocalhost(env) {
  return env.ALLOW_LOCALHOST_ORIGIN === "true";
}
__name(shouldAllowLocalhost, "shouldAllowLocalhost");
function isLocalhostOrigin(origin) {
  return origin === "http://localhost:5173";
}
__name(isLocalhostOrigin, "isLocalhostOrigin");
function isAllowedOriginForEnv(origin, env) {
  if (!origin) return true;
  if (isAllowedOrigin(origin)) return true;
  if (shouldAllowLocalhost(env) && isLocalhostOrigin(origin)) return true;
  return false;
}
__name(isAllowedOriginForEnv, "isAllowedOriginForEnv");
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedOriginForEnv(origin, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function json(data, request, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request, env)
    }
  });
}
__name(json, "json");
function noContent(request, env, status = 204) {
  return new Response(null, { status, headers: corsHeaders(request, env) });
}
__name(noContent, "noContent");
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
function matchEventPath(pathname) {
  const ws = pathname.match(/^\/api\/events\/([^/]+)\/ws$/);
  if (ws) return { kind: "ws", eventId: decodeURIComponent(ws[1]) };
  const participant = pathname.match(/^\/api\/events\/([^/]+)\/participants\/([^/]+)$/);
  if (participant) {
    return {
      kind: "participant",
      eventId: decodeURIComponent(participant[1]),
      participantName: decodeURIComponent(participant[2])
    };
  }
  const event = pathname.match(/^\/api\/events\/([^/]+)$/);
  if (event) return { kind: "event", eventId: decodeURIComponent(event[1]) };
  return null;
}
__name(matchEventPath, "matchEventPath");
var worker_default = {
  async fetch(request, env) {
    if (!isAllowedOriginForEnv(request.headers.get("Origin"), env)) {
      return json({ error: "origin_not_allowed" }, request, env, 403);
    }
    if (request.method === "OPTIONS") return noContent(request, env);
    const url = new URL(request.url);
    const route = matchEventPath(url.pathname);
    if (!route) return json({ error: "not_found" }, request, env, 404);
    const id = env.EVENT_ROOMS.idFromName(route.eventId);
    const stub = env.EVENT_ROOMS.get(id);
    return stub.fetch(request);
  }
};
var EventRoom = class {
  static {
    __name(this, "EventRoom");
  }
  state;
  env;
  clients;
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = /* @__PURE__ */ new Set();
  }
  async getEvent() {
    const event = await this.state.storage.get("event");
    return event ?? null;
  }
  async setEvent(event) {
    await this.state.storage.put("event", event);
  }
  broadcast(message) {
    const text = JSON.stringify(message);
    for (const ws of this.clients) {
      try {
        ws.send(text);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
  attachSocket(ws) {
    this.clients.add(ws);
    ws.addEventListener("close", () => this.clients.delete(ws));
    ws.addEventListener("error", () => this.clients.delete(ws));
    ws.addEventListener("message", () => {
    });
  }
  async fetch(request) {
    if (!isAllowedOriginForEnv(request.headers.get("Origin"), this.env)) {
      return json({ error: "origin_not_allowed" }, request, this.env, 403);
    }
    const url = new URL(request.url);
    const route = matchEventPath(url.pathname);
    if (!route) return json({ error: "not_found" }, request, this.env, 404);
    if (route.kind === "ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return json({ error: "expected_websocket_upgrade" }, request, this.env, 426);
      }
      if (!isAllowedOriginForEnv(request.headers.get("Origin"), this.env)) {
        return json({ error: "origin_not_allowed" }, request, this.env, 403);
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.attachSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (route.kind === "event") {
      if (request.method === "GET") {
        const event2 = await this.getEvent();
        if (!event2) return json({ error: "event_not_found" }, request, this.env, 404);
        return json(event2, request, this.env);
      }
      if (request.method === "PUT") {
        const event2 = await readJson(request);
        if (!event2 || typeof event2.id !== "string")
          return json({ error: "invalid_event_payload" }, request, this.env, 400);
        if (event2.id !== route.eventId) {
          return json({ error: "event_id_mismatch" }, request, this.env, 400);
        }
        const normalized = {
          ...event2,
          participants: event2.participants.map((p) => ({ ...p, version: p.version ?? 0 }))
        };
        await this.setEvent(normalized);
        this.broadcast({ type: "event.updated", event: normalized });
        return json({ ok: true }, request, this.env);
      }
      return json({ error: "method_not_allowed" }, request, this.env, 405);
    }
    if (request.method !== "PUT")
      return json({ error: "method_not_allowed" }, request, this.env, 405);
    const body = await readJson(request);
    const slots = body?.slots;
    const baseVersion = body?.baseVersion;
    const updatedAt = body?.updatedAt;
    if (!Array.isArray(slots) || typeof updatedAt !== "number" || typeof baseVersion !== "number") {
      return json({ error: "invalid_participant_payload" }, request, this.env, 400);
    }
    const event = await this.getEvent();
    if (!event) return json({ error: "event_not_found" }, request, this.env, 404);
    const idx = event.participants.findIndex((p) => p.name === route.participantName);
    if (idx === -1) return json({ error: "participant_not_found" }, request, this.env, 404);
    const participant = event.participants[idx];
    const currentVersion = participant.version ?? 0;
    if (currentVersion !== baseVersion) {
      return json(
        { error: "version_conflict", currentVersion, updatedAt: participant.updatedAt ?? null },
        request,
        this.env,
        409
      );
    }
    if ((participant.updatedAt ?? 0) >= updatedAt) {
      return json({ ok: true, stale: true }, request, this.env);
    }
    if (slots.length !== participant.slots.length) {
      return json({ error: "invalid_slots_length" }, request, this.env, 400);
    }
    const nextSlots = slots.map((value) => {
      if (value === 1 || value === 2) return value;
      return 0;
    });
    const nextVersion = currentVersion + 1;
    const nextEvent = {
      ...event,
      participants: event.participants.map(
        (p, i) => i === idx ? { ...p, slots: nextSlots, updatedAt, version: nextVersion } : p
      )
    };
    await this.setEvent(nextEvent);
    this.broadcast({
      type: "participant.updated",
      eventId: nextEvent.id,
      participantName: route.participantName,
      slots: nextSlots,
      updatedAt,
      version: nextVersion
    });
    return json({ ok: true, version: nextVersion }, request, this.env);
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-TQLjTR/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-TQLjTR/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  EventRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
