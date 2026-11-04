import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Live video, creator → viewer, browser to browser (WebRTC). The creator shares a
 * "screen" (a canvas showing the mug fixture, since headless Chromium has none), goes
 * live, and the viewer page must show real-time video, not the snapshot fallback.
 */

const FIXTURE = path.join(__dirname, "fixtures", "mug-search-screen.jpg");

async function fakeScreenShare(page: Page) {
  const dataUrl = `data:image/jpeg;base64,${readFileSync(FIXTURE).toString("base64")}`;
  await page.addInitScript((src: string) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      const paint = () => ctx.drawImage(img, 0, 0);
      paint();
      setInterval(paint, 200);
      return canvas.captureStream(5);
    };
  }, dataUrl);
}

// Always start and finish with the demo stream off air, even if a test fails midway:
// a stream left live shows "End stream" instead of "Go live" and breaks the next run.
const endDemoStream = async ({ request }: { request: import("@playwright/test").APIRequestContext }) => {
  await request.post("/api/streams/seed_stream_demo/live", { data: { action: "stop" } });
};
test.beforeEach(endDemoStream);
test.afterEach(endDemoStream);

test("viewer watches the creator's screen share in real time", async ({ browser }) => {
  const creator = await browser.newPage();
  const viewer = await browser.newPage();
  const errors: string[] = [];
  for (const p of [creator, viewer]) p.on("pageerror", (e) => errors.push(e.message));

  await fakeScreenShare(creator);
  await creator.goto("/studio");
  await creator.getByRole("button", { name: "Share screen / OBS" }).click();
  await creator.getByRole("checkbox").check();
  await creator.getByRole("button", { name: "Go live" }).click();
  await expect(creator.getByText("0 watching live")).toBeVisible();

  await viewer.goto("/live/maya-makes");
  await expect(viewer.getByText("Real-time video")).toBeVisible({ timeout: 45_000 });
  // Frames are actually arriving, not just a connected-but-empty stream.
  await expect
    .poll(() => viewer.locator("video").evaluateAll((vs) => Math.max(...vs.map((v) => (v as HTMLVideoElement).videoWidth))), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(creator.getByText("1 watching live")).toBeVisible();

  // Ending the stream takes the viewer off live video.
  await creator.getByRole("button", { name: "End stream" }).click();
  await expect(viewer.getByText("Real-time video")).toBeHidden({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("without a direct connection, the viewer sees the live frame preview", async ({ browser }) => {
  const creator = await browser.newPage();
  const viewer = await browser.newPage();
  // A network that can't do peer-to-peer: the viewer's WebRTC attempt fails outright.
  await viewer.addInitScript(() => {
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = class {
      constructor() {
        throw new Error("blocked");
      }
    };
  });

  await fakeScreenShare(creator);
  await creator.goto("/studio");
  await creator.getByRole("button", { name: "Share screen / OBS" }).click();
  await creator.getByRole("checkbox").check();
  await creator.getByRole("button", { name: "Go live" }).click();
  await expect(creator.getByText("0 watching live")).toBeVisible(); // the stream is live now

  await viewer.goto("/live/maya-makes");
  await expect(viewer.getByText("Live preview · updates every few seconds")).toBeVisible({ timeout: 45_000 });
  await expect(viewer.getByText("Real-time video")).toHaveCount(0);

  await creator.getByRole("button", { name: "End stream" }).click();
});
