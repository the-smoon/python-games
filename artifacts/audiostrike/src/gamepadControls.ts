export type ControllerVector = { x: number; y: number };

export const neutralControllerVector = (): ControllerVector => ({ x: 0, y: 0 });

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function applyDeadzone(value: number, deadzone = 0.18) {
  const safeValue = Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  const magnitude = Math.abs(safeValue);
  if (magnitude <= deadzone) return 0;
  return Math.sign(safeValue) * (magnitude - deadzone) / (1 - deadzone);
}

export function mapGamepadInput(gamepad: Pick<Gamepad, 'axes' | 'buttons'>): ControllerVector {
  const pressed = (index: number) => {
    const button = gamepad.buttons[index];
    return Boolean(button?.pressed || (button?.value ?? 0) > 0.5);
  };
  const left = pressed(14) ? 1 : 0;
  const right = pressed(15) ? 1 : 0;
  const up = pressed(12) ? 1 : 0;
  const down = pressed(13) ? 1 : 0;
  let x = clamp(applyDeadzone(gamepad.axes[0] ?? 0) + right - left, -1, 1);
  let y = clamp(applyDeadzone(gamepad.axes[1] ?? 0) + down - up, -1, 1);
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }
  return { x, y };
}

export function getControllerStatus(
  gamepad: Pick<Gamepad, 'id'> | null,
  apiAvailable: boolean,
): string {
  if (!apiAvailable) return 'Controller input is unavailable in this browser';
  if (!gamepad) return 'No controller detected · connect and press a button';
  const id = gamepad.id.toLowerCase();
  const isDualSense = id.includes('dualsense') || id.includes('dual sense')
    || /vendor:\s*054c.*product:\s*(?:0ce6|0df2)/i.test(gamepad.id);
  return isDualSense
    ? 'DualSense connected · stick / D-pad to steer'
    : 'Controller connected · stick / D-pad to steer';
}