import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';

// Run against the managed AudioStrike preview: pnpm --filter @workspace/audiostrike test:browser
// Override AUDIOSTRIKE_TEST_URL and CHROMIUM_PATH when running outside Replit.
const url = process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';

function pad(index, { x = 0, y = 0, buttons = [] } = {}) {
  return {
    id: `Test controller ${index}`,
    index,
    connected: true,
    mapping: 'standard',
    axes: [x, y],
    buttons: Array.from({ length: 16 }, (_, button) => ({
      pressed: buttons.includes(button),
      value: Number(buttons.includes(button)),
    })),
  };
}

function silentWav() {
  const samples = 8000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

test('connected gamepads actually steer the drawn ship in PLAYING and BOSS', { timeout: 30000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    await page.addInitScript(() => {
      window.__pads = [null, null];
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });

      // Observe the player sprite's actual canvas draw, rather than a separate test-only
      // copy of its coordinates. The green 20x32 rounded rectangle is the ship body.
      const roundRect = CanvasRenderingContext2D.prototype.roundRect;
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, ...rest) {
        if (width === 20 && height === 32 && this.fillStyle === '#00ff88') {
          window.__ship = { x: x + 10, y: y + 16 };
        }
        return roundRect.call(this, x, y, width, height, ...rest);
      };
    });
    const response = await page.goto(url);
    assert.equal(response?.status(), 200, `AudioStrike preview must be running at ${url}`);
    await page.locator('[data-testid="input-stage-file"]').setInputFiles({ name: 'stage.wav', mimeType: 'audio/wav', buffer: silentWav() });
    await page.locator('[data-testid="input-boss-file"]').setInputFiles({ name: 'boss.wav', mimeType: 'audio/wav', buffer: silentWav() });
    await page.locator('[data-testid="button-analyze"]').click();
    await page.locator('[data-testid="text-stage-time"]').waitFor({ timeout: 8000 });

    async function moves(phase, description, pads, direction) {
      await page.evaluate((next) => { window.__pads = next; }, pads);
      const start = await page.evaluate(() => window.__ship?.x);
      assert.ok(Number.isFinite(start), `${phase}: ship must be drawn before ${description}`);
      await page.waitForFunction(
        ({ start, direction }) => Number.isFinite(window.__ship?.x) && (window.__ship.x - start) * direction > 24,
        { start, direction },
        { timeout: 2500 },
      );
      assert.ok((await page.evaluate(() => window.__ship.x) - start) * direction > 24, `${phase}: ${description} must move the ship`);
    }

    for (const phase of ['PLAYING', 'BOSS']) {
      if (phase === 'BOSS') {
        // Skip the 30-second stage while still running the real stage-exit,
        // boss-intro, and boss gameplay loops.
        await page.evaluate(() => { window.__pads = [null, null]; });
        await page.clock.fastForward(31_000);
        await page.locator('[data-testid="text-boss-health"]').waitFor({ timeout: 8000 });
      }
      await moves(phase, 'left stick right', [pad(0, { x: 0.9 }), null], 1);
      await moves(phase, 'D-pad left', [pad(0, { buttons: [14] }), null], -1);
      await moves(phase, 'second controller while first is idle', [pad(0), pad(1, { x: 0.9 })], 1);
      await page.waitForFunction(() => document.querySelector('[data-testid="controller-status"]')?.textContent?.includes('stick 0.90, 0.00'));
      assert.match(await page.getByTestId('controller-status').innerText(), /stick 0\.90, 0\.00/, `${phase}: status must reflect the active second controller`);
    }
  } finally {
    await browser.close();
  }
});