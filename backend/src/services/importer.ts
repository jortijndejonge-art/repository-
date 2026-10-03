import type { Id, ImportLogin, ImportRequest, ImportResult } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import type { AuthService } from './auth';

const DEFAULT_RATING = 5;

/** The name shown on the lineup: "Jo S.", or just "Sam" when the sheet had no surname. */
const shortName = (first: string, last: string) => (last === '-' || last === '' ? first : `${first} ${last.charAt(0)}.`);

/**
 * Bring a spreadsheet's players into a team. One bad row never stops the rest: each row either becomes a
 * player or comes back in `skipped` with a reason in plain words. New logins are returned once, for the
 * manager to hand out.
 */
export class ImportService {
  constructor(
    private readonly repo: Repository,
    private readonly auth: Pick<AuthService, 'createPlayerLogin' | 'addGuardian'>,
  ) {}

  async run(teamId: Id, request: ImportRequest): Promise<ImportResult> {
    const existing = new Set((await this.repo.listTeamPlayers(teamId)).map((p) => p.displayName.toLowerCase()));
    const result: ImportResult = { created: 0, guardiansLinked: 0, skipped: [], logins: [] };

    for (const [index, row] of request.players.entries()) {
      const name = `${row.firstName} ${row.lastName === '-' ? '' : row.lastName}`.trim();
      const skip = (reason: string) => result.skipped.push({ index, name, reason });
      const displayName = shortName(row.firstName, row.lastName);
      if (existing.has(displayName.toLowerCase())) {
        skip('Looks like a player who is already in the squad (same name). Add them by hand if they are different.');
        continue;
      }

      let memberId: Id;
      try {
        const player = await this.repo.addPlayer(teamId, {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          displayName,
          phone: row.phone,
          shirtNumber: row.shirtNumber,
          positions: row.positions?.length ? row.positions : ['MID'],
          skill: DEFAULT_RATING,
          stamina: DEFAULT_RATING,
        });
        memberId = player.memberId;
        existing.add(player.displayName.toLowerCase());
        result.created++;
      } catch (err) {
        skip((err as { code?: string }).code === '23505' ? 'That email address is already used by someone in the club.' : 'Could not be added.');
        continue;
      }

      const login = async (make: () => Promise<{ email: string; password: string } | undefined>, who: string, role: string) => {
        try {
          const made = await make();
          if (made) result.logins.push({ name: who, email: made.email, password: made.password, role } satisfies ImportLogin);
        } catch {
          skip(`${who} was added, but their sign-in could not be created.`);
        }
      };

      if (request.createLogins && row.email) {
        await login(() => this.auth.createPlayerLogin(memberId, row.email), name, 'Player');
      }
      if (row.guardianEmail) {
        try {
          const linked = await this.auth.addGuardian(teamId, memberId, {
            firstName: row.guardianFirstName ?? 'Parent',
            lastName: row.guardianLastName ?? (row.lastName === '-' ? 'Guardian' : row.lastName),
            email: row.guardianEmail,
          });
          result.guardiansLinked++;
          if (linked.password) {
            result.logins.push({
              name: `${linked.guardian.firstName} ${linked.guardian.lastName}`,
              email: linked.guardian.email ?? row.guardianEmail,
              password: linked.password,
              role: `Parent of ${name}`,
            });
          }
        } catch {
          skip(`${name} was added, but the parent could not be linked.`);
        }
      }
    }
    return result;
  }
}
