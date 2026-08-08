import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_ACCESS_COOKIE,
  appAccessSignature,
  verifyAppAccess,
  verifyAppAccessKey,
} from "../lib/app-access.js";

const SECRET = "a-long-unit-test-access-secret";

test("app access is open when no key is configured", () => {
  assert.deepEqual(verifyAppAccess({ headers: new Headers() }, ""), {
    configured: false,
    authorized: true,
  });
  assert.deepEqual(verifyAppAccess({ headers: new Headers() }, "", { production: true }), {
    configured: false,
    authorized: false,
    configurationMissing: true,
  });
  assert.deepEqual(verifyAppAccess({ headers: new Headers() }, "", {
    production: true,
    allowPublic: true,
  }), {
    configured: false,
    authorized: true,
  });
});

test("app access requires a valid signed HttpOnly-cookie value", () => {
  const signature = appAccessSignature(SECRET);
  assert.equal(verifyAppAccess({ headers: new Headers() }, SECRET).authorized, false);
  assert.equal(verifyAppAccess({
    headers: new Headers({ cookie: `another=value; ${APP_ACCESS_COOKIE}=${signature}` }),
  }, SECRET).authorized, true);
  assert.equal(verifyAppAccess({
    headers: new Headers({ cookie: `${APP_ACCESS_COOKIE}=tampered` }),
  }, SECRET).authorized, false);
});

test("app access key comparison rejects wrong and missing values", () => {
  assert.equal(verifyAppAccessKey(SECRET, SECRET), true);
  assert.equal(verifyAppAccessKey("wrong", SECRET), false);
  assert.equal(verifyAppAccessKey(SECRET, ""), false);
});
