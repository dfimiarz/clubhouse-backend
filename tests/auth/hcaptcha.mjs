import { expect } from "chai";

import authController from "../../auth/controller.js";
import redisconnector from "../../db/RedisConnector.js";

const { getAllowedHCaptchaHostnames, verifyhCaptcha } = authController;

const originalFetch = global.fetch;
const originalGetClient = redisconnector.getClient;

function createMemoryRedis() {
  const store = new Map();
  return {
    store,
    async set(key, _value, options = {}) {
      if (options.NX && store.has(key)) {
        return null;
      }
      store.set(key, "1");
      return "OK";
    },
  };
}

describe("getAllowedHCaptchaHostnames", () => {
  it("parses hostnames from URLs and strips ports", () => {
    expect(
      getAllowedHCaptchaHostnames({
        HCAPTCHA_ALLOWED_HOSTNAMES:
          "https://app.example.com, https://clubhouse.test:8081,localhost",
      })
    ).to.deep.equal(["app.example.com", "clubhouse.test", "localhost"]);
  });

  it("dedupes and drops empty or invalid entries", () => {
    expect(
      getAllowedHCaptchaHostnames({
        NODE_ENV: "production",
        HCAPTCHA_ALLOWED_HOSTNAMES: "localhost, localhost, https://, ,",
      })
    ).to.deep.equal(["localhost"]);
  });

  it("fails closed in production when the list is empty", () => {
    expect(getAllowedHCaptchaHostnames({ NODE_ENV: "production" })).to.deep.equal(
      []
    );
    expect(
      getAllowedHCaptchaHostnames({
        NODE_ENV: "production",
        HCAPTCHA_ALLOWED_HOSTNAMES: ",",
      })
    ).to.deep.equal([]);
  });

  it("falls back to local widget hosts in development when unset", () => {
    expect(getAllowedHCaptchaHostnames({ NODE_ENV: "development" })).to.deep.equal(
      ["localhost", "clubhouse.test"]
    );
    expect(
      getAllowedHCaptchaHostnames({
        NODE_ENV: "development",
        HCAPTCHA_ALLOWED_HOSTNAMES: ",",
      })
    ).to.deep.equal(["localhost", "clubhouse.test"]);
  });
});

describe("verifyhCaptcha", () => {
  let redis;
  let fetchCalls;

  beforeEach(() => {
    redis = createMemoryRedis();
    fetchCalls = [];
    redisconnector.getClient = () => redis;
    global.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        json: async () => ({ success: true, hostname: "localhost" }),
      };
    };
  });

  afterEach(() => {
    redisconnector.getClient = originalGetClient;
    global.fetch = originalFetch;
  });

  it("rejects a replayed token from Redis without calling siteverify", async () => {
    const first = await verifyhCaptcha("token-1", {
      env: { NODE_ENV: "development" },
    });
    const second = await verifyhCaptcha("token-1", {
      env: { NODE_ENV: "development" },
    });

    expect(first.success).to.equal(true);
    expect(first.replayed).to.equal(false);
    expect(second.success).to.equal(false);
    expect(second.replayed).to.equal(true);
    expect(fetchCalls).to.have.lengthOf(1);
  });

  it("does not treat an empty hostname allow-list as a skip", async () => {
    const result = await verifyhCaptcha("token-2", {
      env: { NODE_ENV: "production", HCAPTCHA_ALLOWED_HOSTNAMES: "," },
    });

    expect(result.success).to.equal(false);
    expect(result.hostnameValid).to.equal(false);
    expect(result.replayed).to.equal(false);
    expect(result.unavailable).to.equal(false);
    expect(fetchCalls).to.have.lengthOf(0);
  });

  it("fails closed when Redis cannot store the used token", async () => {
    redisconnector.getClient = () => ({
      async set() {
        throw new Error("redis down");
      },
    });

    const result = await verifyhCaptcha("token-3", {
      env: { NODE_ENV: "development" },
    });

    expect(result.success).to.equal(false);
    expect(result.replayed).to.equal(false);
    expect(result.unavailable).to.equal(true);
    expect(fetchCalls).to.have.lengthOf(0);
  });

  it("requires the reported hostname to be on the allow-list", async () => {
    global.fetch = async () => ({
      json: async () => ({ success: true, hostname: "evil.example" }),
    });

    const result = await verifyhCaptcha("token-4", {
      env: {
        NODE_ENV: "production",
        HCAPTCHA_ALLOWED_HOSTNAMES: "https://app.example.com",
      },
    });

    expect(result.success).to.equal(false);
    expect(result.hostnameValid).to.equal(false);
    expect(result.hostname).to.equal("evil.example");
  });
});
