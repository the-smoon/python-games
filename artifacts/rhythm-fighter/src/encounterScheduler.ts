import { advanceEncounter, encounterProgress, newestLivingBoss, type BossEncounter } from './gameRules';

export type ScheduledBoss = { id: number; health: number; phase: string };

/** Owns encounter deadlines independently of boss lifetimes, so carried bosses never delay arrivals. */
export class EncounterScheduler<TBoss extends ScheduledBoss> {
  private activeBosses: TBoss[] = [];
  private activeEncounter: BossEncounter | null = null;
  private nextId = 0;
  private protectedThrough = 0;

  get bosses(): readonly TBoss[] { return this.activeBosses; }
  get encounter(): Readonly<BossEncounter> | null { return this.activeEncounter; }
  get serial() { return this.nextId; }
  get protectedUntil() { return this.protectedThrough; }

  createBossId() {
    this.nextId += 1;
    return this.nextId;
  }

  addBoss(boss: TBoss) {
    this.activeBosses.push(boss);
  }

  latestBoss() {
    return this.activeBosses.at(-1);
  }

  findBoss(id: number) {
    return this.activeBosses.find((boss) => boss.id === id);
  }

  livingBoss() {
    return newestLivingBoss(this.activeBosses);
  }

  setEncounter(id: number, startedAt: number) {
    this.activeEncounter = { id, startedAt, advanced: false };
  }

  setEncounterStart(startedAt: number) {
    if (this.activeEncounter) this.activeEncounter.startedAt = startedAt;
  }

  progress(now: number) {
    return this.activeEncounter ? encounterProgress(this.activeEncounter, now) : null;
  }

  advance(now: number, defeatedId?: number) {
    return advanceEncounter(this.activeEncounter, now, defeatedId);
  }

  protectUntil(deadline: number) {
    this.protectedThrough = deadline;
  }

  retainBosses(predicate: (boss: TBoss) => boolean) {
    this.activeBosses = this.activeBosses.filter(predicate);
  }

  reset() {
    this.activeBosses = [];
    this.activeEncounter = null;
    this.nextId = 0;
    this.protectedThrough = 0;
  }
}