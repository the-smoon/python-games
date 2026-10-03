# Initial weapon and drop tuning

All settings are in `weaponRules.ts`. Timers use seconds on the browser's monotonic clock.

- Five weapon ranks. A different weapon starts at rank 1 and restores 10 HP per rank lost, capped at 100 hull HP.
- Twin guns retain four bullets from the two gun pods. Rank increases damage from 1 to 2 per bullet and reduces the interval from 8/60 to 5.2/60 seconds. Rank 5 adds two wingmen, each with 20 hidden HP; another twin pickup restores destroyed wingmen.
- Spread fires 5/7/9/11/13 pellets. Each deals 2.5/3/3.5/4/4.5 damage. Its interval decreases from 0.42 to 0.32 seconds. Every tenth volley freezes targets caught within a 48-unit splash for 3 seconds; affected enemies move and fire at 40% of their normal rate. Frozen bullets are harmless and disappear into dust at expiry. Another splash refreshes, but does not multiply, the effect.
- Laser widens from 6 to 26 units and deals 95/140/185/230/275 damage per aligned target, once per beam. It clears hostile bullets that cross its full visible 0.16-second span. Charge decreases from 0.65 to 0.25 seconds and cooldown from 1.6 to 0.8 seconds. Physical speed must be at most 0.08 to charge. Movement cancels an unfinished charge without spending cooldown.
- Rapid fire lasts 10 seconds and multiplies firing/laser recharge speed by 1.5. Shield lasts 6 seconds. Repeated boosts refresh duration. Repair restores 25 HP.
- Regular enemy drop chance scales from 2.5% for a 1-HP enemy to 11% at 22 HP. Sub-bosses have a 25% chance; after 24 ordinary/sub-boss kills without a drop, the next kill guarantees one. Boss defeats have a 50% chance. Weights: twin/spread/laser 18% each, repair 16%, shield 12%, rapid 10%, bomb 8%.
- At most 10 drops exist; they descend at 55 units/second and expire after 12 seconds. Player shots cap at 320; hostile shots retain their existing cap.
- Bombs activate on pickup. Regular enemies with maximum HP at most 8 are destroyed; other enemies take the lesser of 25 damage or 55% of their maximum HP, so a healthy tougher enemy survives a bomb. Bosses take 180 damage. Bomb-created kills cannot produce more drops.
- Weapon rank and surviving wingmen persist between levels. Timed boosts expire normally; all arsenal state resets on a fresh run.

These are starting balance values, not intended to match damage or timings from the games that inspired the weapon ideas.