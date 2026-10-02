import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type {
  AvailabilityStatus,
  FixtureUpdate,
  Id,
  Lineup,
  NewCustomFormation,
  NewAnnouncement,
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
} from '@hockey/contracts';
import { buildCustomFormationSlots, formationsFor, validateLineCounts, FORMATIONS } from '@hockey/engine';
import type { Config } from './config';
import type { Repository } from './db/repository';
import { Access } from './services/access';
import { AuthService } from './services/auth';
import { badRequest, forbidden, HttpError, notFound, unauthorized } from './services/errors';
import { LineupService } from './services/lineups';
import { LiveService } from './services/live';
import { TrainingService } from './services/training';
import type { Mailer } from './services/mailer';
import { DisabledProvider, PaymentService, type PaymentProvider } from './services/payments';

export interface AppDeps {
  repo: Repository;
  mailer: Mailer;
  config: Config;
  /** Payment processor; payments are switched off when omitted. */
  payments?: PaymentProvider;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Email members whose membership payment is due soon; returns how many were emailed. */
    sendPaymentReminders(): Promise<number>;
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

export function buildApp({ repo, mailer, config, payments = new DisabledProvider(), logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });
  const auth = new AuthService(repo, mailer, config);
  const access = new Access(repo);
  const lineups = new LineupService(repo, mailer, config.appUrl);
  const training = new TrainingService(repo);
  const live = new LiveService(repo);
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
          await access.requireTeamMember(await signedIn(req), req.params.teamId);
          return repo.listTeamFixtures(req.params.teamId, req.query.from);
        },
      );

      api.post<{ Params: { teamId: Id }; Body: NewFixture }>(
        '/teams/:teamId/fixtures',
        {
          schema: {
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
          reply.code(201);
          return repo.addFixture(req.params.teamId, req.body);
        },
      );

      api.patch<{ Params: { fixtureId: Id }; Body: FixtureUpdate }>(
        '/fixtures/:fixtureId',
        { schema: { body: { type: 'object', additionalProperties: false, properties: fixtureProps } } },
        async (req) => {
          await access.requireManager(await signedIn(req), await fixtureTeam(req.params.fixtureId));
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
          await access.requireTeamMember(await signedIn(req), req.params.teamId);
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

  return app;
}
