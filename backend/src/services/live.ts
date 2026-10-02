import type { Id, LiveMatch, LiveStatus, LiveSubstitution } from '@hockey/contracts';
import { benchNow, pitchAt, secondsPlayed } from '@hockey/engine';
import type { Repository } from '../db/repository';
import { badRequest, conflict, notFound } from './errors';

/** The clock and substitutions for a match being played, and the minutes it adds to the season. */
export class LiveService {
  constructor(
    private readonly repo: Repository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Playing time so far, including the stretch since the clock was last started. */
  private elapsed(row: { status: LiveStatus; elapsedSeconds: number; resumedAt?: string }) {
    if (row.status !== 'running' || !row.resumedAt) return row.elapsedSeconds;
    return row.elapsedSeconds + Math.max(0, Math.floor((this.now().getTime() - new Date(row.resumedAt).getTime()) / 1000));
  }

  async get(fixtureId: Id): Promise<LiveMatch | null> {
    const row = await this.repo.getLiveMatch(fixtureId);
    if (!row) return null;
    return {
      fixtureId,
      status: row.status,
      elapsedSeconds: this.elapsed(row),
      substitutions: await this.repo.listLiveSubstitutions(fixtureId),
    };
  }

  private async require(fixtureId: Id) {
    const row = await this.repo.getLiveMatch(fixtureId);
    if (!row) throw notFound('This match has not been started');
    return row;
  }

  async start(fixtureId: Id): Promise<LiveMatch> {
    if (await this.repo.getLiveMatch(fixtureId)) throw conflict('This match has already been started');
    if (!(await this.repo.getLineup(fixtureId))) throw badRequest('Save a lineup for this match before starting it');
    await this.repo.createLiveMatch(fixtureId, this.now());
    return (await this.get(fixtureId))!;
  }

  async pause(fixtureId: Id): Promise<LiveMatch> {
    const row = await this.require(fixtureId);
    if (row.status !== 'running') throw conflict('The clock is not running');
    if (!(await this.repo.updateLiveMatch(fixtureId, { status: 'paused', elapsedSeconds: this.elapsed(row), resumedAt: null }))) {
      throw conflict('The match is over');
    }
    return (await this.get(fixtureId))!;
  }

  async resume(fixtureId: Id): Promise<LiveMatch> {
    const row = await this.require(fixtureId);
    if (row.status !== 'paused') throw conflict('The clock is not paused');
    if (!(await this.repo.updateLiveMatch(fixtureId, { status: 'running', elapsedSeconds: row.elapsedSeconds, resumedAt: this.now() }))) {
      throw conflict('The match is over');
    }
    return (await this.get(fixtureId))!;
  }

  /** Swap `off` for `on` in a slot, at the current playing time. */
  async substitute(fixtureId: Id, slotId: string, offMemberId: Id, onMemberId: Id): Promise<LiveMatch> {
    const row = await this.require(fixtureId);
    if (row.status === 'finished') throw conflict('The match is over');
    const lineup = await this.repo.getLineup(fixtureId);
    if (!lineup) throw notFound('No lineup for this match');
    const events = await this.repo.listLiveSubstitutions(fixtureId);

    if (pitchAt(lineup.starting, events).get(slotId) !== offMemberId) throw conflict('That player is not in that position right now');
    if (!benchNow(lineup.starting, lineup.bench, events).includes(onMemberId)) {
      throw conflict('That player is not available on the bench');
    }
    await this.repo.addLiveSubstitution(fixtureId, { atSecond: this.elapsed(row), slotId, offMemberId, onMemberId });
    return (await this.get(fixtureId))!;
  }

  /** Stop the clock for good and add each player's minutes to their season total. Only counts once. */
  async finish(fixtureId: Id): Promise<LiveMatch> {
    const row = await this.require(fixtureId);
    if (row.status === 'finished') return (await this.get(fixtureId))!;
    const lineup = await this.repo.getLineup(fixtureId);
    const total = this.elapsed(row);
    // Claim the finish first: if two requests race, only the one that flips the status adds the minutes.
    const claimed = await this.repo.updateLiveMatch(fixtureId, { status: 'finished', elapsedSeconds: total, resumedAt: null });
    if (!claimed) return (await this.get(fixtureId))!;
    if (lineup) {
      const events: LiveSubstitution[] = await this.repo.listLiveSubstitutions(fixtureId);
      for (const [memberId, seconds] of Object.entries(secondsPlayed(lineup.starting, events, total))) {
        await this.repo.addSeasonMinutes(memberId, Math.round(seconds / 60));
      }
    }
    return (await this.get(fixtureId))!;
  }
}
