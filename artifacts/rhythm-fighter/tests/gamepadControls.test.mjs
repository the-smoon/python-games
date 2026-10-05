import assert from 'node:assert/strict';
import test from 'node:test';
import { getControllerStatus, mapGamepadInput, selectActiveGamepad } from '../src/gamepadControls.ts';

function gamepad({ axes = [0, 0], pressedButtons = [] } = {}) {
  const buttons = Array.from({ length: 17 }, (_, index) => ({
    pressed: pressedButtons.includes(index),
    value: pressedButtons.includes(index) ? 1 : 0,
  }));
  return { id: 'DualSense', mapping: 'standard', connected: true, axes, buttons };
}

test('left stick applies a deadzone and preserves analog direction', () => {
  assert.deepEqual(mapGamepadInput(gamepad({ axes: [0.1, -0.1] })), { x: 0, y: 0 });
  const fullTilt = mapGamepadInput(gamepad({ axes: [-1, 0] }));
  assert.deepEqual(fullTilt, { x: -1, y: 0 });
  const analogTilt = mapGamepadInput(gamepad({ axes: [0, 0.59] }));
  assert.equal(analogTilt.x, 0);
  assert.ok(Math.abs(analogTilt.y - 0.5) < 0.01);
});

test('D-pad steering uses standard Gamepad API button positions', () => {
  const upRight = mapGamepadInput(gamepad({ pressedButtons: [12, 15] }));
  assert.ok(Math.abs(upRight.x - Math.SQRT1_2) < 0.0001);
  assert.ok(Math.abs(upRight.y + Math.SQRT1_2) < 0.0001);
  const downLeft = mapGamepadInput(gamepad({ pressedButtons: [13, 14] }));
  assert.ok(Math.abs(downLeft.x + Math.SQRT1_2) < 0.0001);
  assert.ok(Math.abs(downLeft.y - Math.SQRT1_2) < 0.0001);
});

test('status distinguishes unsupported browsers, no controller, and DualSense', () => {
  assert.match(getControllerStatus(null, false), /unavailable/);
  assert.match(getControllerStatus(null, true), /No controller detected/);
  assert.match(getControllerStatus({ ...gamepad(), id: 'Wireless Controller (Vendor: 054c Product: 0ce6)' }, true), /DualSense detected/);
  assert.match(getControllerStatus({ ...gamepad(), id: 'Generic Gamepad' }, true), /Controller detected/);
  assert.match(getControllerStatus({ ...gamepad({ axes: [0.7, 0] }) }, true), /stick 0.70, 0.00/);
});

test('prefers a connected controller that is actively providing movement input', () => {
  const idle = gamepad();
  const moving = gamepad({ axes: [-0.8, 0] });
  assert.equal(selectActiveGamepad([idle, moving]), moving);
  assert.equal(selectActiveGamepad([null, idle]), idle);
  assert.equal(selectActiveGamepad([null]), null);
});