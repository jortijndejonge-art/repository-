import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type {
  AvailabilityStatus,
  FixtureUpdate,
  Id,
  Lineup,
  NewCustomFormation,
  ImportRequest,
  NewAnnouncement,
  NewPitchSlot,
  NewBriefing,
  NewGuardian,
  NewFixture,
  NewTrainingSession,
  TrainingSessionUpdate,
  NewMembershipPlan,
  NewPlayer,
  PitchPosition,
  PlayerProfileUpdate,
  SquadFormat,
  SuggestionRequest,
  EventKind,
} from '@hockey/contracts';
import { buildCustomFormationSlots, formationsFor, validateLineCounts, FORMATIONS } from '@hockey/engine';
import type { Config } from './config';
import type { Repository } from './db/repository';
import { Access } from './services/access';
import { AuthService } from './services/auth';
import { badRequest, forbidden, HttpError, notFound, unauthorized } from './services/errors';
import { BriefingService } from './services/briefings';
import { ImportService } from './services/importer';
import { LineupService } from './services/lineups';
import { ChaseService } from './services/chase';
import { ChatService } from './services/chat';
import { LiveService } from './services/live';
import { ScheduleService } from './services/schedule';
import { TrainingService } from './services/training';
import type { Mailer } from './services/mailer';
import { DisabledProvider, PaymentService, type PaymentProvider } from './services/payments';

export interface AppDeps {
  repo: Repository;
  mailer: Mailer;
  /** True when real email is set up, so reminders are also emailed. */
  emailEnabled?: boolean;
  config: Config;
  /** Payment processor; payments are switched off when omitted. */
  payments?: PaymentProvider;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Email members whose membership payment is due soon; returns how many were emailed. */
    sendPaymentReminders(): Promise<number>;
    /** Remind players (and parents) who have not answered for matches in the next three days; returns matches chased. */
    chaseAvailability(): Promise<number>;
  }
  interface FastifyRequest {
    memberId?: Id;
    accessToken?: string;
  }
}

// --- JSON schemas for request validation (mirrors api-spec.yaml) ---
const positions = { type: 'array', minItems: 1, items: { enum: ['GK', 'DEF', 'MID', 'FWD'] } } as const;
const rating = { type: 'integer', minimum: 1, maximum: 10 } as const;
const slotAssignment = {
  type: 'object',
  required: ['slotId', 'memberId'],
  properties: { slotId: { type: 'string' }, memberId: { type: ['string', 'null'] } },
} as const;
const substitution = {
  type: 'object',
  required: ['minute', 'slotId', 'offMemberId', 'onMemberId'],
  properties: {
    minute: { type: 'integer', minimum: 0 },
    slotId: { type: 'string' },
    offMemberId: { type: 'string' },
    onMemberId: { type: 'string' },
  },
} as const;
const fixtureProps = {
  pitchId: { type: 'string', maxLength: 80 },
  opponent: { type: 'string', minLength: 1, maxLength: 120 },
  startsAt: { type: 'string', format: 'date-time' },
  venue: { type: 'string', minLength: 1, maxLength: 160 },
  homeAway: { enum: ['home', 'away'] },
  format: { enum: [5, 7, 11] },
  durationMinutes: { type: 'integer', minimum: 5, maximum: 240 },
  periods: { type: 'integer', minimum: 1, maximum: 8 },
} as const;
const trainingProps = {
  startsAt: { type: 'string', format: 'date-time' },
  durationMinutes: { type: 'integer', minimum: 5, maximum: 300 },
  venue: { type: 'string', minLength: 1, maxLength: 160 },
  notes: { type: 'string', maxLength: 1000 },
} as const;
const strategy = { enum: ['fair', 'strongest', 'stamina'] } as const;

export function buildApp({ repo, mailer, emailEnabled = false, config, payments = new DisabledProvider(), logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  const auth = new AuthService(repo, mailer, config);
  const access = new Access(repo);
  const lineups = new LineupService(repo, mailer, config.appUrl);
  const chat = new ChatService(repo, access, lineups);
  const training = new TrainingService(repo);
  const live = new LiveService(repo);
  const importer = new ImportService(repo, auth);
  const schedule = new ScheduleService(repo);
  const chaser = new ChaseService(repo, mailer, config.appUrl, emailEnabled);
  const briefings = new BriefingService(repo);
  const paymentService = new PaymentService(repo, payments, mailer, config.appUrl);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) return reply.code(400).send({ error: e.message });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong' });
  });

  /** Resolve the signed-in member from "Authorization: Bearer <token>". */
  const signedIn = async (req: FastifyRequest): Promise<Id> => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const memberId = token ? await auth.authenticate(token) : null;
    if (!memberId) throw unauthorized();
    req.memberId = memberId;
    req.accessToken = token;
    return memberId;
  };

  const fixtureTeam = async (fixtureId: Id) => (await lineups.fixture(fixtureId)).teamId;

  app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));

      // ---- B1. Magic-link auth ------------------------------------------------
      api.post<{ Body: { email: string } }>(
        '/auth/magic-link',
        {
          schema: {
            body: {
              type: 'object',
              required: ['email'],
              properties: { email: { type: 'string', minLength: 3, maxLength: 320 } },
            },
          },
        },
        async (req, reply) => {
          const link = await auth.requestSignIn(req.body.email);
          reply.code(202);
          return config.exposeDevLinks && link ? { sent: true, devLink: link } : { sent: true };
        },
      );

      api.post<{ Body: { token: string } }>(
        '/auth/magic-link/verify',
        {
          schema: {
            body: { type: 'object', required: ['token'], properties: { token: { type: 'string', minLength: 1 } } },
          },
        },
        async (req) => auth.verify(req.body.token),
      );

      api.post<{ Body: { email: string; password: string } }>(
        '/auth/login',
        {
          schema: {
            body: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', minLength: 3, maxLength: 320 },
                password: { type: 'string', minLength: 1, maxLength: 200 },
              },
            },
          },
        },
        async (req) => auth.loginWithPassword(req.body.email, req.body.password),
      );

      api.put<{ Body: { currentPassword?: string; newPassword: string } }>(
        '/me/password',
        {
          schema: {
            body: {
              type: 'object',
              required: ['newPassword'],
              properties: {
                currentPassword: { type: 'string', maxLength: 200 },
                newPassword: { type: 'string', maxLength: 200 },
              },
            },
          },
        },
        async (req, reply) => {
          await auth.setPassword(await signedIn(req), req.body.newPassword, req.body.currentPassword);
          return reply.code(204).send();
        },
      );

      api.post('/auth/logout', async (req, reply) => {
        await signedIn(req);
        await auth.signOut(req.accessToken!);
        return reply.code(204).send();
      });

      // ---- B2. Accounts & roles ----------------------------------------------
      api.get('/me', async (req) => auth.me(await signedIn(req)));

      api.post<{ Params: { teamId: Id; memberId: Id }; Body: { email?: string } | null }>(
        '/teams/:teamId/players/:memberId/login',
        {
          schema: {
            body: { type: ['object', 'null'], properties: { email: { type: 'string', maxLength: 320 } } },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          const squad = await repo.listTeamPlayers(req.params.teamId);
          if (!squad.some((p) => p.memberId === req.params.memberId)) throw notFound('Player not in this team');
          return auth.createPlayerLogin(req.params.memberId, req.body?.email);
        },
      );

      api.get<{ Params: { teamId: Id; memberId: Id } }>('/teams/:teamId/players/:memberId/guardians', async (req) => {
        await access.requireManager(await signedIn(req), req.params.teamId);
        const squad = await repo.listTeamPlayers(req.params.teamId);
        if (!squad.some((p) => p.memberId === req.params.memberId)) throw notFound('Player not in this team');
        return repo.listGuardians(req.params.memberId);
      });

      api.post<{ Params: { teamId: Id; memberId: Id }; Body: NewGuardian }>(
        '/teams/:teamId/players/:memberId/guardians',
        {
          schema: {
            body: {
              type: 'object',
              required: ['firstName', 'lastName', 'email'],
              additionalProperties: false,
              properties: {
                firstName: { type: 'string', minLength: 1, maxLength: 80 },
                lastName: { type: 'string', minLength: 1, maxLength: 80 },
                email: { type: 'string', minLength: 3, maxLength: 320 },
              },
            },
          },
        },
        async (req, reply) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          const squad = await repo.listTeamPlayers(req.params.teamId);
          if (!squad.some((p) => p.memberId === req.params.memberId)) throw notFound('Player not in this team');
          reply.code(201);
          return auth.addGuardian(req.params.teamId, req.params.memberId, req.body);
        },
      );

      api.post<{ Params: { teamId: Id }; Body: ImportRequest }>(
        '/teams/:teamId/import',
        {
          bodyLimit: 2_000_000,
          schema: {
            body: {
              type: 'object',
              required: ['players', 'createLogins'],
              additionalProperties: false,
              properties: {
                createLogins: { type: 'boolean' },
                players: {
                  type: 'array',
                  maxItems: 500,
                  items: {
                    type: 'object',
                    required: ['firstName', 'lastName'],
                    additionalProperties: false,
                    properties: {
                      firstName: { type: 'string', minLength: 1, maxLength: 80 },
                      lastName: { type: 'string', minLength: 1, maxLength: 80 },
                      email: { type: 'string', maxLength: 320 },
                      phone: { type: 'string', maxLength: 40 },
                      shirtNumber: { type: 'integer', minimum: 0, maximum: 999 },
                      positions,
                      guardianEmail: { type: 'string', maxLength: 320 },
                      guardianFirstName: { type: 'string', maxLength: 80 },
                      guardianLastName: { type: 'string', maxLength: 80 },
                    },
                  },
                },
              },
            },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          return importer.run(req.params.teamId, req.body);
        },
      );

      api.get<{ Params: { clubId: Id } }>('/clubs/:clubId/teams', async (req) => {
        await access.requireClubMember(await signedIn(req), req.params.clubId);
        return repo.listClubTeams(req.params.clubId);
      });

      api.post<{ Params: { memberId: Id } }>('/members/:memberId/invite', async (req, reply) => {
        const actor = await signedIn(req);
        const memberships = await repo.listMemberships(req.params.memberId);
        if (memberships.length === 0) throw notFound('Member not found');
        // Must manage at least one of the member's teams.
        const managed = await Promise.all(memberships.map((m) => access.isManager(actor, m.teamId)));
        if (!managed.some(Boolean)) throw forbidden('Only a manager of this member can invite them');
        const link = await auth.invite(req.params.memberId);
        reply.code(202);
        return config.exposeDevLinks ? { sent: true, devLink: link } : { sent: true };
      });

      // ---- B3. Player profiles ------------------------------------------------
      api.get<{ Params: { teamId: Id } }>('/teams/:teamId/players', async (req) => {
        await access.requireTeamMember(await signedIn(req), req.params.teamId);
        return repo.listTeamPlayers(req.params.teamId);
      });

      api.post<{ Params: { teamId: Id }; Body: NewPlayer }>(
        '/teams/:teamId/players',
        {
          schema: {
            body: {
              type: 'object',
              required: ['firstName', 'lastName', 'positions', 'skill', 'stamina'],
              additionalProperties: false,
              properties: {
                firstName: { type: 'string', minLength: 1, maxLength: 80 },
                lastName: { type: 'string', minLength: 1, maxLength: 80 },
                email: { type: 'string', maxLength: 320 },
                phone: { type: 'string', maxLength: 40 },
                displayName: { type: 'string', minLength: 1, maxLength: 40 },
                shirtNumber: { type: 'integer', minimum: 0, maximum: 999 },
                positions,
                skill: rating,
                stamina: rating,
              },
            },
          },
        },
        async (req, reply) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          reply.code(201);
          return repo.addPlayer(req.params.teamId, req.body);
        },
      );

      api.patch<{ Params: { teamId: Id; memberId: Id }; Body: PlayerProfileUpdate }>(
        '/teams/:teamId/players/:memberId',
        {
          schema: {
            body: {
              type: 'object',
              additionalProperties: false,
              properties: {
                displayName: { type: 'string', minLength: 1, maxLength: 40 },
                shirtNumber: { type: 'integer', minimum: 0, maximum: 999 },
                positions,
                skill: rating,
                stamina: rating,
                seasonMinutes: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          const squad = await repo.listTeamPlayers(req.params.teamId);
          if (!squad.some((p) => p.memberId === req.params.memberId)) throw notFound('Player not in this team');
          return repo.updatePlayer(req.params.memberId, req.body);
        },
      );

      // ---- Fixtures & B4. Availability -----------------------------------------
      api.get<{ Params: { teamId: Id }; Querystring: { from?: string } }>(
        '/teams/:teamId/fixtures',
        { schema: { querystring: { type: 'object', properties: { from: { type: 'string', format: 'date-time' } } } } },
        async (req) => {
          // Parents too: they follow their child's schedule.
          await access.requireTeamViewer(await signedIn(req), req.params.teamId);
          return repo.listTeamFixtures(req.params.teamId, req.query.from);
        },
      );

      api.post<{ Params: { teamId: Id }; Querystring: { force?: boolean }; Body: NewFixture }>(
        '/teams/:teamId/fixtures',
        {
          schema: {
            querystring: { type: 'object', properties: { force: { type: 'boolean' } } },
            body: {
              type: 'object',
              required: ['opponent', 'startsAt', 'venue', 'homeAway', 'format', 'durationMinutes', 'periods'],
              additionalProperties: false,
              properties: fixtureProps,
            },
          },
        },
        async (req, reply) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          if (!req.query.force) {
            const conflicts = await schedule.conflictsFor(req.params.teamId, req.body);
            if (conflicts.length) return reply.code(409).send({ error: 'That time clashes with something else.', conflicts });
          }
          reply.code(201);
          return repo.addFixture(req.params.teamId, req.body);
        },
      );

      // Dry run for the fixture form: what would clash if this match were saved (id = the match being edited).
      api.post<{ Params: { teamId: Id }; Body: { id?: Id; startsAt: string; durationMinutes: number; pitchId?: Id } }>(
        '/teams/:teamId/fixture-conflicts',
        {
          schema: {
            body: {
              type: 'object',
              required: ['startsAt', 'durationMinutes'],
              additionalProperties: false,
              properties: { id: { type: 'string' }, startsAt: fixtureProps.startsAt, durationMinutes: fixtureProps.durationMinutes, pitchId: fixtureProps.pitchId },
            },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          return schedule.conflictsFor(req.params.teamId, req.body);
        },
      );

      api.patch<{ Params: { fixtureId: Id }; Querystring: { force?: boolean }; Body: FixtureUpdate }>(
        '/fixtures/:fixtureId',
        { schema: { querystring: { type: 'object', properties: { force: { type: 'boolean' } } }, body: { type: 'object', additionalProperties: false, properties: fixtureProps } } },
        async (req, reply) => {
          const teamId = await fixtureTeam(req.params.fixtureId);
          await access.requireManager(await signedIn(req), teamId);
          if (!req.query.force) {
            const current = await repo.getFixture(req.params.fixtureId);
            if (!current) throw notFound('Fixture not found');
            const merged = { ...current, ...req.body };
            const conflicts = await schedule.conflictsFor(teamId, { id: current.id, startsAt: merged.startsAt, durationMinutes: merged.durationMinutes, pitchId: merged.pitchId });
            if (conflicts.length) return reply.code(409).send({ error: 'That time clashes with something else.', conflicts });
          }
          return (await repo.updateFixture(req.params.fixtureId, req.body)) ?? Promise.reject(notFound('Fixture not found'));
        },
      );

      api.delete<{ Params: { fixtureId: Id } }>('/fixtures/:fixtureId', async (req, reply) => {
        await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
        await repo.deleteFixture(req.params.fixtureId);
        return reply.code(204).send();
      });

      api.get<{ Params: { fixtureId: Id } }>('/fixtures/:fixtureId/availability', async (req) => {
        await access.requireTeamMember(await signedIn(req), await fixtureTeam(req.params.fixtureId));
        return lineups.availability(req.params.fixtureId);
      });

      api.put<{ Params: { fixtureId: Id }; Body: { memberId: Id; status: AvailabilityStatus; note?: string } }>(
        '/fixtures/:fixtureId/availability',
        {
          schema: {
            body: {
              type: 'object',
              required: ['memberId', 'status'],
              properties: {
                memberId: { type: 'string' },
                status: { enum: ['available', 'unavailable', 'maybe', 'no_response'] },
                note: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
        async (req) => {
          const actor = await signedIn(req);
          const teamId = await fixtureTeam(req.params.fixtureId);
          await access.requireCanActFor(actor, req.body.memberId, teamId);
          const squad = await repo.listTeamPlayers(teamId);
          if (!squad.some((p) => p.memberId === req.body.memberId)) throw notFound('Player not in this team');
          return repo.setAvailability(req.params.fixtureId, req.body.memberId, req.body.status, req.body.note);
        },
      );

      // ---- B5. Lineups & B6. suggestions -----------------------------------------
      api.get<{ Querystring: { format?: string } }>('/formations', async (req) => {
        const format = Number(req.query.format);
        return [5, 7, 11].includes(format) ? formationsFor(format as SquadFormat) : FORMATIONS;
      });

      api.get<{ Params: { teamId: Id }; Querystring: { format?: string } }>('/teams/:teamId/formations', async (req) => {
        await access.requireTeamMember(await signedIn(req), req.params.teamId);
        const format = Number(req.query.format);
        return repo.listCustomFormations(req.params.teamId, [5, 7, 11].includes(format) ? (format as SquadFormat) : undefined);
      });

      api.post<{ Params: { teamId: Id }; Body: NewCustomFormation }>(
        '/teams/:teamId/formations',
        {
          schema: {
            body: {
              type: 'object',
              required: ['name', 'lines'],
              additionalProperties: false,
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 60 },
                lines: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 4,
                  items: { type: 'integer', minimum: 1, maximum: 5 },
                },
              },
            },
          },
        },
        async (req, reply) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          const check = validateLineCounts(req.body.lines);
          if (!check.ok) throw badRequest(check.error);
          reply.code(201);
          return repo.addCustomFormation(req.params.teamId, {
            name: req.body.name,
            format: check.format,
            slots: buildCustomFormationSlots(req.body.lines),
          });
        },
      );

      api.get<{ Params: { teamId: Id } }>('/teams/:teamId/formation-layouts', async (req) => {
        await access.requireTeamMember(await signedIn(req), req.params.teamId);
        return repo.listFormationLayouts(req.params.teamId);
      });

      api.put<{ Params: { teamId: Id; formationId: string }; Body: { positions: Record<string, PitchPosition> } }>(
        '/teams/:teamId/formation-layouts/:formationId',
        {
          schema: {
            body: {
              type: 'object',
              required: ['positions'],
              additionalProperties: false,
              properties: {
                positions: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    required: ['x', 'y'],
                    additionalProperties: false,
                    properties: {
                      x: { type: 'number', minimum: 0, maximum: 100 },
                      y: { type: 'number', minimum: 0, maximum: 100 },
                    },
                  },
                },
              },
            },
          },
        },
        async (req) => {
          const { teamId, formationId } = req.params;
          await access.requireManager(await signedIn(req), teamId);
          const formation = await lineups.resolveFormation(teamId, formationId);
          if (!formation) throw badRequest(`Unknown formation ${formationId}`);
          const slotIds = new Set(formation.slots.map((s) => s.id));
          for (const id of Object.keys(req.body.positions)) {
            if (!slotIds.has(id)) throw badRequest(`Position ${id} is not in formation ${formationId}`);
          }
          return repo.saveFormationLayout(teamId, { formationId, positions: req.body.positions });
        },
      );

      api.delete<{ Params: { teamId: Id; formationId: string } }>(
        '/teams/:teamId/formation-layouts/:formationId',
        async (req, reply) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          await repo.deleteFormationLayout(req.params.teamId, req.params.formationId);
          return reply.code(204).send();
        },
      );

      api.get<{ Params: { fixtureId: Id } }>('/fixtures/:fixtureId/lineup', async (req) => {
        await access.requireTeamMember(await signedIn(req), await fixtureTeam(req.params.fixtureId));
        const lineup = await repo.getLineup(req.params.fixtureId);
        if (!lineup) throw notFound('No lineup yet');
        return lineup;
      });

      api.put<{ Params: { fixtureId: Id }; Body: Lineup }>(
        '/fixtures/:fixtureId/lineup',
        {
          schema: {
            body: {
              type: 'object',
              required: ['formationId', 'strategy', 'starting', 'bench', 'substitutions'],
              properties: {
                formationId: { type: 'string' },
                strategy: { enum: ['fair', 'strongest', 'stamina', 'manual'] },
                starting: { type: 'array', items: slotAssignment },
                bench: { type: 'array', items: { type: 'string' } },
                substitutions: { type: 'array', items: substitution },
              },
            },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
          const { formationId, strategy, starting, bench, substitutions } = req.body;
          return lineups.save(req.params.fixtureId, { formationId, strategy, starting, bench, substitutions });
        },
      );

      api.post<{ Params: { fixtureId: Id }; Body: Omit<SuggestionRequest, 'fixtureId'> }>(
        '/fixtures/:fixtureId/lineup/suggest',
        {
          schema: {
            body: {
              type: 'object',
              required: ['formationId', 'strategy'],
              properties: {
                formationId: { type: 'string' },
                strategy,
                locked: { type: 'array', items: slotAssignment },
              },
            },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
          return lineups.suggest({ ...req.body, fixtureId: req.params.fixtureId });
        },
      );

      // ---- B7. Sharing ---------------------------------------------------------------
      api.post<{ Params: { fixtureId: Id }; Body: { memberIds?: Id[] } | undefined }>(
        '/fixtures/:fixtureId/lineup/share',
        {
          schema: {
            body: {
              type: ['object', 'null'],
              properties: { memberIds: { type: 'array', items: { type: 'string' } } },
            },
          },
        },
        async (req, reply) => {
          await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
          reply.code(202);
          return lineups.share(req.params.fixtureId, req.body?.memberIds);
        },
      );

      // ---- Season stats (Phase 2) ----------------------------------------------------
      api.get<{ Params: { teamId: Id } }>('/teams/:teamId/stats', async (req) => {
        await access.requireManager(await signedIn(req), req.params.teamId);
        return repo.getTeamStats(req.params.teamId, new Date());
      });

      // ---- Pre-match briefings (Phase 3) ---------------------------------------------
      // `?memberId=` lets a parent ask on behalf of a child ("have they seen it?").
      api.get<{ Params: { fixtureId: Id }; Querystring: { memberId?: Id } }>(
        '/fixtures/:fixtureId/briefing',
        { schema: { querystring: { type: 'object', properties: { memberId: { type: 'string' } } } } },
        async (req) => {
          const actor = await signedIn(req);
          const teamId = await fixtureTeam(req.params.fixtureId);
          await access.requireTeamMember(actor, teamId);
          const forMember = req.query.memberId ?? actor;
          if (forMember !== actor) await access.requireCanActFor(actor, forMember, teamId);
          return (await briefings.get(req.params.fixtureId, forMember)) ?? null;
        },
      );

      api.put<{ Params: { fixtureId: Id }; Body: NewBriefing }>(
        '/fixtures/:fixtureId/briefing',
        {
          schema: {
            body: {
              type: 'object',
              required: ['body', 'links'],
              additionalProperties: false,
              properties: {
                body: { type: 'string', maxLength: 5000 },
                links: {
                  type: 'array',
                  maxItems: 10,
                  items: {
                    type: 'object',
                    required: ['label', 'url'],
                    additionalProperties: false,
                    properties: { label: { type: 'string', maxLength: 120 }, url: { type: 'string', maxLength: 2000 } },
                  },
                },
              },
            },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
          return briefings.save(req.params.fixtureId, req.body);
        },
      );

      api.delete<{ Params: { fixtureId: Id } }>('/fixtures/:fixtureId/briefing', async (req, reply) => {
        await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
        await repo.deleteBriefing(req.params.fixtureId);
        return reply.code(204).send();
      });

      api.get<{ Params: { fixtureId: Id } }>('/fixtures/:fixtureId/briefing/reads', async (req) => {
        const teamId = await fixtureTeam(req.params.fixtureId);
        await access.requireManager(await signedIn(req), teamId);
        return briefings.reads(req.params.fixtureId, teamId);
      });

      api.post<{ Params: { fixtureId: Id }; Body: { memberId?: Id } | null }>(
        '/fixtures/:fixtureId/briefing/seen',
        { schema: { body: { type: ['object', 'null'], properties: { memberId: { type: 'string' } } } } },
        async (req, reply) => {
          const actor = await signedIn(req);
          const teamId = await fixtureTeam(req.params.fixtureId);
          const memberId = req.body?.memberId ?? actor;
          await access.requireCanActFor(actor, memberId, teamId);
          if (!(await repo.getBriefing(req.params.fixtureId))) throw notFound('No briefing for this match');
          await repo.markBriefingSeen(req.params.fixtureId, memberId);
          return reply.code(204).send();
        },
      );

      // ---- Live matchday (Phase 3) ---------------------------------------------------
      api.get<{ Params: { fixtureId: Id } }>('/fixtures/:fixtureId/live', async (req) => {
        await access.requireTeamMember(await signedIn(req), await fixtureTeam(req.params.fixtureId));
        return (await live.get(req.params.fixtureId)) ?? null;
      });

      for (const action of ['start', 'pause', 'resume', 'finish'] as const) {
        api.post<{ Params: { fixtureId: Id } }>(`/fixtures/:fixtureId/live/${action}`, async (req) => {
          await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
          return live[action](req.params.fixtureId);
        });
      }

      api.post<{ Params: { fixtureId: Id }; Body: { slotId: string; offMemberId: Id; onMemberId: Id } }>(
        '/fixtures/:fixtureId/live/substitute',
        {
          schema: {
            body: {
              type: 'object',
              required: ['slotId', 'offMemberId', 'onMemberId'],
              additionalProperties: false,
              properties: {
                slotId: { type: 'string' },
                offMemberId: { type: 'string' },
                onMemberId: { type: 'string' },
              },
            },
          },
        },
        async (req) => {
          await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
          const { slotId, offMemberId, onMemberId } = req.body;
          return live.substitute(req.params.fixtureId, slotId, offMemberId, onMemberId);
        },
      );

      // ---- Event chat: a group chat on each match and training session ---------------
      const eventParams = {
        type: 'object',
        required: ['kind', 'eventId'],
        properties: { kind: { enum: ['match', 'training'] }, eventId: { type: 'string' } },
      } as const;

      api.get<{ Params: { kind: EventKind; eventId: Id } }>('/events/:kind/:eventId/chat', { schema: { params: eventParams } }, async (req) =>
        chat.thread(req.params.kind, req.params.eventId, await signedIn(req)),
      );

      api.post<{ Params: { kind: EventKind; eventId: Id }; Body: { body: string } }>(
        '/events/:kind/:eventId/chat',
        {
          schema: {
            params: eventParams,
            body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', maxLength: 2000 } } },
          },
        },
        async (req, reply) => {
          reply.code(201);
          return chat.post(req.params.kind, req.params.eventId, await signedIn(req), req.body.body);
        },
      );

      api.post<{ Params: { fixtureId: Id }; Body: { note?: string } | undefined }>(
        '/fixtures/:fixtureId/lineup/chat',
        { schema: { body: { type: ['object', 'null'], additionalProperties: false, properties: { note: { type: 'string', maxLength: 2000 } } } } },
        async (req, reply) => {
          reply.code(201);
          return chat.postLineup(req.params.fixtureId, await signedIn(req), req.body?.note);
        },
      );

      api.delete<{ Params: { messageId: Id } }>('/chat/messages/:messageId', async (req, reply) => {
        await chat.remove(req.params.messageId, await signedIn(req));
        return reply.code(204).send();
      });

      api.get<{ Params: { teamId: Id } }>('/teams/:teamId/chat-unread', async (req) =>
        chat.unread(req.params.teamId, await signedIn(req)),
      );

      // ---- Pitches and the club schedule (Phase 4a) -----------------------------------
      api.get<{ Params: { clubId: Id } }>('/clubs/:clubId/pitches', async (req) => {
        await access.requireClubMember(await signedIn(req), req.params.clubId);
        return repo.listPitches(req.params.clubId);
      });

      api.post<{ Params: { clubId: Id }; Body: { name: string } }>(
        '/clubs/:clubId/pitches',
        { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } } } },
        async (req, reply) => {
          await access.requireClubAdmin(await signedIn(req), req.params.clubId);
          reply.code(201);
          return repo.addPitch(req.params.clubId, req.body.name.trim());
        },
      );

      api.delete<{ Params: { pitchId: Id } }>('/pitches/:pitchId', async (req, reply) => {
        const pitch = await repo.getPitch(req.params.pitchId);
        if (!pitch) throw notFound('Pitch not found');
        await access.requireClubAdmin(await signedIn(req), pitch.clubId);
        await repo.deletePitch(pitch.id);
        return reply.code(204).send();
      });

      api.post<{ Params: { pitchId: Id }; Body: NewPitchSlot }>(
        '/pitches/:pitchId/slots',
        {
          schema: {
            body: {
              type: 'object',
              required: ['weekday', 'startMinute', 'endMinute', 'ageGroups'],
              additionalProperties: false,
              properties: {
                weekday: { type: 'integer', minimum: 0, maximum: 6 },
                startMinute: { type: 'integer', minimum: 0, maximum: 1439 },
                endMinute: { type: 'integer', minimum: 1, maximum: 1440 },
                ageGroups: { type: 'array', minItems: 1, items: { enum: ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Adult'] } },
              },
            },
          },
        },
        async (req, reply) => {
          const pitch = await repo.getPitch(req.params.pitchId);
          if (!pitch) throw notFound('Pitch not found');
          await access.requireClubAdmin(await signedIn(req), pitch.clubId);
          if (req.body.endMinute <= req.body.startMinute) throw badRequest('The opening must end after it starts');
          reply.code(201);
          return repo.addPitchSlot(pitch.id, { ...req.body, ageGroups: [...new Set(req.body.ageGroups)] });
        },
      );

      api.delete<{ Params: { slotId: Id } }>('/pitch-slots/:slotId', async (req, reply) => {
        const pitchId = await repo.getPitchSlotPitchId(req.params.slotId);
        const pitch = pitchId ? await repo.getPitch(pitchId) : null;
        if (!pitch) throw notFound('Opening not found');
        await access.requireClubAdmin(await signedIn(req), pitch.clubId);
        await repo.deletePitchSlot(req.params.slotId);
        return reply.code(204).send();
      });

      // Every team's matches for a stretch of time, for the club-wide schedule. Managers and admins only.
      api.get<{ Params: { clubId: Id }; Querystring: { from: string; to: string } }>(
        '/clubs/:clubId/schedule',
        {
          schema: {
            querystring: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } },
          },
        },
        async (req) => {
          const actor = await signedIn(req);
          await access.requireClubMember(actor, req.params.clubId);
          const managing = (await repo.listMemberships(actor)).some((m) => m.roles.includes('manager') || m.roles.includes('admin'));
          if (!managing) throw forbidden('Only managers can see the club schedule');
          const from = new Date(req.query.from);
          const to = new Date(req.query.to);
          if (to.getTime() - from.getTime() > 120 * 86_400_000) throw badRequest('Ask for 120 days or fewer at a time');
          return repo.listClubFixtures(req.params.clubId, from, to);
        },
      );

      // ---- Availability chasing (Phase 3) --------------------------------------------
      api.post<{ Params: { fixtureId: Id } }>('/fixtures/:fixtureId/chase', async (req) => {
        await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
        return chaser.chase(req.params.fixtureId, { force: true });
      });

      // ---- Announcements (Phase 2) -------------------------------------------------
      api.get<{ Params: { teamId: Id } }>('/teams/:teamId/announcements', async (req) => {
        await access.requireTeamMember(await signedIn(req), req.params.teamId);
        return repo.listAnnouncements(req.params.teamId);
      });

      api.post<{ Params: { teamId: Id }; Body: NewAnnouncement }>(
        '/teams/:teamId/announcements',
        {
          schema: {
            body: {
              type: 'object',
              required: ['title', 'body'],
              additionalProperties: false,
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 120 },
                body: { type: 'string', minLength: 1, maxLength: 4000 },
              },
            },
          },
        },
        async (req, reply) => {
          const author = await signedIn(req);
          await access.requireManager(author, req.params.teamId);
          reply.code(201);
          return repo.addAnnouncement(req.params.teamId, author, req.body);
        },
      );

      api.delete<{ Params: { announcementId: Id } }>('/announcements/:announcementId', async (req, reply) => {
        const actor = await signedIn(req);
        const announcement = await repo.getAnnouncement(req.params.announcementId);
        if (!announcement) throw notFound('Announcement not found');
        await access.requireManager(actor, announcement.teamId);
        await repo.deleteAnnouncement(announcement.id);
        return reply.code(204).send();
      });

      // ---- Training sessions (Phase 2) ---------------------------------------------
      api.get<{ Params: { teamId: Id }; Querystring: { from?: string } }>(
        '/teams/:teamId/training',
        { schema: { querystring: { type: 'object', properties: { from: { type: 'string', format: 'date-time' } } } } },
        async (req) => {
          await access.requireTeamViewer(await signedIn(req), req.params.teamId);
          return repo.listTrainingSessions(req.params.teamId, req.query.from);
        },
      );

      api.post<{ Params: { teamId: Id }; Body: NewTrainingSession }>(
        '/teams/:teamId/training',
        {
          schema: {
            body: {
              type: 'object',
              required: ['startsAt', 'durationMinutes', 'venue'],
              additionalProperties: false,
              properties: trainingProps,
            },
          },
        },
        async (req, reply) => {
          await access.requireManager(await signedIn(req), req.params.teamId);
          reply.code(201);
          return repo.addTrainingSession(req.params.teamId, req.body);
        },
      );

      api.patch<{ Params: { sessionId: Id }; Body: TrainingSessionUpdate }>(
        '/training/:sessionId',
        { schema: { body: { type: 'object', additionalProperties: false, properties: trainingProps } } },
        async (req) => {
          await access.requireManager(await signedIn(req), (await training.session(req.params.sessionId)).teamId);
          return (await repo.updateTrainingSession(req.params.sessionId, req.body)) ?? Promise.reject(notFound());
        },
      );

      api.delete<{ Params: { sessionId: Id } }>('/training/:sessionId', async (req, reply) => {
        await access.requireManager(await signedIn(req), (await training.session(req.params.sessionId)).teamId);
        await repo.deleteTrainingSession(req.params.sessionId);
        return reply.code(204).send();
      });

      api.get<{ Params: { sessionId: Id } }>('/training/:sessionId/responses', async (req) => {
        await access.requireTeamMember(await signedIn(req), (await training.session(req.params.sessionId)).teamId);
        return training.responses(req.params.sessionId);
      });

      api.put<{ Params: { sessionId: Id }; Body: { memberId: Id; status: AvailabilityStatus } }>(
        '/training/:sessionId/rsvp',
        {
          schema: {
            body: {
              type: 'object',
              required: ['memberId', 'status'],
              properties: {
                memberId: { type: 'string' },
                status: { enum: ['available', 'unavailable', 'maybe', 'no_response'] },
              },
            },
          },
        },
        async (req, reply) => {
          const actor = await signedIn(req);
          const { teamId } = await training.session(req.params.sessionId);
          await access.requireCanActFor(actor, req.body.memberId, teamId);
          await training.requireInSquad(teamId, req.body.memberId);
          await repo.setTrainingRsvp(req.params.sessionId, req.body.memberId, req.body.status);
          return reply.code(204).send();
        },
      );

      api.put<{ Params: { sessionId: Id }; Body: { memberId: Id; attended: boolean } }>(
        '/training/:sessionId/attendance',
        {
          schema: {
            body: {
              type: 'object',
              required: ['memberId', 'attended'],
              properties: { memberId: { type: 'string' }, attended: { type: 'boolean' } },
            },
          },
        },
        async (req, reply) => {
          const { teamId } = await training.session(req.params.sessionId);
          await access.requireManager(await signedIn(req), teamId);
          await training.requireInSquad(teamId, req.body.memberId);
          await repo.setTrainingAttendance(req.params.sessionId, req.body.memberId, req.body.attended);
          return reply.code(204).send();
        },
      );

      // ---- Memberships & payments (Stripe) ---------------------------------------
      api.get<{ Params: { clubId: Id } }>('/clubs/:clubId/membership-plans', async (req) => {
        await access.requireClubMember(await signedIn(req), req.params.clubId);
        return repo.listMembershipPlans(req.params.clubId);
      });

      api.post<{ Params: { clubId: Id }; Body: NewMembershipPlan }>(
        '/clubs/:clubId/membership-plans',
        {
          schema: {
            body: {
              type: 'object',
              required: ['name', 'amountPence', 'interval'],
              additionalProperties: false,
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 80 },
                amountPence: { type: 'integer', minimum: 1, maximum: 10_000_000 },
                interval: { enum: ['month', 'quarter', 'year'] },
              },
            },
          },
        },
        async (req, reply) => {
          await access.requireClubAdmin(await signedIn(req), req.params.clubId);
          reply.code(201);
          return repo.addMembershipPlan(req.params.clubId, req.body);
        },
      );

      api.get('/me/memberships', async (req) => repo.listMemberMemberships(await signedIn(req)));

      api.get('/payments/config', async (req) => {
        await signedIn(req);
        return paymentService.config();
      });

      api.post<{ Params: { planId: Id } }>('/membership-plans/:planId/checkout', async (req) =>
        paymentService.checkout(await signedIn(req), req.params.planId),
      );

      // Stripe signs the exact bytes it sends, so this route keeps the raw body for verification.
      api.register(async (hook) => {
        hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
        hook.post<{ Body: string }>('/webhooks/stripe', async (req) => {
          const signature = req.headers['stripe-signature'];
          const event = payments.verifyWebhook(req.body, Array.isArray(signature) ? signature[0] : signature);
          await paymentService.handleEvent(event);
          return { received: true };
        });
      });
    },
    { prefix: '/api/v1' },
  );

  app.decorate('sendPaymentReminders', () => paymentService.sendDueReminders());
  app.decorate('chaseAvailability', () => chaser.chaseUpcoming());

  return app;
}
