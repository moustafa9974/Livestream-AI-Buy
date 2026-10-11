/**
 * Vision pipeline integration test: real DB, fake vision provider. Run with `npm run test:db`.
 * Covers stabilization, frame-hash cache, DEMO_CACHE near matches, creator hides, and
 * free-tier degradation to cache-only.
 */
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setVisionProviderForTests, type VisionProvider } from "../ai/providers";
import { prisma } from "../db";
import { resetEnvCache } from "../env";
import { processFrame } from "./process-frame";

const tag = randomUUID().slice(0, 8);
const creatorId = `test_vcreator_${tag}`;
const streamId = `test_vstream_${tag}`;
const usedHashes: string[] = [];

const newHash = () => {
  // Random 64-bit hashes have ~32 set bits, so they're always "cacheable".
  const h = randomBytes(8).toString("hex");
  usedHashes.push(h);
  return h;
};
/** Same hash with `bits` low bits flipped (a "re-encoded" frame). */
const nearHash = (h: string, bits: number) => {
  const flipped = (BigInt(`0x${h}`) ^ ((1n << BigInt(bits)) - 1n)).toString(16).padStart(16, "0");
  usedHashes.push(flipped);
  return flipped;
};

// Confidence below the fast lane, so these tests exercise the 2-sighting rule.
const item = (label: string, category: string, box = [100, 100, 500, 400]) => ({
  label, category, brand_guess: "unknown", attributes: { color: "black" }, box_2d: box,
  prominence: 0.8, confidence: 0.85, mentioned_in_audio: false,
});

class FakeVision implements VisionProvider {
  name = "gemini" as const;
  budgetKey = "gemini" as const;
  calls = 0;
  items = [item("black hoodie", "apparel/hoodie"), item("speckled ceramic mug", "home/mug", [600, 600, 900, 800])];
  async analyzeRaw() {
    this.calls++;
    return JSON.stringify({ items: this.items, scene: "creator at a desk" });
  }
}
let fake: FakeVision;

beforeAll(async () => {
  await prisma.creator.create({ data: { id: creatorId, slug: `test-v-${tag}`, displayName: "Vision Test", payoutEmail: "x@example.com" } });
  await prisma.stream.create({ data: { id: streamId, creatorId, title: "Vision test", sourceType: "upload", status: "live" } });
});

beforeEach(() => {
  fake = new FakeVision();
  setVisionProviderForTests(fake);
});

afterAll(async () => {
  setVisionProviderForTests(undefined);
  const dets = await prisma.detection.findMany({ where: { streamId }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: dets.map((d) => d.id) } } });
  await prisma.detection.deleteMany({ where: { streamId } });
  await prisma.frame.deleteMany({ where: { streamId } });
  await prisma.stream.deleteMany({ where: { id: streamId } });
  await prisma.creator.deleteMany({ where: { id: creatorId } });
  await prisma.apiCache.deleteMany({ where: { key: { in: usedHashes.map((h) => `vision:${h}`) } } });
  await prisma.$disconnect();
});

const frame = (tsSec: number, dHash: string, image = "ZmFrZQ==") => processFrame({ streamId, tsSec, dHash, imageJpegBase64: image });

describe("vision pipeline", () => {
  it("needs two sightings before showing a product (no flicker)", async () => {
    const first = await frame(0, newHash());
    expect(first.source).toBe("ai");
    expect(first.detections.map((d) => d.state)).toEqual(["candidate", "candidate"]);

    const second = await frame(4, newHash());
    const states = Object.fromEntries(second.detections.map((d) => [d.label, d.state]));
    expect(states).toEqual({ "black hoodie": "visible", "speckled ceramic mug": "visible" });
    expect(second.detections).toHaveLength(2); // deduped, not 4
    expect(second.detections.every((d) => d.inFrame && d.bbox)).toBe(true);
  });

  it("repeated frames are served from the hash cache without calling the AI", async () => {
    const h = newHash();
    await frame(8, h);
    expect(fake.calls).toBe(1);
    const again = await frame(12, h);
    expect(again.source).toBe("cache");
    expect(fake.calls).toBe(1);
  });

  it("DEMO_CACHE reuses results for near-identical frames, even with no AI configured", async () => {
    const h = newHash();
    await frame(16, h);
    setVisionProviderForTests(null); // simulate: no Gemini key / offline
    const near = await frame(20, nearHash(h, 3));
    expect(near.source).toBe("demo_cache");
    expect(near.itemsSeen).toBe(2);
  });

  it("with nothing cached and no provider, it degrades gracefully", async () => {
    setVisionProviderForTests(null);
    const out = await frame(24, newHash());
    expect(out).toMatchObject({ source: "none", note: "No AI provider configured" });
  });

  it("a hidden product never comes back for this stream", async () => {
    const hoodie = await prisma.detection.findFirstOrThrow({ where: { streamId, label: "black hoodie" } });
    await prisma.detection.update({ where: { id: hoodie.id }, data: { state: "hidden" } });
    const out = await frame(28, newHash());
    expect(out.detections.find((d) => d.id === hoodie.id)?.state).toBe("hidden");
  });

  it("goes cache-only when the free-tier limit is reached", async () => {
    const before = process.env.GEMINI_MAX_RPD;
    process.env.GEMINI_MAX_RPD = "0";
    resetEnvCache();
    try {
      const out = await frame(32, newHash());
      expect(out).toMatchObject({ source: "none", mode: "cache_only", nextIntervalSec: null });
      expect(fake.calls).toBe(0);
    } finally {
      if (before === undefined) delete process.env.GEMINI_MAX_RPD;
      else process.env.GEMINI_MAX_RPD = before;
      resetEnvCache();
    }
  });

  it("never caches an empty answer (a static screen would be stuck on 'nothing here')", async () => {
    fake.items = [];
    const h = newHash();
    await frame(36, h);
    fake.items = [item("black hoodie", "apparel/hoodie")];
    const again = await frame(40, h);
    expect(again.source).toBe("ai"); // analysed again, not served "nothing" from cache
    expect(fake.calls).toBe(2);
  });

  it("screen shares never use the frame cache", async () => {
    const screenId = `test_vscreen_${tag}`;
    await prisma.stream.create({ data: { id: screenId, creatorId, title: "Screen", sourceType: "screen", status: "live" } });
    try {
      const h = newHash();
      await frame(44, h); // caches under h (upload stream)
      const calls = fake.calls;
      const out = await processFrame({ streamId: screenId, tsSec: 1, dHash: h, imageJpegBase64: "ZmFrZQ==" });
      expect(out.source).toBe("ai");
      expect(fake.calls).toBe(calls + 1);
    } finally {
      const dets = await prisma.detection.findMany({ where: { streamId: screenId }, select: { id: true } });
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: dets.map((d) => d.id) } } });
      await prisma.detection.deleteMany({ where: { streamId: screenId } });
      await prisma.frame.deleteMany({ where: { streamId: screenId } });
      await prisma.stream.delete({ where: { id: screenId } });
    }
  });

  it("rejects frames for a stream that isn't live", async () => {
    await prisma.stream.update({ where: { id: streamId }, data: { status: "ended" } });
    await expect(frame(36, newHash())).rejects.toThrow(/not live/);
  });
});
