import { describe, expect, it, afterEach } from "vitest";
import {
  getRuntimeMode,
  shouldStartBackgroundWorkers,
  shouldStartHttpServer,
} from "../runtime-mode";

describe("runtime-mode", () => {
  const prev = process.env.WORKER_MODE;

  afterEach(() => {
    if (prev === undefined) delete process.env.WORKER_MODE;
    else process.env.WORKER_MODE = prev;
  });

  it("defaults to embedded", () => {
    delete process.env.WORKER_MODE;
    expect(getRuntimeMode()).toBe("embedded");
    expect(shouldStartBackgroundWorkers()).toBe(true);
    expect(shouldStartHttpServer()).toBe(true);
  });

  it("api mode disables workers on HTTP process", () => {
    process.env.WORKER_MODE = "api";
    expect(getRuntimeMode()).toBe("api");
    expect(shouldStartBackgroundWorkers()).toBe(false);
    expect(shouldStartHttpServer()).toBe(true);
  });

  it("worker mode is background only", () => {
    process.env.WORKER_MODE = "worker";
    expect(getRuntimeMode()).toBe("worker");
    expect(shouldStartBackgroundWorkers()).toBe(true);
    expect(shouldStartHttpServer()).toBe(false);
  });
});
