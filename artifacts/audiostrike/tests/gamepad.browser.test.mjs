import assert from 'node:assert/strict';
import { selectMockPlaylist } from './drivePlaylistFixture.mjs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { STAGE_LEVEL_SECONDS } from '../src/gameRules.ts';
import { bossHealth } from '../src/encounterRules.ts';

// Run against the managed Rhythm Fighter preview: pnpm --filter @workspace/audiostrike test:browser
// Override AUDIOSTRIKE_TEST_URL and CHROMIUM_PATH when running outside Replit.
const url = process.env.AUDIOSTRIKE_TEST_URL || 'http://localhost:80/';

function pad(index, { x = 0, y = 0, buttons = [], connected = true } = {}) {
  return {
    id: `Test controller ${index}`,
    index,
    connected,
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

function toneWav(frequency) {
  const rate = 16000, samples = rate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const pulse = Math.floor(i / (rate / 4)) % 2 ? .35 : .8;
    wav.writeInt16LE(Math.round(Math.sin(i * frequency * 2 * Math.PI / rate) * 32700 * pulse), 44 + i * 2);
  }
  return wav;
}

// Read the real running game session from React's host-fiber during integration tests.
// No test hooks are exposed in the shipped game.
async function session(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas-game"]');
    const key = Object.keys(canvas).find((name) => name.startsWith('__reactFiber$'));
    let fiber = canvas[key];
    while (fiber && fiber.type?.name !== 'Home') fiber = fiber.return;
    if (!fiber) throw new Error('Running game session not found');
    let hook = fiber.memoizedState;
    while (hook && !hook.memoizedState?.current?.player) hook = hook.next;
    if (!hook) throw new Error('Running game ref not found');
    const game = hook.memoizedState.current;
    return {
      state: game.state, level: game.level, score: game.score,
      player: { health: game.player.health },
      stageReactive: { signature: game.stageReactive.signature, element: {
        src: game.stageReactive.element.src, loop: game.stageReactive.element.loop,
        currentTime: game.stageReactive.element.currentTime,
      } },
      bossReactive: { signature: game.bossReactive.signature, element: {
        src: game.bossReactive.element.src, loop: game.bossReactive.element.loop,
      } },
      boss: game.boss ? { health: game.boss.health, maxHealth: game.boss.maxHealth, shape: game.boss.shape } : null,
      enemies: game.enemies.map(({ subBoss, health }) => ({ subBoss, health })),
    };
  });
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
      window.__shipSamples = [];

      // Observe the player sprite's actual canvas draw, rather than a separate test-only
      // copy of its coordinates. The green 20x32 rounded rectangle is the ship body.
      const roundRect = CanvasRenderingContext2D.prototype.roundRect;
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height, ...rest) {
        if (width === 20 && height === 32 && this.fillStyle === '#00ff88') {
          window.__ship = { x: x + 10, y: y + 16 };
          window.__shipSamples.push(window.__ship);
        }
        return roundRect.call(this, x, y, width, height, ...rest);
      };
    });
    const response = await page.goto(url);
    assert.equal(response?.status(), 200, `Rhythm Fighter preview must be running at ${url}`);
    await selectMockPlaylist(page, [{ name: 'stage.mp3', buffer: silentWav() }, { name: 'boss.mp3', buffer: silentWav() }]);
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

    async function assertReleaseSettles(phase, description, pads, direction, statusText) {
      const start = await page.evaluate(() => window.__ship.x);
      const sampleStart = await page.evaluate(() => window.__shipSamples.length);
      await page.evaluate((next) => {
        window.__pads = next;
        if (next.every((gamepad) => !gamepad?.connected)) {
          window.dispatchEvent(new Event('gamepaddisconnected'));
        }
      }, pads);

      await page.waitForFunction(
        ({ start, direction, sampleStart }) => window.__shipSamples
          .slice(sampleStart)
          .some(({ x }) => (x - start) * direction > 6),
        { start, direction, sampleStart },
        { timeout: 2500 },
      );
      await page.waitForFunction((sampleStart) => {
        const samples = window.__shipSamples.slice(sampleStart);
        if (samples.length < 14) return false;
        const tail = samples.slice(-10);
        const settled = tail.every(({ x }) => Math.abs(x - tail[0].x) < 0.1);
        const traveled = Math.abs(samples.at(-1).x - samples[0].x);
        return settled && traveled > 6;
      }, sampleStart, { timeout: 3000 });
      await page.waitForFunction(
        (text) => document.querySelector('[data-testid="controller-status"]')?.textContent?.includes(text),
        statusText,
        { timeout: 2000 },
      );

      const samples = await page.evaluate((offset) => window.__shipSamples.slice(offset), sampleStart);
      const directionalSteps = samples.slice(1).map((sample, index) => (
        (sample.x - samples[index].x) * direction
      )).filter((distance) => distance > 0.1);
      assert.ok(directionalSteps.length > 1, `${phase}: ${description} must show residual movement`);
      assert.ok(
        directionalSteps[0] > directionalSteps.at(-1),
        `${phase}: ${description} must slow the ship before it stops`,
      );
      assert.ok(
        samples.slice(-10).every(({ x }, index, tail) => Math.abs(x - tail[0].x) < 0.1),
        `${phase}: ${description} must leave the ship stationary`,
      );
      assert.match(await page.getByTestId('controller-status').innerText(), new RegExp(statusText));
    }

    async function assertReconnectSteers(phase) {
      const start = await page.evaluate(() => window.__ship?.x);
      assert.ok(Number.isFinite(start), `${phase}: ship must be drawn before reconnecting`);
      await page.evaluate((reconnected) => {
        window.__pads = [reconnected, null];
        window.dispatchEvent(new Event('gamepadconnected'));
      }, pad(0, { x: -0.9, buttons: [14] }));
      await page.waitForFunction(
        (initialX) => Number.isFinite(window.__ship?.x) && initialX - window.__ship.x > 24,
        start,
        { timeout: 2500 },
      );
      await page.waitForFunction(
        () => {
          const status = document.querySelector('[data-testid="controller-status"]')?.textContent ?? '';
          return status.includes('Controller detected') && status.includes('stick -0.90, 0.00') && status.includes('D-pad ←');
        },
        null,
        { timeout: 2000 },
      );
      assert.ok(start - await page.evaluate(() => window.__ship.x) > 24, `${phase}: renewed controller input must steer left`);
      assert.match(
        await page.getByTestId('controller-status').innerText(),
        /Controller detected.*stick -0\.90, 0\.00.*D-pad ←/,
        `${phase}: status must reflect the reconnected controller's input`,
      );
    }

    for (const phase of ['PLAYING', 'BOSS']) {
      if (phase === 'BOSS') {
        // Skip the stage while still running the real stage-exit,
        // boss-intro, and boss gameplay loops.
        await page.evaluate(() => { window.__pads = [null, null]; });
         await page.clock.fastForward((STAGE_LEVEL_SECONDS + 1) * 1000);
         assert.equal(await page.locator('[data-testid="overlay-boss-intro"]').count(), 1, 'the five-second no-spawn transition must precede the boss');
         await page.clock.fastForward(6000);
        await page.locator('[data-testid="text-boss-health"]').waitFor({ timeout: 8000 });
         assert.match(await page.getByTestId('text-level').innerText(), /Level\s*1/i);
         assert.match(await page.getByTestId('text-boss-health').innerText(), /1122 \/ 1122/);
      }
      await moves(phase, 'left stick right', [pad(0, { x: 0.9 }), null], 1);
      await moves(phase, 'D-pad left', [pad(0, { buttons: [14] }), null], -1);
      await moves(phase, 'second controller while first is idle', [pad(0), pad(1, { x: 0.9 })], 1);
      await page.waitForFunction(() => document.querySelector('[data-testid="controller-status"]')?.textContent?.includes('stick 0.90, 0.00'));
      assert.match(await page.getByTestId('controller-status').innerText(), /stick 0\.90, 0\.00/, `${phase}: status must reflect the active second controller`);
      await moves(phase, 'left stick left before releasing it', [pad(0, { x: -0.9 }), null], -1);
      await assertReleaseSettles(phase, 'neutral input', [pad(0), null], -1, 'stick 0.00, 0.00');
      await moves(phase, 'left stick right before disconnecting', [pad(0, { x: 0.9 }), null], 1);
      await assertReleaseSettles(phase, 'controller disconnect', [pad(0, { connected: false }), null], 1, 'No controller detected');
      await assertReconnectSteers(phase);
    }
  } finally {
    await browser.close();
  }
});

test('contrasting audio, boss detachment and reused tracks survive two level handoffs', { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    await page.goto(url);
    await selectMockPlaylist(page, [{ name: 'bass.mp3', buffer: toneWav(100) }, { name: 'bright.mp3', buffer: toneWav(3000) }]);
    await page.getByTestId('button-analyze').click();
    await page.getByTestId('text-stage-time').waitFor({ timeout: 8000 });
    await page.clock.runFor(1600);
    const stage = await session(page);
    assert.ok(stage.stageReactive.signature.low > stage.stageReactive.signature.high, 'bass stage fixture must register as bass-dominant');
    const stageSource = stage.stageReactive.element.src;
    const bossSource = stage.bossReactive.element.src;
    assert.equal(stage.stageReactive.element.loop, true);
    assert.equal(stage.bossReactive.element.loop, true);
    await page.clock.fastForward((STAGE_LEVEL_SECONDS + 1) * 1000);
    const transitionStart = await session(page);
    assert.equal(transitionStart.state, 'BOSS_INTRO');
    await page.clock.fastForward(4000);
    const transitionEnd = await session(page);
    assert.equal(transitionEnd.state, 'BOSS_INTRO', 'boss cannot arrive before the five-second transition');
    assert.ok(transitionEnd.enemies.length <= transitionStart.enemies.length, 'no regular enemies spawn during transition');
    await page.clock.fastForward(1100);
    await page.getByTestId('text-boss-health').waitFor();
    await page.clock.runFor(3000);
    const encounter = await session(page);
    assert.ok(encounter.bossReactive.signature.high > encounter.bossReactive.signature.low, 'bright boss fixture must register as treble-dominant');
    assert.notEqual(encounter.boss.shape, 'HEX', 'boss form must differ from bass-dominant form');
    assert.ok(encounter.enemies.some((enemy) => enemy.subBoss), 'a detached, independently hittable part enters on phase one');
    assert.equal(encounter.boss.maxHealth, bossHealth(18, 1));
    assert.equal(encounter.bossReactive.element.src, bossSource);

    for (let level = 2; level <= 3; level++) {
      await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="canvas-game"]');
        const key = Object.keys(canvas).find((name) => name.startsWith('__reactFiber$'));
        let fiber = canvas[key];
        while (fiber && fiber.type?.name !== 'Home') fiber = fiber.return;
        let hook = fiber.memoizedState;
        while (hook && !hook.memoizedState?.current?.player) hook = hook.next;
        const game = hook.memoizedState.current;
        game.boss.health = 1;
        game.boss.phase = 'PHASE3';
        game.boss.phaseFrame = 100;
        game.boss.motion = 'CHASE';
        game.boss.x = game.player.x;
        game.player.y = 280;
      });
      await page.clock.runFor(5500);
      await page.waitForFunction((expected) => document.querySelector('[data-testid="text-level"]')?.textContent?.endsWith(String(expected)), level, { timeout: 5000 });
      const next = await session(page);
      assert.equal(next.state, 'PLAYING');
      assert.equal(next.boss, null);
      assert.equal(next.stageReactive.element.src, stageSource, 'the original stage track is reused');
      assert.equal(next.stageReactive.element.currentTime < 8, true, 'stage track restarts from its beginning');
      assert.equal(next.bossReactive.element.src, bossSource, 'the original boss track is retained');
      assert.ok(next.player.health > 0);
      assert.ok(next.score > 0);
      if (level === 3) break;
      await page.clock.fastForward((STAGE_LEVEL_SECONDS + 1) * 1000);
      await page.clock.fastForward(6000);
      await page.getByTestId('text-boss-health').waitFor();
      assert.equal((await session(page)).boss.maxHealth, bossHealth(18, level));
    }
  } finally {
    await browser.close();
  }
});