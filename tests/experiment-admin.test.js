import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPERIMENT_ADMIN_COOKIE,
  experimentAdminCapability,
  experimentAdminSignature,
  isLoopbackExperimentRequest,
  shouldUseSecureExperimentCookie,
  verifyExperimentAdmin,
  verifyExperimentAdminKey,
} from "../lib/experiment-admin.js";

test("researcher key and signed HttpOnly-cookie value are independently verified", () => {
  const secret = "researcher-secret-with-sufficient-entropy";
  const signature = experimentAdminSignature(secret);
  assert.equal(verifyExperimentAdminKey(secret, secret), true);
  assert.equal(verifyExperimentAdminKey("wrong", secret), false);
  assert.deepEqual(
    verifyExperimentAdmin({ headers: new Headers({ cookie: `${EXPERIMENT_ADMIN_COOKIE}=${signature}` }) }, secret),
    { configured: true, authorized: true },
  );
  assert.deepEqual(
    verifyExperimentAdmin({ headers: new Headers({ cookie: `${EXPERIMENT_ADMIN_COOKIE}=tampered` }) }, secret),
    { configured: true, authorized: false },
  );
});

test("missing researcher configuration fails closed", () => {
  assert.deepEqual(verifyExperimentAdmin({ headers: new Headers() }, ""), {
    configured: false,
    authorized: false,
    configurationMissing: true,
  });
  assert.equal(verifyExperimentAdminKey("anything", ""), false);
});

test("admin cookie remains usable on production localhost HTTP and secure on HTTPS", () => {
  assert.equal(shouldUseSecureExperimentCookie({ url: "http://127.0.0.1:3000/api/experiment/access", headers: new Headers() }), false);
  assert.equal(shouldUseSecureExperimentCookie({ url: "http://localhost:3000/api/experiment/access", headers: new Headers() }), false);
  assert.equal(shouldUseSecureExperimentCookie({ url: "https://study.example.edu/api/experiment/access", headers: new Headers() }), true);
  assert.equal(shouldUseSecureExperimentCookie({
    url: "https://study.example.edu/api/experiment/access",
    headers: new Headers({ "x-forwarded-proto": "http" }),
  }), true);
  assert.equal(shouldUseSecureExperimentCookie({
    url: "http://internal:3000/api/experiment/access",
    headers: new Headers({ "x-forwarded-proto": "https" }),
  }), true);
});

test("only an actual loopback request may use the local study exception", () => {
  assert.equal(isLoopbackExperimentRequest({
    url: "http://127.0.0.1:3000/api/experiment/access",
    headers: new Headers({ host: "127.0.0.1:3000" }),
  }), true);
  assert.equal(isLoopbackExperimentRequest({
    url: "http://localhost:3000/api/experiment/access",
    headers: new Headers({ host: "localhost:3000" }),
  }), true);
  assert.equal(isLoopbackExperimentRequest({
    url: "https://study.example.edu/api/experiment/access",
    headers: new Headers({ host: "study.example.edu" }),
  }), false);
  assert.equal(isLoopbackExperimentRequest({
    url: "http://127.0.0.1:3000/api/experiment/access",
    headers: new Headers({ host: "127.0.0.1:3000", "x-forwarded-host": "study.example.edu" }),
  }), false);
  assert.equal(isLoopbackExperimentRequest({
    url: "https://study.example.edu/api/experiment/access",
    headers: new Headers({ host: "study.example.edu", "x-forwarded-host": "127.0.0.1:3000" }),
  }), false);
  assert.equal(isLoopbackExperimentRequest({
    url: "http://127.0.0.1:3000/api/experiment/access",
    headers: new Headers({ host: "study.example.edu", "x-forwarded-host": "127.0.0.1:3000" }),
  }), false);
  assert.equal(isLoopbackExperimentRequest({
    url: "http://127.0.0.1:3000/api/experiment/access",
    headers: new Headers({ host: "127.0.0.1:3000", "x-forwarded-proto": "https" }),
  }), false);
  assert.equal(isLoopbackExperimentRequest({
    url: "http://127.0.0.1:3000/api/experiment/access",
    headers: new Headers(),
  }), false);
  assert.equal(isLoopbackExperimentRequest({
    url: "http://127.0.0.1:3000/api/experiment/access",
    headers: new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-proto": "http",
    }),
  }), true);
});

test("experiment capability bypasses researcher secrets only on trusted loopback requests", () => {
  assert.deepEqual(experimentAdminCapability({
    url: "http://localhost:3000/api/experiment/access",
    headers: new Headers({ host: "localhost:3000" }),
  }, ""), {
    configured: false,
    authorized: true,
    localBypass: true,
    keyRequired: false,
    requireResearcherKeyForConsent: false,
    capability: "local-loopback",
  });

  assert.deepEqual(experimentAdminCapability({
    url: "https://study.example.edu/api/experiment/access",
    headers: new Headers({ host: "study.example.edu" }),
  }, ""), {
    configured: false,
    authorized: false,
    localBypass: false,
    keyRequired: true,
    requireResearcherKeyForConsent: true,
    capability: "unavailable",
  });

  const secret = "researcher-secret-with-sufficient-entropy";
  assert.deepEqual(experimentAdminCapability({
    url: "https://study.example.edu/api/experiment/access",
    headers: new Headers({ host: "study.example.edu" }),
  }, secret), {
    configured: true,
    authorized: false,
    localBypass: false,
    keyRequired: true,
    requireResearcherKeyForConsent: true,
    capability: "researcher-key",
  });

  const signature = experimentAdminSignature(secret);
  assert.deepEqual(experimentAdminCapability({
    url: "https://study.example.edu/api/experiment/access",
    headers: new Headers({
      host: "study.example.edu",
      cookie: `${EXPERIMENT_ADMIN_COOKIE}=${signature}`,
    }),
  }, secret), {
    configured: true,
    authorized: true,
    localBypass: false,
    keyRequired: true,
    requireResearcherKeyForConsent: true,
    capability: "researcher-cookie",
  });
});
