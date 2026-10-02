import './weapons.css';
import { WEAPON_BALANCE, weaponStats } from './weaponRules';
import type { WeaponState } from './weaponRules';

const NAMES = { TWIN: 'Twin guns', SPREAD: 'Spread', LASER: 'Laser' } as const;

type Props = { weapon: WeaponState; now: number; message: string; messageUntil: number };

function WeaponHUD({ weapon, now, message, messageUntil }: Props) {
  const rapid = weapon.rapidUntil - now;
  const shield = weapon.shieldUntil - now;
  const alive = weapon.companions.filter((hp) => hp > 0).length;
  const showCrew = weapon.type === 'TWIN' && weapon.rank >= WEAPON_BALANCE.maxRank;
  const boost = rapid > 0 ? WEAPON_BALANCE.rapidMultiplier : 1;
  let laser: { cls: string; label: string; hint?: string; fill: number } | null = null;
  if (weapon.type === 'LASER') {
    const st = weaponStats('LASER', weapon.rank);
    if (weapon.chargeStartedAt !== null) {
      const f = Math.min(1, (now - weapon.chargeStartedAt) / (st.laserCharge / boost));
      laser = { cls: '', label: 'Charging', fill: f };
    } else if (now < weapon.cooldownUntil) {
      const f = 1 - (weapon.cooldownUntil - now) / (st.laserCooldown / boost);
      laser = { cls: '', label: 'Cooldown', fill: Math.max(0, Math.min(1, f)) };
    } else {
      laser = { cls: 'ready', label: 'Ready', hint: 'Stop moving to charge', fill: 1 };
    }
  }
  return (
    <>
      <div className="weapon-hud" data-type={weapon.type} data-testid="hud-weapon">
        <div className="weapon-name">
          <span>{NAMES[weapon.type]}</span>
          <span data-testid="text-weapon-rank">R{weapon.rank}/5</span>
        </div>
        <div className="weapon-ranks" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`weapon-rank${n <= weapon.rank ? ' on' : ''}`} />)}
        </div>
        {rapid > 0 && <div className="weapon-timer rapid"><span>Rapid</span><span>{Math.ceil(rapid)}s</span></div>}
        {shield > 0 && <div className="weapon-timer shield"><span>Shield</span><span>{Math.ceil(shield)}s</span></div>}
        {showCrew && <div className="weapon-timer crew"><span>Wingmen</span><span>{alive}/2</span></div>}
        {laser && (
          <div className={`weapon-laser ${laser.cls}`}>
            <div className="weapon-timer"><span>{laser.label}</span></div>
            <div className="bar"><i style={{ transform: `scaleX(${laser.fill})` }} /></div>
            {laser.hint && <small>{laser.hint}</small>}
          </div>
        )}
      </div>
      {message && now < messageUntil && <div className="weapon-message" data-testid="text-weapon-message">{message}</div>}
    </>
  );
}

export default WeaponHUD;
